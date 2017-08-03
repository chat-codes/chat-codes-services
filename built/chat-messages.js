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
    translatedataInfo(dataInfo) {
        var dataLine = -1;
        var dataCol = -1;
        if (dataInfo.indexOf(",") != -1) {
            var splitted = dataInfo.split(",", 2);
            dataLine = Number(splitted[0]);
            dataCol = Number(splitted[1]);
        }
        else {
            dataLine = Number(dataInfo);
        }
        return dataLine + "," + dataCol;
    }
    doAddMessage(...messages) {
        _.each(messages, (message) => {
            message.html = this.converter.makeHtml(message.message);
            var html = document.createElement('li');
            html.innerHTML = message.html;
            var aList = html.querySelectorAll("a");
            if (aList.length != 0) {
                _.each(aList, (a) => {
                    var dataInfoString = a.href;
                    var fileName = "None";
                    var lIndex1 = dataInfoString.indexOf(":L");
                    var lIndex2 = dataInfoString.indexOf("-L");
                    if (lIndex1 != -1 && lIndex2 != -1 && lIndex1 < lIndex2) {
                        fileName = dataInfoString.substring(0, lIndex1);
                        var dataStartInfo = dataInfoString.substring(lIndex1 + ":L".length, lIndex2);
                        var dataEndInfo = dataInfoString.substring(lIndex2 + "-L".length);
                        a.href = "javascript:void(0)";
                        a.setAttribute("data-file", fileName);
                        a.setAttribute("data-start", this.translatedataInfo(dataStartInfo));
                        a.setAttribute("data-end", this.translatedataInfo(dataEndInfo));
                    }
                    else if (lIndex1 != -1) {
                        fileName = dataInfoString.substring(0, lIndex1);
                        var dataStartInfo = dataInfoString.substring(lIndex1 + ":L".length);
                        a.href = "javascript:void(0)";
                        a.setAttribute("data-file", fileName);
                        a.setAttribute("data-start", this.translatedataInfo(dataStartInfo));
                        a.setAttribute("data-end", "-1,-1");
                    }
                });
            }
            message.html = html.innerHTML;
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