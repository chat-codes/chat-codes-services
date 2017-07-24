"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const _ = require("underscore");
class Chat {
    constructor() {
        this.messageGroupingTimeThreshold = 5 * 60 * 1000; // 5 minutes
        this.messages = [];
        this.messageGroups = [];
    }
    ;
    addToMessageGroups(data) {
        let lastMessageGroup = _.last(this.messageGroups);
        let groupToAddTo = lastMessageGroup;
        if (!lastMessageGroup || (lastMessageGroup.timestamp < data.timestamp - this.messageGroupingTimeThreshold) || (lastMessageGroup.sender.id !== data.sender.id)) {
            groupToAddTo = {
                sender: data.sender,
                timestamp: data.timestamp,
                messages: []
            };
            this.messageGroups.push(groupToAddTo);
        }
        groupToAddTo.messages.push(data);
    }
}
exports.Chat = Chat;
//# sourceMappingURL=chat.js.map