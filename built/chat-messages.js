"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const _ = require("underscore");
const events_1 = require("events");
class MessageGroup extends events_1.EventEmitter {
    constructor(sender, timestamp, messages) {
        super();
        this.sender = sender;
        this.timestamp = timestamp;
        this.messages = [];
        this.messages.push.apply(this.messages, messages);
    }
    addMessage(message) {
        this.messages.push(message);
        this.emit('message-added', {
            message: message
        });
    }
    getSender() { return this.sender; }
    getTimestamp() { return this.timestamp; }
    getMessages() { return this.messages; }
}
exports.MessageGroup = MessageGroup;
;
class MessageGroups extends events_1.EventEmitter {
    constructor(chatUserList) {
        super();
        this.chatUserList = chatUserList;
        this.messageGroupingTimeThreshold = 5 * 60 * 1000; // 5 minutes
        this.messageGroups = [];
        this.messages = [];
    }
    ;
    getMessageHistory() {
        return this.messages;
    }
    addMessage(data) {
        let lastMessageGroup = _.last(this.messageGroups);
        let groupToAddTo = lastMessageGroup;
        if (!lastMessageGroup || (lastMessageGroup.getTimestamp() < data.timestamp - this.messageGroupingTimeThreshold) || (lastMessageGroup.getSender().id !== data.uid)) {
            const sender = this.chatUserList.getUser(data.uid);
            const messageGroup = new MessageGroup(sender, data.timestamp, [data]);
            this.messageGroups.push(messageGroup);
            this.emit('group-added', {
                messageGroup: messageGroup
            });
        }
        else {
            groupToAddTo.addMessage(data);
        }
        this.messages.push(data);
    }
    getMessageGroups() { return this.messageGroups; }
    isEmpty() {
        return this.messageGroups.length === 0;
    }
}
exports.MessageGroups = MessageGroups;
//# sourceMappingURL=chat-messages.js.map