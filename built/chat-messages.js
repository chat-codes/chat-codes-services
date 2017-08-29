"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const _ = require("underscore");
const events_1 = require("events");
const showdown = require("showdown");
class EditGroup extends events_1.EventEmitter {
    constructor(parent, deltas) {
        super();
        this.parent = parent;
        this.deltas = deltas;
    }
    getEarliestTimestamp() { return _.first(this.deltas).getTimestamp(); }
    getLatestTimestamp() { return _.last(this.deltas).getTimestamp(); }
    getTimestamp() { return this.getLatestTimestamp(); }
    getDeltas() { return this.deltas; }
    addItem(delta) {
        this.emit('delta-will-be-added', {
            group: this,
            delta: delta
        });
        const insertionIndex = this.getInsertionIndex(delta.getTimestamp());
        this.deltas.splice(insertionIndex, 0, delta);
        this.emit('delta-added', {
            group: this,
            insertionIndex: insertionIndex,
            delta: delta
        });
        return insertionIndex;
    }
    getEditorStates() {
        const editorStates = this.getDeltas().map(delta => delta.getEditorState());
        return _.unique(editorStates);
    }
    getAuthors() {
        const authors = this.getDeltas().map(delta => delta.getAuthor());
        return _.unique(authors);
    }
    getInsertionIndex(timestamp) {
        const deltas = this.getDeltas();
        for (let i = deltas.length - 1; i >= 0; i--) {
            const delta = this.deltas[i];
            if (delta.getTimestamp() < timestamp) {
                return i + 1;
            }
        }
        return 0;
    }
}
exports.EditGroup = EditGroup;
class Message {
    constructor(sender, timestamp, message, editorStateTracker) {
        this.sender = sender;
        this.timestamp = timestamp;
        this.message = message;
        this.converter = new showdown.Converter({ simplifiedAutoLink: true });
        this.fileLinkRegexp = new RegExp('^(.+):\s*L(\\d+)(\\s*,\\s*(\\d+))?(\s*-\s*L(\\d+)(\\s*,\\s*(\\d+))?)?$');
        const htmlBuilder = document.createElement('li');
        htmlBuilder.innerHTML = this.converter.makeHtml(this.message);
        _.each(htmlBuilder.querySelectorAll('a'), (a) => {
            const fileLinkInfo = this.matchFileLinkAttributes(a.getAttribute('href'));
            if (fileLinkInfo) {
                const { fileName, start, end } = fileLinkInfo;
                if (isNaN(start.column)) {
                    start.column = -1;
                }
                if (isNaN(end.row)) {
                    end.row = start.row;
                } // just one line
                if (isNaN(end.column)) {
                    end.column = -1;
                }
                const editorState = editorStateTracker.fuzzyMatch(fileName);
                const fileID = editorState ? editorState.getEditorID() : fileName;
                a.setAttribute('href', 'javascript:void(0)');
                a.setAttribute('class', 'line_ref');
                a.setAttribute('data-file', fileID);
                a.setAttribute('data-start', [start.row, start.column].join(','));
                a.setAttribute('data-end', [end.row, end.column].join(','));
            }
        });
        this.html = htmlBuilder.innerHTML;
    }
    getSender() { return this.sender; }
    ;
    getTimestamp() { return this.timestamp; }
    ;
    getMessage() { return this.message; }
    ;
    getHTML() { return this.html; }
    ;
    matchFileLinkAttributes(str) {
        const match = str.match(this.fileLinkRegexp);
        if (match) {
            return {
                fileName: match[1],
                start: {
                    row: parseInt(match[2]),
                    column: parseInt(match[4])
                },
                end: {
                    row: parseInt(match[6]),
                    column: parseInt(match[8])
                }
            };
        }
        else {
            return false;
        }
    }
    ;
}
exports.Message = Message;
/*
 * MessageGroup represents a group of messages that were sent by the same user *around*
 * the same time with no other users interrupting.
 */
class MessageGroup extends events_1.EventEmitter {
    constructor(parent, chatUserList, editorStateTracker, messages) {
        super();
        this.parent = parent;
        this.chatUserList = chatUserList;
        this.editorStateTracker = editorStateTracker;
        this.messages = [];
        _.each(messages, (m) => { this.doAddMessage(m); });
    }
    getLinkDataInfo(html) {
        var htmlLatter = html.substring(html.indexOf("<a href=\"") + "<a href=\"".length);
        var linkedDataInfo = htmlLatter.substring(htmlLatter.indexOf("\">") + 2, htmlLatter.indexOf("</a>"));
        return linkedDataInfo;
    }
    doAddMessage(message) {
        const editorStateTracker = this.parent.editorStateTracker;
        const sender = this.chatUserList.getUser(message.uid);
        this.sender = sender;
        const messageObject = new Message(sender, message.timestamp, message.message, this.editorStateTracker);
        const insertionIndex = this.getInsertionIndex(messageObject.getTimestamp());
        this.messages.splice(insertionIndex, 0, messageObject);
        return {
            insertionIndex: insertionIndex,
            messageObject: messageObject
        };
    }
    ;
    addItem(message) {
        this.emit('message-will-be-added', {
            group: this,
            message: message
        });
        const { insertionIndex, messageObject } = this.doAddMessage(message);
        this.emit('message-added', {
            group: this,
            message: messageObject,
            insertionIndex: insertionIndex
        });
        return insertionIndex;
    }
    ;
    getSender() { return this.sender; }
    getMessages() { return this.messages; }
    getTimestamp() { return this.getLatestTimestamp(); }
    ;
    getEarliestTimestamp() { return _.first(this.messages).timestamp; }
    getLatestTimestamp() { return _.last(this.messages).timestamp; }
    getInsertionIndex(timestamp) {
        const messages = this.getMessages();
        for (let i = messages.length - 1; i >= 0; i--) {
            const message = this.messages[i];
            if (message.getTimestamp() < timestamp) {
                return i + 1;
            }
        }
        return 0;
    }
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
    getAppropriateGroup(checkMatch, CheckClass) {
        for (let i = this.messageGroups.length - 1; i >= 0; i--) {
            const messageGroup = this.messageGroups[i];
            // if(messageGroup instanceof CheckClass) {
            if (checkMatch(messageGroup)) {
                return messageGroup;
            }
            else {
                break;
            }
            // }
        }
        return null;
    }
    getInsertionIndex(timestamp) {
        for (let i = this.messageGroups.length - 1; i >= 0; i--) {
            const messageGroup = this.messageGroups[i];
            if (messageGroup.getLatestTimestamp() < timestamp) {
                return i + 1;
            }
        }
        return 0;
    }
    addMessage(data) {
        this.messages.push(data);
        let groupToAddTo = this.getAppropriateGroup((g) => ((g instanceof MessageGroup) &&
            ((data.timestamp >= g.getLatestTimestamp() - this.messageGroupingTimeThreshold) ||
                (data.timestamp <= g.getEarliestTimestamp() + this.messageGroupingTimeThreshold)) &&
            g.getSender().getID() === data.uid), MessageGroup);
        if (groupToAddTo) {
            groupToAddTo.addItem(data);
        }
        else {
            // Add to a new group
            groupToAddTo = new MessageGroup(this, this.chatUserList, this.editorStateTracker, [data]);
            let insertionIndex = this.getInsertionIndex(data.timestamp);
            this.emit('group-will-be-added', {
                messageGroup: groupToAddTo,
                insertionIndex: insertionIndex
            });
            this.messageGroups.splice(insertionIndex, 0, groupToAddTo);
            this.emit('group-added', {
                messageGroup: groupToAddTo,
                insertionIndex: insertionIndex
            });
            groupToAddTo.on('message-will-be-added', (event) => {
                this.emit('message-will-be-added', event);
            });
            groupToAddTo.on('message-added', (event) => {
                this.emit('message-added', event);
            });
        }
    }
    getMessageGroups() { return this.messageGroups; }
    addDelta(delta) {
        let groupToAddTo = this.getAppropriateGroup((g) => ((g instanceof EditGroup) &&
            ((delta.getTimestamp() >= g.getLatestTimestamp() - this.messageGroupingTimeThreshold) ||
                (delta.getTimestamp() <= g.getEarliestTimestamp() + this.messageGroupingTimeThreshold))), EditGroup);
        if (groupToAddTo) {
            groupToAddTo.addItem(delta);
        }
        else {
            groupToAddTo = new EditGroup(this, [delta]);
            let insertionIndex = this.getInsertionIndex(delta.getTimestamp());
            this.emit('group-will-be-added', {
                messageGroup: groupToAddTo,
                insertionIndex: insertionIndex
            });
            this.messageGroups.splice(insertionIndex, 0, groupToAddTo);
            this.emit('group-added', {
                messageGroup: groupToAddTo,
                insertionIndex: insertionIndex
            });
            groupToAddTo.on('delta-will-be-added', (event) => {
                this.emit('delta-will-be-added', event);
            });
            groupToAddTo.on('delta-added', (event) => {
                this.emit('delta-added', event);
            });
        }
    }
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