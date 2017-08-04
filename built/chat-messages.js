"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const _ = require("underscore");
const events_1 = require("events");
const showdown = require("showdown");
/*
 * MessageGroup represents a group of messages that were sent by the same user *around*
 * the same time with no other users interrupting.
 */
class MessageGroup extends events_1.EventEmitter {
    constructor(sender, timestamp, messages) {
        super();
        this.sender = sender;
        this.timestamp = timestamp;
        this.messages = [];
        this.converter = new showdown.Converter();
        this.doAddMessage.apply(this, messages);
    }
    doAddMessage(...messages) {
        _.each(messages, (message) => {
            message.html = this.converter.makeHtml(message.message);
            this.messages.push(message);
        });
    }
    ;
    addMessage(message) {
        this.emit('message-will-be-added', {
            group: this,
            message: message
        });
        this.doAddMessage(message);
        this.emit('message-added', {
            group: this,
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
    constructor(chatUserList, editorStateTracker) {
        super();
        this.chatUserList = chatUserList;
        this.editorStateTracker = editorStateTracker;
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
        // const editor = this.editorStateTracker.fuzzyMatch(data.message);
        // if(editor) {
        // 	const editorID = editor.getEditorID();
        // 	data.editorID = editorID;
        // }
        if (!lastMessageGroup || (lastMessageGroup.getTimestamp() < data.timestamp - this.messageGroupingTimeThreshold) || (lastMessageGroup.getSender().id !== data.uid)) {
            // Add to a new group
            const sender = this.chatUserList.getUser(data.uid);
            const messageGroup = new MessageGroup(sender, data.timestamp, [data]);
            this.messageGroups.push(messageGroup);
            this.emit('group-added', {
                messageGroup: messageGroup
            });
            messageGroup.on('message-added', (event) => {
                this.emit('message-added', event);
            });
            messageGroup.on('message-will-be-added', (event) => {
                this.emit('message-will-be-added', event);
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