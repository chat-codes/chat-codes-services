"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const _ = require("underscore");
const events_1 = require("events");
class ChatUserList extends events_1.EventEmitter {
    constructor() {
        super();
        this.activeUsers = [];
        this.allUsers = [];
    }
    getUsers() {
        return this.activeUsers;
    }
    addAll(memberInfo) {
        const myID = memberInfo.myID;
        _.each(memberInfo.members, (memberInfo, id) => {
            this.add(id === myID, id, memberInfo.name);
        });
    }
    add(isMe, id, name, active = true) {
        var user = this.hasUser(id);
        if (!user) {
            user = new ChatUser(isMe, id, name, active);
            if (active) {
                this.activeUsers.push(user);
            }
            this.allUsers.push(user);
            this.emit('userAdded', {
                user: user
            });
        }
        return user;
    }
    hasUser(id) {
        for (var i = 0; i < this.allUsers.length; i++) {
            var id_i = this.allUsers[i].id;
            if (id_i === id) {
                return this.allUsers[i];
            }
        }
        return false;
    }
    remove(id) {
        for (var i = 0; i < this.activeUsers.length; i++) {
            var id_i = this.activeUsers[i].id;
            if (id_i === id) {
                this.activeUsers[i].active = false;
                this.activeUsers.splice(i, 1);
                this.emit('userRemoved', {
                    id: id
                });
                break;
            }
        }
    }
    getUser(id) {
        for (var i = 0; i < this.allUsers.length; i++) {
            var id_i = this.allUsers[i].id;
            if (id_i === id) {
                return this.allUsers[i];
            }
        }
        return null;
    }
    getMe() {
        for (var i = 0; i < this.allUsers.length; i++) {
            if (this.allUsers[i].isMe) {
                return this.allUsers[i];
            }
        }
        return null;
    }
    serialize() {
        return _.map(this.allUsers, (u) => { return u.serialize(); });
    }
}
exports.ChatUserList = ChatUserList;
let current_user_color = 2;
class ChatUser extends events_1.EventEmitter {
    constructor(isMe, id, name, active) {
        super();
        this.isMe = isMe;
        this.id = id;
        this.name = name;
        this.active = active;
        this.numColors = 4;
        this.typingStatus = 'IDLE';
        this.colorIndex = isMe ? 1 : current_user_color;
        current_user_color = 2 + ((current_user_color + 1) % this.numColors);
    }
    setTypingStatus(status) {
        this.typingStatus = status;
        this.emit('typingStatus', {
            status: status
        });
    }
    serialize() {
        return {
            id: this.id,
            name: this.name,
            typingStatus: this.typingStatus,
            active: this.active
        };
    }
}
exports.ChatUser = ChatUser;
//# sourceMappingURL=chat-user.js.map