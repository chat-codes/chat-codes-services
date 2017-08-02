"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const _ = require("underscore");
const events_1 = require("events");
const showdown = require("showdown");
/*
 * MessageGroup represents a group of messages that were sent by the same user *around*
 * the same time with no other users interrupting.
 */
console.log('abcd');
class MessageGroup extends events_1.EventEmitter {
    constructor(sender, timestamp, messages) {
        super();
        this.sender = sender;
        this.timestamp = timestamp;
        this.messages = [];
        this.converter = new showdown.Converter();
        this.doAddMessage.apply(this, messages);
    }
    getLinkDataInfo(html) {
        var htmlLatter = html.substring(html.indexOf("<a href=\"") + "<a href=\"".length);
        var linkedDataInfo = htmlLatter.substring(htmlLatter.indexOf("\">") + 2, htmlLatter.indexOf("</a>"));
        return linkedDataInfo;
    }
    translatedataInfo(dataInfo, dataLine, dataCol) {
        dataLine = -1;
        dataCol = -1;
        if (dataInfo.indexOf(",") != -1) {
            var splitted = dataInfo.split(",", 2);
            dataLine = Number(splitted[0]);
            dataCol = Number(splitted[1]);
        }
        else {
            dataLine = Number(dataInfo);
        }
        console.log(dataLine);
        console.log(dataCol);
    }
    doAddMessage(...messages) {
        _.each(messages, (message) => {
            message.html = this.converter.makeHtml(message.message);
            var html = message.html;
            var fileName = "None";
            var dataStartLine = -1;
            var dataStartCol = -1;
            var dataEndLine = -1;
            var dataEndCol = -1;
            if (html.indexOf("<a href=\"") != -1) {
                var dataInfoString = this.getLinkDataInfo(html);
                if (dataInfoString.indexOf(":L") != -1 &&
                    dataInfoString.indexOf("-L") != -1 &&
                    dataInfoString.indexOf(":L") < dataInfoString.indexOf("-L")) {
                    fileName = dataInfoString.substring(0, dataInfoString.indexOf(":L"));
                    var dataStartInfo = dataInfoString.substring(dataInfoString.indexOf(":L") + 2, dataInfoString.indexOf("-L"));
                    var dataEndInfo = dataInfoString.substring(dataInfoString.indexOf("-L") + 2);
                    //this.translatedataInfo(dataStartInfo, dataStartLine, dataStartCol);
                    if (dataStartInfo.indexOf(",") != -1) {
                        var splitted = dataStartInfo.split(",", 2);
                        dataStartLine = Number(splitted[0]);
                        dataStartCol = Number(splitted[1]);
                    }
                    else {
                        dataStartLine = Number(dataStartInfo);
                    }
                    if (dataEndInfo.indexOf(",") != -1) {
                        var splitted = dataEndInfo.split(",", 2);
                        dataEndLine = Number(splitted[0]);
                        dataEndCol = Number(splitted[1]);
                    }
                    else {
                        dataEndLine = Number(dataEndInfo);
                    }
                    //console.log(fileName);
                    //console.log(dataStartLine);
                    //console.log(dataStartCol);
                    //console.log(dataEndLine);
                    //console.log(dataEndCol);
                }
                else if (dataInfoString.indexOf(":L") != -1) {
                    fileName = dataInfoString.substring(0, dataInfoString.indexOf(":L"));
                    var dataStartInfo = dataInfoString.substring(dataInfoString.indexOf(":L") + 2);
                    if (dataStartInfo.indexOf(",") != -1) {
                        var splitted = dataStartInfo.split(",", 2);
                        dataStartLine = Number(splitted[0]);
                        dataStartCol = Number(splitted[1]);
                    }
                    else {
                        dataStartLine = Number(dataStartInfo);
                    }
                }
            }
            message.fileName = fileName;
            message.dataStartLine = dataStartLine;
            message.dataStartCol = dataStartCol;
            message.dataEndLine = dataEndLine;
            message.dataEndCol = dataEndCol;
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