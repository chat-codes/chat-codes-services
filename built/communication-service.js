"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const _ = require("underscore");
const chat_user_1 = require("./chat-user");
const pusher_communication_layer_1 = require("./pusher-communication-layer");
const events_1 = require("events");
const chat_messages_1 = require("./chat-messages");
const editor_state_tracker_1 = require("./editor-state-tracker");
const DEBUG = false;
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
        this.userList = new chat_user_1.ChatUserList(); // A list of chat userList
        this.editorStateTracker = new editor_state_tracker_1.EditorStateTracker(EditorWrapperClass, this);
        this.messageGroups = new chat_messages_1.MessageGroups(this.userList, this.editorStateTracker);
        this.commLayer = commService.commLayer; // Pop this object up a level
        window.cl = this;
        // Track when a user sends a message
        this.commLayer.bind(this.channelName, 'message', (data) => {
            // Forward the message to the messageGroups tracker
            this.messageGroups.addMessage(data);
            this.emit('message', _.extend({
                sender: this.userList.getUser(data.uid)
            }, data));
        });
        // Track when someone sends the complete history of messages
        this.commLayer.bind(this.channelName, 'message-history', (data) => {
            if (data.forUser === this.myID) {
                // Add every user from the past to our list
                data.allUsers.forEach((u) => {
                    this.userList.add(false, u.id, u.name, u.active);
                });
                _.each(data.history, (m) => {
                    this.messageGroups.addMessage(m);
                    this.emit('message', _.extend({
                        sender: this.userList.getUser(m.uid)
                    }, m));
                });
            }
        });
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
            if (type === 'change-position') {
                const { newBufferPosition, oldBufferPosition, newRange, id, editorID } = data;
                const editorState = this.editorStateTracker.getEditorState(editorID);
                if (editorState) {
                    const remoteCursors = editorState.getRemoteCursors();
                    remoteCursors.updateCursor(id, user, { row: newBufferPosition[0], column: newBufferPosition[1] });
                }
            }
            else if (type === 'change-selection') {
                const { newRange, id, editorID } = data;
                const editorState = this.editorStateTracker.getEditorState(editorID);
                if (editorState) {
                    const remoteCursors = editorState.getRemoteCursors();
                    remoteCursors.updateSelection(id, user, newRange);
                }
            }
            else if (type === 'destroy') {
                const { newRange, id, editorID } = data;
                const editorState = this.editorStateTracker.getEditorState(editorID);
                if (editorState) {
                    const remoteCursors = editorState.getRemoteCursors();
                    remoteCursors.removeCursor(id, user);
                }
            }
            this.emit('cursor-event', data);
        });
        // The complete editor state was sent
        this.commLayer.bind(this.channelName, 'editor-state', (data) => {
            const { forUser, state } = data;
            // If it was sent specifically to me
            if (forUser === this.myID) {
                _.each(state, (serializedEditorState) => {
                    this.editorStateTracker.onEditorOpened(serializedEditorState, true);
                });
                this.emit('editor-state', data);
            }
        });
        // A new editor was opened
        this.commLayer.bind(this.channelName, 'editor-opened', (data) => {
            // const mustPerformChange = !this.isRoot();
            const editorState = this.editorStateTracker.onEditorOpened(data, true);
            this.emit('editor-opened', data);
        });
        // The user wants to write something to the terminal
        this.commLayer.bind(this.channelName, 'write-to-terminal', (data) => {
            this.emit('write-to-terminal', data);
        });
        // The terminal outputted something
        this.commLayer.bind(this.channelName, 'terminal-data', (event) => {
            this.emit('terminal-data', event);
        });
        // Add every current member to the user list
        this.commLayer.getMembers(this.channelName).then((memberInfo) => {
            this.myID = memberInfo.myID;
            this.userList.addAll(memberInfo);
        });
        // Add anyone who subsequently joines
        this.commLayer.onMemberAdded(this.channelName, (member) => {
            this.userList.add(false, member.id, member.info.name);
            // If I'm root, then send over the current editor state and past message history to every new user
            if (this.isRoot()) {
                const memberID = member.id;
                const serializedState = this.editorStateTracker.serializeEditorStates();
                this.commLayer.trigger(this.channelName, 'editor-state', {
                    forUser: memberID,
                    state: serializedState
                });
                this.sendMessageHistory(memberID);
            }
        });
        //When a user leaves, remove them from the user list and remove their cursor
        this.commLayer.onMemberRemoved(this.channelName, (member) => {
            this.editorStateTracker.removeUserCursors(member);
            this.userList.remove(member.id);
        });
    }
    isRoot() {
        return this.commService.isRoot;
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
    }
    /**
     * Send chat message
     * @param {string} message The text of the message to send
     */
    sendTextMessage(message) {
        const data = {
            uid: this.myID,
            type: 'text',
            message: message,
            timestamp: this.getTimestamp()
        };
        this.messageGroups.addMessage(data);
        this.commLayer.trigger(this.channelName, 'message', data);
        this.emit('message', _.extend({
            sender: this.userList.getMe()
        }, data));
    }
    /**
     * Update typing status to either:
     * - 'IDLE' - The user is not typing anything
     * - 'ACTIVE_TYPING' - The user is actively typing
     * - 'IDLE_TYPED' - The user typed something but hasn't sent it or updated for a while
     * @param {string} status IDLE, ACTIVE_TYPING, or IDLE_TYPED
     */
    sendTypingStatus(status) {
        const data = {
            uid: this.myID,
            type: 'status',
            status: status,
            timestamp: this.getTimestamp()
        };
        const meUser = this.userList.getMe();
        this.commLayer.trigger(this.channelName, 'typing', data);
        this.emit('typing', _.extend({
            sender: this.userList.getMe()
        }, data));
        if (meUser) {
            meUser.setTypingStatus(status);
        }
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
        this.commLayer.trigger(this.channelName, 'editor-event', serializedDelta);
    }
    /**
     * The cursor position for the user changed
     * @param {[type]} delta       Information about the cursor position
     * @param {[type]} remote=true Whether this was from a remote user
     */
    emitCursorPositionChanged(delta, remote = true) {
        this.commLayer.trigger(this.channelName, 'cursor-event', _.extend({
            timestamp: this.getTimestamp(),
            uid: this.myID,
            remote: remote
        }, delta));
    }
    /**
     * The selected content for the user has changed
     * @param {[type]} delta       Information about the selection
     * @param {[type]} remote=true Whether this was from a remote user
     */
    emitCursorSelectionChanged(delta, remote = true) {
        this.commLayer.trigger(this.channelName, 'cursor-event', _.extend({
            timestamp: this.getTimestamp(),
            uid: this.myID,
            remote: remote
        }, delta));
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
    /**
     * Sends the complete history of chat messages
     * @param {[type]} forUser The user for whom this history is intended
     */
    sendMessageHistory(forUser) {
        this.commLayer.trigger(this.channelName, 'message-history', {
            history: this.messageGroups.getMessageHistory(),
            allUsers: this.userList.serialize(),
            forUser: forUser
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
}
exports.ChannelCommunicationService = ChannelCommunicationService;
/* A class to create and manage ChannelCommunicationService instances */
class CommunicationService {
    constructor(isRoot, authInfo, EditorWrapperClass) {
        this.isRoot = isRoot;
        this.EditorWrapperClass = EditorWrapperClass;
        this.clients = {}; // Maps channel names to channel comms
        this.commLayer = new pusher_communication_layer_1.PusherCommunicationLayer(authInfo);
        // {
        //     username: username
        // }, key, cluster);
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