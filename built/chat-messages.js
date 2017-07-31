"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const _ = require("underscore");
const events_1 = require("events");
/*
 * MessageGroup represents a group of messages that were sent by the same user *around*
 * the same time with no other users interrupting.
 */
console.log('abc');
class MessageGroup extends events_1.EventEmitter {
    constructor(sender, timestamp, messages) {
        super();
        this.sender = sender;
        this.timestamp = timestamp;
        this.messages = [];
        this.doAddMessage.apply(this, messages);
    }
    doAddMessage(...messages) {
        _.each(messages, (message) => {
            console.log(message);
            this.messages.push(message);
        });
    }
    ;
    addMessage(message) {
        this.doAddMessage(message);
        this.emit('message-added', {
            message: message
        });
    }
    ;
    getSender() { return this.sender; }
    getTimestamp() { return this.timestamp; }
    getMessages() { return this.messages; }
}
exports.MessageGroup = MessageGroup;
;
/*
 * A class to keep track of all of the messages in a conversation (where messages are grouped).
 */
class MessageGroups extends events_1.EventEmitter {
    constructor(chatUserList) {
        super();
        this.chatUserList = chatUserList;
        this.messageGroupingTimeThreshold = 5 * 60 * 1000; // The delay between when messages should be in separate groups (5 minutes)
        this.messageGroups = [];
        this.messages = [];
    }
    ;
    getMessageHistory() {
        return this.messages;
    }
    addMessage(data) {
        this.messages.push(data);
        let lastMessageGroup = _.last(this.messageGroups);
        let groupToAddTo = lastMessageGroup;
        if (!lastMessageGroup || (lastMessageGroup.getTimestamp() < data.timestamp - this.messageGroupingTimeThreshold) || (lastMessageGroup.getSender().id !== data.uid)) {
            // Add to a new group
            const sender = this.chatUserList.getUser(data.uid);
            const messageGroup = new MessageGroup(sender, data.timestamp, [data]);
            this.messageGroups.push(messageGroup);
            this.emit('group-added', {
                messageGroup: messageGroup
            });
        }
        else {
            // Add to the latest group
            groupToAddTo.addMessage(data);
        }
    }
    getMessageGroups() { return this.messageGroups; }
    /**
     * Returns true if there are no messages and false otherwise
     * @return {boolean} If there are no messages
     */
    isEmpty() {
        return this.messageGroups.length === 0;
    }
}
exports.MessageGroups = MessageGroups;
//# sourceMappingURL=chat-messages.js.map