"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const _ = require("underscore");
const events_1 = require("events");
/*
 * Represents a single chat user
 */
class ChatUser extends events_1.EventEmitter {
    /**
     * constructor
     * @param  {boolean} isMe       Whether the user is me or not
     * @param  {string}  id         The unique id
     * @param  {string}  name       The display name
     * @param  {boolean} active     Whether this user is currently in the channel
     * @param  {number}  colorIndex The user's color
     */
    constructor(isMe, id, name, active, colorIndex) {
        super();
        this.isMe = isMe;
        this.id = id;
        this.name = name;
        this.active = active;
        this.colorIndex = colorIndex;
        this.typingStatus = 'IDLE';
    }
    getIsMe() { return this.isMe; }
    ;
    isActive() { return this.active; }
    ;
    getID() { return this.id; }
    getName() { return this.name; }
    getColorIndex() { return this.colorIndex; }
    ;
    setIsActive(active) { this.active = active; }
    ;
    getTypingStatus() { return this.typingStatus; }
    ;
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
class ChatUserList extends events_1.EventEmitter {
    constructor() {
        super();
        this.activeUsers = [];
        this.allUsers = [];
        this.current_user_color = 2;
        this.numColors = 4;
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
        let user = this.getUser(id);
        if (user === null) {
            const colorIndex = isMe ? 1 : this.current_user_color;
            this.current_user_color = 2 + ((this.current_user_color + 1) % this.numColors);
            user = new ChatUser(isMe, id, name, active, colorIndex);
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
        return this.getUser(id) !== null;
    }
    /**
     * Remove a user from the list of users
     * @param {string} id The user's ID
     */
    remove(id) {
        for (var i = 0; i < this.activeUsers.length; i++) {
            var id_i = this.activeUsers[i].getID();
            if (id_i === id) {
                this.activeUsers[i].setIsActive(false);
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
            var id_i = this.allUsers[i].getID();
            if (id_i === id) {
                return this.allUsers[i];
            }
        }
        return null;
    }
    getMe() {
        for (var i = 0; i < this.allUsers.length; i++) {
            if (this.allUsers[i].getIsMe()) {
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
//# sourceMappingURL=chat-user.js.map