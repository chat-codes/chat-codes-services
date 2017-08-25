"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const _ = require("underscore");
const events_1 = require("events");
const showdown = require("showdown");
class EditGroup extends events_1.EventEmitter {
}
exports.EditGroup = EditGroup;
/*
 * MessageGroup represents a group of messages that were sent by the same user *around*
 * the same time with no other users interrupting.
 */
class MessageGroup extends events_1.EventEmitter {
    constructor(parent, sender, timestamp, messages) {
        super();
        this.parent = parent;
        this.sender = sender;
        this.timestamp = timestamp;
        this.messages = [];
        this.converter = new showdown.Converter({ simplifiedAutoLink: true });
        this.fileLinkRegexp = new RegExp('^(.+):\s*L(\\d+)(\\s*,\\s*(\\d+))?(\s*-\s*L(\\d+)(\\s*,\\s*(\\d+))?)?$');
        this.doAddMessage.apply(this, messages);
    }
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
    getLinkDataInfo(html) {
        var htmlLatter = html.substring(html.indexOf("<a href=\"") + "<a href=\"".length);
        var linkedDataInfo = htmlLatter.substring(htmlLatter.indexOf("\">") + 2, htmlLatter.indexOf("</a>"));
        return linkedDataInfo;
    }
    doAddMessage(...messages) {
        const editorStateTracker = this.parent.editorStateTracker;
        _.each(messages, (message) => {
            const htmlBuilder = document.createElement('li');
            htmlBuilder.innerHTML = this.converter.makeHtml(message.message);
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
            message.html = htmlBuilder.innerHTML;
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
            const messageGroup = new MessageGroup(this, sender, data.timestamp, [data]);
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
    addEdit(data) {
        console.log(data);
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