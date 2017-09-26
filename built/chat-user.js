"use strict";
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
    constructor(isMe, id, name, active, joined, left, colorIndex) {
        super();
        this.isMe = isMe;
        this.id = id;
        this.name = name;
        this.active = active;
        this.joined = joined;
        this.left = left;
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
    setLeft(ts) { this.left = ts; }
    ;
    getLeft() { return this.left; }
    ;
    getJoined() { return this.joined; }
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
    constructor(myIDPromise, channelService) {
        super();
        this.myIDPromise = myIDPromise;
        this.channelService = channelService;
        this.activeUsers = [];
        this.allUsers = [];
        this.current_user_color = 2;
        this.numColors = 4;
        this.chatDocPromise = this.channelService.getShareDBChat();
        Promise.all([this.chatDocPromise, this.myIDPromise]).then((info) => {
            const [doc, myID] = info;
            _.each(doc.data.allUsers, (userInfo) => {
                const { id, joined, left, info } = userInfo;
                const { name } = info;
                this.add(id === myID, id, name, joined, left, _.has(doc.data.activeUsers, id));
            });
            doc.on('op', (ops, source) => {
                ops.forEach((op) => {
                    const { p } = op;
                    const [field] = p;
                    console.log(op);
                    if (field === 'activeUsers') {
                        if (_.has(op, 'od')) {
                            const { od } = op;
                            const user = this.getUser(od.id);
                            user.setLeft(od.left);
                            this.remove(od.id);
                        }
                        if (_.has(op, 'oi')) {
                            const { oi } = op;
                            const { id, joined, left, info } = oi;
                            const { name } = info;
                            this.add(id === myID, id, name, joined, left, _.has(doc.data.activeUsers, id));
                        }
                    }
                });
            });
        });
    }
    getUsers() {
        return this.activeUsers;
    }
    // public addAll(memberInfo):void {
    //     const myID = memberInfo.myID;
    //     _.each(memberInfo.members, (memberInfo:any, id:string) => {
    //         this.add(id===myID, id, memberInfo.name);
    //     });
    // }
    add(isMe, id, name, joined, left, active = true) {
        let user = this.getUser(id);
        if (user === null) {
            const colorIndex = isMe ? 1 : this.current_user_color;
            this.current_user_color = 2 + ((this.current_user_color + 1) % this.numColors);
            user = new ChatUser(isMe, id, name, active, joined, left, colorIndex);
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
            const user = this.activeUsers[i];
            var id_i = user.getID();
            if (id_i === id) {
                user.setIsActive(false);
                this.activeUsers.splice(i, 1);
                this.emit('userRemoved', {
                    id: id
                });
                return user;
            }
        }
        return null;
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