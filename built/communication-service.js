"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const _ = require("underscore");
const chat_user_1 = require("./chat-user");
const socket_communication_layer_1 = require("./socket-communication-layer");
const events_1 = require("events");
const chat_messages_1 = require("./chat-messages");
const editor_state_tracker_1 = require("./editor-state-tracker");
const DEBUG = false;
const USE_PUSHER = false;
/**
 * Come up with a channel name from a list of words. If we can't find an empty channel, we just start adding
 * numbers to the channel name
 * @param  {any}          commLayer The communication channel service
 * @return {Promise<string>}           A promise whose value will resolve to the name of a channel that is empty
 */
function generateChannelName(commLayer) {
    const fs = require('fs');
    const path = require('path');
    if (DEBUG) {
        return Promise.resolve('example_channel');
    }
    else {
        const WORD_FILE_NAME = 'google-10000-english-usa-no-swears-medium.txt';
        //Open up the list of words
        return new Promise(function (resolve, reject) {
            fs.readFile(path.join(__dirname, WORD_FILE_NAME), { encoding: 'utf-8' }, function (err, result) {
                if (err) {
                    reject(err);
                }
                else {
                    resolve(result);
                }
            });
        }).then(function (words) {
            // Put the list of opened words in a random order
            return _.shuffle(words.split(/\n/));
        }).then(function (wordList) {
            function* getNextWord() {
                for (var i = 0; i < wordList.length; i++) {
                    yield wordList[i];
                }
                // If we couldn't find anything, start adding numbers to the end of words
                var j = 0;
                while (true) {
                    yield wordList[j % wordList.length] + j + '';
                    j++;
                }
            }
            function getNextAvailableName(iterator) {
                const { value } = iterator.next();
                return commLayer.channelNameAvailable(value).then(function (available) {
                    if (available) {
                        return value;
                    }
                    else {
                        return getNextAvailableName(iterator);
                    }
                });
            }
            return getNextAvailableName(getNextWord());
        });
    }
}
class ChannelCommunicationService extends events_1.EventEmitter {
    /**
     * [constructor description]
     * @param  {CommunicationService} privatecommService The CommunicationService object that created this instance
     * @param  {string}               channelName The name of the channel we're communicating on
     * @param  {class}               EditorWrapperClass A class whose instances satisfy the EditorWrapper interface
     */
    constructor(commService, channelName, EditorWrapperClass) {
        super();
        this.commService = commService;
        this.channelName = channelName;
        this._isRoot = false;
        this.commLayer = commService.commLayer;
        this.chatDoc = this.createDocSubscription('chat');
        this.editorsDoc = this.createDocSubscription('editors');
        this.cursorsDoc = this.createDocSubscription('cursors');
        this.userList = new chat_user_1.ChatUserList(this.getMyID(), this);
        this.editorStateTracker = new editor_state_tracker_1.EditorStateTracker(EditorWrapperClass, this, this.userList);
        this.messageGroups = new chat_messages_1.MessageGroups(this, this.userList, this.editorStateTracker);
        // Track when users are typing
        this.commLayer.bind(this.channelName, 'typing', (data) => {
            const { uid, status } = data;
            const user = this.userList.getUser(uid);
            this.emit('typing', _.extend({
                sender: user
            }, data));
            if (user) {
                user.setTypingStatus(status);
            }
        });
        // Track when something happens in the editor
        this.commLayer.bind(this.channelName, 'editor-event', (data) => {
            const delta = this.editorStateTracker.handleEvent(data, true);
            this.messageGroups.addDelta(delta);
            this.emit('editor-event', data);
        });
        // Track when the user moves the cursor
        this.commLayer.bind(this.channelName, 'cursor-event', (data) => {
            const { id, type, uid } = data;
            let user = this.userList.getUser(uid);
            const cursorID = uid + id;
            if (type === 'change-position') {
                const { newBufferPosition, oldBufferPosition, newRange, cursorID, editorID } = data;
                const editorState = this.editorStateTracker.getEditorState(editorID);
                if (editorState) {
                    const remoteCursors = editorState.getRemoteCursors();
                    remoteCursors.updateCursor(cursorID, user, { row: newBufferPosition[0], column: newBufferPosition[1] });
                }
            }
            else if (type === 'change-selection') {
                const { newRange, id, editorID } = data;
                const editorState = this.editorStateTracker.getEditorState(editorID);
                if (editorState) {
                    const remoteCursors = editorState.getRemoteCursors();
                    remoteCursors.updateSelection(cursorID, user, newRange);
                }
            }
            else if (type === 'destroy') {
                const { newRange, id, editorID } = data;
                const editorState = this.editorStateTracker.getEditorState(editorID);
                if (editorState) {
                    const remoteCursors = editorState.getRemoteCursors();
                    remoteCursors.removeCursor(cursorID, user);
                }
            }
            this.emit('cursor-event', data);
        });
        // A new editor was opened
        this.commLayer.bind(this.channelName, 'editor-opened', (data) => {
            // const mustPerformChange = !this.isRoot();
            const editorState = this.editorStateTracker.onEditorOpened(data, true);
            _.each(editorState.getDeltas(), (delta) => {
                this.messageGroups.addDelta(delta);
            });
            this.emit('editor-opened', data);
        });
    }
    createDocSubscription(docName) {
        return this.commLayer.getShareDBObject(this.getChannelName(), docName).then((doc) => {
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
    createEditorDoc(id, contents) {
        return this.commLayer.createEditorDoc(this.getChannelName(), id, contents);
    }
    ;
    getMyID() {
        return this.commLayer.getMyID(this.getChannelName());
    }
    getShareDBChat() { return this.chatDoc; }
    getShareDBEditors() { return this.editorsDoc; }
    getShareDBCursors() { return this.cursorsDoc; }
    isRoot() {
        return this._isRoot;
        // return this.commService.isRoot;
    }
    /**
     * A promise that resolves when the communication channel is ready
     * @return {Promise<any>} [description]
     */
    ready() {
        return this.commLayer.channelReady(this.channelName);
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
        this.commLayer.trigger(this.channelName, 'editor-opened', _.extend({
            timestamp: this.getTimestamp()
        }, data));
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
            const editorsDoc = info[1];
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
        // const meUser = this.userList.getMe();
        //
        // this.commLayer.trigger(this.channelName, 'typing', data);
        //
        // (this as any).emit('typing', _.extend({
        //     sender: this.userList.getMe()
        // }, data));
        //
        // if(meUser) {
        //     meUser.setTypingStatus(status);
        // }
    }
    /**
     * The user modified something in the editor
     * @param {[type]} serializedDelta       The change
     * @param {[type]} remote=true whether the change was made by a remote client or on the editor
     */
    emitEditorChanged(serializedDelta, remote = true) {
        _.extend(serializedDelta, {
            timestamp: this.getTimestamp(),
            uid: this.myID,
            remote: remote
        });
        const delta = this.editorStateTracker.handleEvent(serializedDelta, serializedDelta.type !== 'edit');
        this.messageGroups.addDelta(delta);
        this.commLayer.trigger(this.channelName, 'editor-event', serializedDelta);
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
        this.commLayer.trigger(this.channelName, 'terminal-data', {
            timestamp: this.getTimestamp(),
            data: data,
            remote: remote
        });
    }
    ;
    writeToTerminal(data) {
        this.commLayer.trigger(this.channelName, 'write-to-terminal', {
            timestamp: this.getTimestamp(),
            uid: this.myID,
            remote: true,
            contents: data
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
        this.commLayer.destroy();
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
        this.commLayer = new socket_communication_layer_1.SocketIOCommunicationLayer(authInfo);
        // // if(USE_PUSHER) {
        // //     this.commLayer = new PusherCommunicationLayer(authInfo);
        // // } else {
        //     // this.commLayer = new WebSocketCommunicationLayer(authInfo);
        // }
    }
    /**
     * Create a channel with a randomly generated name
     * @return {Promise<ChannelCommunicationService>} A promise that resolves to the channel
     */
    createChannel() {
        return generateChannelName(this.commLayer).then((channelName) => {
            return this.createChannelWithName(channelName);
        });
    }
    /**
     * Create a new channel and supply the name
     * @param  {string}                      channelName The name of the channel
     * @return {ChannelCommunicationService}             The communication channel
     */
    createChannelWithName(channelName) {
        var channel = new ChannelCommunicationService(this, channelName, this.EditorWrapperClass);
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