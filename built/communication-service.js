"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const _ = require("underscore");
const chat_user_1 = require("./chat-user");
const socket_communication_layer_1 = require("./socket-communication-layer");
const events_1 = require("events");
const chat_messages_1 = require("./chat-messages");
const editor_state_tracker_1 = require("./editor-state-tracker");
const DEBUG = false;
class ChannelCommunicationService extends events_1.EventEmitter {
    /**
     * [constructor description]
     * @param  {CommunicationService} privatecommService The CommunicationService object that created this instance
     * @param  {string}               channelName The name of the channel we're communicating on
     * @param  {class}               EditorWrapperClass A class whose instances satisfy the EditorWrapper interface
     */
    constructor(commService, channelName, channelID, EditorWrapperClass) {
        super();
        this.commService = commService;
        this.channelName = channelName;
        this.channelID = channelID;
        this._isRoot = false;
        this.cachedEditorVersions = new Map();
        this.commLayer = commService.commLayer;
        this.channelCommLayer = this.commLayer.getNamespace(this.getChannelName(), this.channelID);
        this.chatDoc = this.createDocSubscription('chat');
        this.editorsDoc = this.createDocSubscription('editors');
        this.cursorsDoc = this.createDocSubscription('cursors');
        this.userList = new chat_user_1.ChatUserList(this.getMyID(), this);
        this.editorStateTracker = new editor_state_tracker_1.EditorStateTracker(EditorWrapperClass, this, this.userList);
        this.messageGroups = new chat_messages_1.MessageGroups(this, this.userList, this.editorStateTracker);
    }
    getUserList() { return this.userList; }
    ;
    getEditorStateTracker() { return this.editorStateTracker; }
    ;
    getMessageGroups() { return this.messageGroups; }
    ;
    createDocSubscription(docName) {
        return this.channelCommLayer.then((ccomm) => {
            return ccomm.getShareDBObject(docName);
        }).then((doc) => {
            return new Promise((resolve, reject) => {
                doc.subscribe((err) => {
                    if (err) {
                        reject(err);
                    }
                    else {
                        resolve(doc);
                    }
                });
            });
        });
    }
    getMyID() {
        return this.channelCommLayer.then((ccomm) => {
            return ccomm.getID();
        });
    }
    getShareDBChat() { return this.chatDoc; }
    getShareDBEditors() { return this.editorsDoc; }
    getShareDBCursors() { return this.cursorsDoc; }
    getEditorVersion(version) {
        if (this.cachedEditorVersions.has(version)) {
            return this.cachedEditorVersions.get(version);
        }
        else {
            const prv = this.channelCommLayer.then((ccomm) => {
                return ccomm.pemit('get-editors-values', version);
            }).then((data) => {
                const rv = new Map();
                _.each(data, (x) => {
                    rv.set(x.id, x);
                });
                return rv;
            });
            this.cachedEditorVersions.set(version, prv);
            return prv;
        }
    }
    /**
     * A promise that resolves when the communication channel is ready
     * @return {Promise<any>} [description]
     */
    ready() {
        return Promise.all([this.channelCommLayer, this.editorStateTracker.ready, this.userList.ready, this.messageGroups.ready]);
    }
    /**
     * Request that the user saves a particular file
      * @param {[type]} data Information about which file to save
     */
    emitSave(data) {
        this.emit('save', _.extend({
            sender: this.userList.getMe(),
            timestamp: this.getTimestamp()
        }, data));
    }
    /**
     * Called when the user opens a new editor window
     * @param {[type]} data Information about the editor
     */
    emitEditorOpened(data) {
        const editorState = this.editorStateTracker.onEditorOpened(data, true);
        this.emit('editor-opened', data);
    }
    /**
     * Send chat message
     * @param {string} message The text of the message to send
     */
    sendTextMessage(message) {
        Promise.all([this.getMyID(), this.getShareDBChat(), this.getShareDBEditors()]).then((info) => {
            const myID = info[0];
            const chatDoc = info[1];
            const editorsDoc = info[2];
            const data = {
                uid: myID,
                type: 'text',
                message: message,
                timestamp: this.getTimestamp(),
                editorsVersion: editorsDoc.version
            };
            chatDoc.submitOp([{ p: ['messages', chatDoc.data.messages.length], li: data }]);
        });
    }
    /**
     * Update typing status to either:
     * - 'IDLE' - The user is not typing anything
     * - 'ACTIVE_TYPING' - The user is actively typing
     * - 'IDLE_TYPED' - The user typed something but hasn't sent it or updated for a while
     * @param {string} status IDLE, ACTIVE_TYPING, or IDLE_TYPED
     */
    sendTypingStatus(status) {
        Promise.all([this.getMyID(), this.getShareDBChat()]).then((info) => {
            const myID = info[0];
            const doc = info[1];
            const oldValue = doc.data['activeUsers'][myID]['info']['typingStatus'];
            doc.submitOp([{ p: ['activeUsers', myID, 'info', 'typingStatus'], od: oldValue, oi: status }]);
        });
    }
    /**
     * The user modified something in the editor
     * @param {[type]} serializedDelta       The change
     * @param {[type]} remote=true whether the change was made by a remote client or on the editor
     */
    emitEditorChanged(serializedDelta, remote = true) {
        this.channelCommLayer.then((ccomm) => {
            const myID = ccomm.getID();
            _.extend(serializedDelta, {
                timestamp: this.getTimestamp(),
                uid: myID,
                remote: remote
            });
            return ccomm.pemit('editor-event', serializedDelta);
        });
    }
    /**
     * The cursor position for the user changed
     * @param {[type]} delta       Information about the cursor position
     * @param {[type]} remote=true Whether this was from a remote user
     */
    onCursorPositionChanged(delta) {
        Promise.all([this.getMyID(), this.getShareDBCursors()]).then((info) => {
            const myID = info[0];
            const doc = info[1];
            const { editorID } = delta;
            if (_.has(doc.data, editorID)) {
                doc.submitOp({ p: [editorID, 'userCursors', myID], oi: delta, od: doc.data[editorID]['userCursors'][myID] });
            }
            else {
                const oi = { 'userCursors': {}, 'userSelections': {} };
                oi['userCursors'][myID] = delta;
                doc.submitOp({ p: [editorID], oi });
            }
            // for(let i = 0; i<doc.data.length; i++) {
            //     let editorState = doc.data[i];
            //     if(editorState.id === delta.editorID) {
            //         const oldDelta = editorState.userCursors[myID];
            //         // const {newBufferPosition} = delta;
            //
            //         doc.submitOp({p:[i, 'userCursors', myID], od: oldDelta, oi: delta});
            //         break;
            //     }
            // }
            // const oldValue = doc.data['activeUsers'][myID]['info']['typingStatus'];
            // doc.submitOp([{p: ['activeUsers', myID, 'info', 'typingStatus'], od: oldValue, oi: status}]);
        });
        // this.commLayer.trigger(this.channelName, 'cursor-event', _.extend({
        // 	timestamp: this.getTimestamp(),
        //     uid: this.myID,
        // 	remote: remote
        // }, delta));
    }
    /**
     * The selected content for the user has changed
     * @param {[type]} delta       Information about the selection
     * @param {[type]} remote=true Whether this was from a remote user
     */
    onCursorSelectionChanged(delta) {
        Promise.all([this.getMyID(), this.getShareDBCursors()]).then((info) => {
            const myID = info[0];
            const doc = info[1];
            const { editorID } = delta;
            if (_.has(doc.data, editorID)) {
                doc.submitOp({ p: [editorID, 'userSelections', myID], oi: delta, od: doc.data[editorID]['userSelections'][myID] });
            }
            else {
                const oi = { 'userCursors': {}, 'userSelections': {} };
                oi['userSelections'][myID] = delta;
                doc.submitOp({ p: [editorID], oi });
            }
        });
        // const uid = this.getMyID();
        // console.log(delta);
        // this.commLayer.trigger(this.channelName, 'cursor-event', _.extend({
        // 	timestamp: this.getTimestamp(),
        //     uid: this.myID,
        // 	remote: remote
        // }, delta));
    }
    /**
     * Called when the terminal outputs something
     * @param {[type]} data         Information about what the terminal outputted
     * @param {[type]} remote=false Whether this was outputted by a remote client
     */
    emitTerminalData(data, remote = false) {
        this.channelCommLayer.then((ccomm) => {
            return ccomm.pemit('terminal-data', {
                timestamp: this.getTimestamp(),
                data: data,
                remote: remote
            });
        });
    }
    ;
    writeToTerminal(data) {
        this.channelCommLayer.then((ccomm) => {
            return ccomm.pemit('write-to-terminal', {
                timestamp: this.getTimestamp(),
                uid: this.myID,
                remote: true,
                contents: data
            });
        });
    }
    getURL() {
        const url = require('url');
        return url.format({
            protocol: 'http',
            host: 'chat.codes',
            pathname: this.channelName
        });
    }
    destroy() {
        this.channelCommLayer.then((ccomm) => {
            ccomm.destroy();
        });
    }
    getActiveEditors() {
        return this.editorStateTracker.getActiveEditors();
    }
    /**
     * Get the current timestamp (as milliseconds since Jan 1 1970)
     * @return {number} The timestamp
     */
    getTimestamp() {
        return new Date().getTime();
    }
    ;
    getChannelName() {
        return this.channelName;
    }
}
exports.ChannelCommunicationService = ChannelCommunicationService;
/* A class to create and manage ChannelCommunicationService instances */
class CommunicationService {
    constructor(authInfo, EditorWrapperClass) {
        this.EditorWrapperClass = EditorWrapperClass;
        this.clients = {}; // Maps channel names to channel comms
        this.commLayer = new socket_communication_layer_1.WebSocketCommunicationLayer(authInfo);
        // // if(USE_PUSHER) {
        // //     this.commLayer = new PusherCommunicationLayer(authInfo);
        // // } else {
        //     // this.commLayer = new WebSocketCommunicationLayer(authInfo);
        // }
    }
    /**
     * Create a new channel and supply the name
     * @param  {string}                      channelName The name of the channel
     * @return {ChannelCommunicationService}             The communication channel
     */
    createChannelWithName(channelName, channelID) {
        var channel = new ChannelCommunicationService(this, channelName, channelID, this.EditorWrapperClass);
        this.clients[channelName] = channel;
        return channel;
    }
    /**
     * Clean up the resources for a specific channel client
     * @param {string} name The name of the channel
     */
    destroyChannel(name) {
        if (this.clients[name]) {
            var client = this.clients[name];
            client.destroy();
            delete this.clients[name];
        }
    }
    /**
     * Clean up resources from every client
     */
    destroy() {
        this.commLayer.destroy();
        _.each(this.clients, (client, name) => {
            this.destroyChannel(name);
        });
    }
}
exports.CommunicationService = CommunicationService;
//# sourceMappingURL=communication-service.js.map