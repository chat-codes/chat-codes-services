"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const _ = require("underscore");
const chat_user_1 = require("./chat-user");
const pusher_communication_layer_1 = require("./pusher-communication-layer");
const events_1 = require("events");
class PusherService extends events_1.EventEmitter {
    constructor(userName, channelName, key, cluster) {
        super();
        this.userName = userName;
        this.channelName = channelName;
        this.userList = new chat_user_1.ChatUserList();
        this.commLayer = new pusher_communication_layer_1.PusherCommunicationLayer({
            username: userName
        }, key, cluster);
        this.channelName = channelName;
        this.commLayer.bind(this.channelName, 'terminal-data', (event) => {
            this.emit('terminal-data', event);
        });
        this.commLayer.bind(this.channelName, 'message', (data) => {
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
                    this.emit('message', _.extend({
                        sender: this.userList.getUser(m.uid)
                    }, m));
                });
            }
        });
        this.commLayer.bind(this.channelName, 'typing', (data) => {
            const { uid, status } = data;
            const user = this.userList.getUser(uid);
            if (user) {
                user.setTypingStatus(status);
            }
        });
        this.commLayer.bind(this.channelName, 'editor-event', (data) => {
            this.emit('editor-event', data);
        });
        this.commLayer.bind(this.channelName, 'cursor-event', (data) => {
            this.emit('cursor-event', data);
        });
        this.commLayer.bind(this.channelName, 'editor-state', (data) => {
            this.emit('editor-state', data);
        });
        this.commLayer.bind(this.channelName, 'editor-opened', (data) => {
            this.emit('editor-opened', data);
        });
        this.commLayer.getMembers(this.channelName).then((memberInfo) => {
            this.myID = memberInfo.myID;
            this.userList.addAll(memberInfo);
        });
        this.commLayer.onMemberAdded(this.channelName, (member) => {
            this.userList.add(false, member.id, member.info.name);
        });
        this.commLayer.onMemberRemoved(this.channelName, (member) => {
            this.userList.remove(member.id);
        });
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
    sendTextMessage(message) {
        const data = {
            uid: this.myID,
            type: 'text',
            message: message,
            timestamp: this.getTimestamp()
        };
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
    emitEditorChanged(delta) {
        this.commLayer.trigger(this.channelName, 'editor-event', _.extend({
            timestamp: this.getTimestamp(),
            uid: this.myID,
            remote: true
        }, delta));
    }
    emitCursorPositionChanged(delta) {
        this.commLayer.trigger(this.channelName, 'cursor-event', _.extend({
            timestamp: this.getTimestamp(),
            uid: this.myID,
            remote: true
        }, delta));
    }
    emitCursorSelectionChanged(delta) {
        this.commLayer.trigger(this.channelName, 'cursor-event', _.extend({
            timestamp: this.getTimestamp(),
            uid: this.myID,
            remote: true
        }, delta));
    }
    writeToTerminal(data) {
        this.commLayer.trigger(this.channelName, 'write-to-terminal', {
            timestamp: this.getTimestamp(),
            uid: this.myID,
            remote: true,
            contents: data
        });
    }
    ngOnDestroy() {
        this.commLayer.destroy();
    }
    getTimestamp() {
        return new Date().getTime();
    }
}
exports.PusherService = PusherService;
//# sourceMappingURL=pusher.service.js.map