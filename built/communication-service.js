"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const _ = require("underscore");
const chat_user_1 = require("./chat-user");
const pusher_communication_layer_1 = require("./pusher-communication-layer");
const events_1 = require("events");
const chat_messages_1 = require("./chat-messages");
const editor_state_tracker_1 = require("./editor-state-tracker");
const DEBUG = true;
function generateChannelName(commLayer) {
    const fs = require('fs');
    const path = require('path');
    if (DEBUG) {
        return Promise.resolve('c2');
    }
    else {
        const WORD_FILE_NAME = 'google-10000-english-usa-no-swears-medium.txt';
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
            return _.shuffle(words.split(/\n/));
        }).then(function (wordList) {
            function* getNextWord() {
                for (var i = 0; i < wordList.length; i++) {
                    yield wordList[i];
                }
                var j = 0;
                while (true) {
                    yield j + '';
                    j++;
                }
            }
            function getNextAvailableName(iterator) {
                if (!iterator) {
                    iterator = getNextWord();
                }
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
            return getNextAvailableName(null);
        });
    }
}
class ChannelCommunicationService extends events_1.EventEmitter {
    constructor(commService, channelName, EditorWrapperClass) {
        super();
        this.commService = commService;
        this.channelName = channelName;
        this.userList = new chat_user_1.ChatUserList();
        this.messageGroups = new chat_messages_1.MessageGroups(this.userList);
        this.editorStateTracker = new editor_state_tracker_1.EditorStateTracker(EditorWrapperClass, this);
        this.commLayer = commService.commLayer;
        this.commLayer.bind(this.channelName, 'terminal-data', (event) => {
            this.emit('terminal-data', event);
        });
        this.commLayer.bind(this.channelName, 'message', (data) => {
            this.messageGroups.addMessage(data);
            this.emit('message', _.extend({
                sender: this.userList.getUser(data.uid)
            }, data));
        });
        this.commLayer.bind(this.channelName, 'message-history', (data) => {
            if (data.forUser === this.myID) {
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
        this.commLayer.bind(this.channelName, 'editor-event', (data) => {
            this.editorStateTracker.handleEvent(data, true);
            this.emit('editor-event', data);
        });
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
        this.commLayer.bind(this.channelName, 'editor-state', (data) => {
            const { forUser, state } = data;
            if (forUser === this.myID) {
                _.each(state, (serializedEditorState) => {
                    this.editorStateTracker.onEditorOpened(serializedEditorState, true);
                });
                this.emit('editor-state', data);
            }
        });
        this.commLayer.bind(this.channelName, 'editor-opened', (data) => {
            // const mustPerformChange = !this.isRoot();
            const editorState = this.editorStateTracker.onEditorOpened(data, true);
            this.emit('editor-opened', data);
        });
        this.commLayer.bind(this.channelName, 'write-to-terminal', (data) => {
            this.emit('write-to-terminal', data);
        });
        this.commLayer.getMembers(this.channelName).then((memberInfo) => {
            this.myID = memberInfo.myID;
            this.userList.addAll(memberInfo);
        });
        this.commLayer.onMemberAdded(this.channelName, (member) => {
            this.userList.add(false, member.id, member.info.name);
            if (this.isRoot()) {
                const memberID = member.id;
                const serializedState = this.editorStateTracker.serializeEditorStates();
                this.sendMessageHistory(memberID);
                this.commLayer.trigger(this.channelName, 'editor-state', {
                    forUser: memberID,
                    state: serializedState
                });
            }
        });
        this.commLayer.onMemberRemoved(this.channelName, (member) => {
            this.editorStateTracker.removeUserCursors(member);
            this.userList.remove(member.id);
        });
    }
    isRoot() {
        return this.commService.isRoot;
    }
    ready() {
        return this.commLayer.channelReady(this.channelName);
    }
    emitSave(data) {
        this.emit('message', _.extend({
            sender: this.userList.getMe(),
            timestamp: this.getTimestamp()
        }, data));
    }
    emitEditorOpened(data) {
        const editorState = this.editorStateTracker.onEditorOpened(data, true);
        this.commLayer.trigger(this.channelName, 'editor-opened', _.extend({
            timestamp: this.getTimestamp()
        }, data));
    }
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
    emitEditorChanged(delta, remote = true) {
        this.editorStateTracker.handleEvent(delta, false);
        this.commLayer.trigger(this.channelName, 'editor-event', _.extend({
            timestamp: this.getTimestamp(),
            uid: this.myID,
            remote: remote
        }, delta));
    }
    emitCursorPositionChanged(delta, remote = true) {
        this.commLayer.trigger(this.channelName, 'cursor-event', _.extend({
            timestamp: this.getTimestamp(),
            uid: this.myID,
            remote: remote
        }, delta));
    }
    emitCursorSelectionChanged(delta, remote = true) {
        this.commLayer.trigger(this.channelName, 'cursor-event', _.extend({
            timestamp: this.getTimestamp(),
            uid: this.myID,
            remote: remote
        }, delta));
    }
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
    getTimestamp() {
        return new Date().getTime();
    }
}
exports.ChannelCommunicationService = ChannelCommunicationService;
class CommunicationService {
    constructor(isRoot, username, key, cluster, EditorWrapperClass) {
        this.isRoot = isRoot;
        this.EditorWrapperClass = EditorWrapperClass;
        this.clients = {};
        this.commLayer = new pusher_communication_layer_1.PusherCommunicationLayer({
            username: username
        }, key, cluster);
    }
    createChannel() {
        return generateChannelName(this.commLayer).then((channelName) => {
            return this.createChannelWithName(channelName);
        });
    }
    createChannelWithName(channelName) {
        var channel = new ChannelCommunicationService(this, channelName, this.EditorWrapperClass);
        this.clients[channelName] = channel;
        return channel;
    }
    destroyChannel(name) {
        if (this.clients[name]) {
            var client = this.clients[name];
            client.destroy();
            delete this.clients[name];
        }
    }
    destroy() {
        this.commLayer.destroy();
        _.each(this.clients, (client, name) => {
            this.destroyChannel(name);
        });
    }
}
exports.CommunicationService = CommunicationService;
//# sourceMappingURL=communication-service.js.map