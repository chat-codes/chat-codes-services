"use strict";
var __extends = (this && this.__extends) || (function () {
    var extendStatics = Object.setPrototypeOf ||
        ({ __proto__: [] } instanceof Array && function (d, b) { d.__proto__ = b; }) ||
        function (d, b) { for (var p in b) if (b.hasOwnProperty(p)) d[p] = b[p]; };
    return function (d, b) {
        extendStatics(d, b);
        function __() { this.constructor = d; }
        d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
var _ = require("underscore");
var event_1 = require("./event");
/*
 * Represents a single chat user
 */
var ChatUser = /** @class */ (function (_super) {
    __extends(ChatUser, _super);
    /**
     * constructor
     * @param  {boolean} isMe       Whether the user is me or not
     * @param  {string}  id         The unique id
     * @param  {string}  name       The display name
     * @param  {boolean} active     Whether this user is currently in the channel
     * @param  {number}  colorIndex The user's color
     */
    function ChatUser(isMe, id, name, joined, left, colorIndex, channelService) {
        var _this = _super.call(this) || this;
        _this.isMe = isMe;
        _this.id = id;
        _this.name = name;
        _this.joined = joined;
        _this.left = left;
        _this.colorIndex = colorIndex;
        _this.channelService = channelService;
        _this.typingStatus = 'IDLE';
        _this.chatDocPromise = _this.channelService.getShareDBChat();
        return _this;
    }
    ChatUser.prototype.getIsMe = function () { return this.isMe; };
    ;
    ChatUser.prototype.getID = function () { return this.id; };
    ChatUser.prototype.getName = function () { return this.name; };
    ChatUser.prototype.getColorIndex = function () { return this.colorIndex; };
    ;
    ChatUser.prototype.getTypingStatus = function () { return this.typingStatus; };
    ;
    ChatUser.prototype.setLeft = function (ts) { this.left = ts; };
    ;
    ChatUser.prototype.getLeft = function () { return this.left; };
    ;
    ChatUser.prototype.getJoined = function () { return this.joined; };
    ;
    ChatUser.prototype.setTypingStatus = function (status) {
        this.typingStatus = status;
        this.emit('typingStatus', {
            status: status
        });
    };
    return ChatUser;
}(event_1.EventEmitter));
exports.ChatUser = ChatUser;
var ChatUserList = /** @class */ (function (_super) {
    __extends(ChatUserList, _super);
    function ChatUserList(myIDPromise, channelService) {
        var _this = _super.call(this) || this;
        _this.myIDPromise = myIDPromise;
        _this.channelService = channelService;
        _this.activeUsers = new Map();
        _this.allUsers = new Map();
        _this.chatDocPromise = _this.channelService.getShareDBChat();
        _this.ready = Promise.all([_this.chatDocPromise, _this.myIDPromise]).then(function (info) {
            var doc = info[0];
            var myID = info[1];
            _.each(doc.data.allUsers, function (oi) {
                _this.allUsers.set(oi.id, _this.createUser(oi, myID));
            });
            _.each(doc.data.activeUsers, function (oi) {
                _this.activeUsers.set(oi.id, _this.createUser(oi, myID));
            });
            doc.on('op', function (ops, source) {
                ops.forEach(function (op) {
                    var p = op.p;
                    var field = p[0];
                    if ((field === 'activeUsers' || field === 'allUsers') && (p.length === 2)) {
                        var userMap = field === 'activeUsers' ? _this.activeUsers : _this.allUsers;
                        if (_.has(op, 'od') && _.has(op, 'oi')) {
                            var od = op.od, oi = op.oi;
                            if (od.id !== oi.id) {
                                var addedUser = _this.createUser(oi, myID);
                                userMap.delete(od.id);
                                _this.emit('userRemoved', {
                                    id: od.id
                                });
                                userMap.set(oi.id, addedUser);
                                _this.emit('userAdded', {
                                    user: addedUser
                                });
                            }
                        }
                        else if (_.has(op, 'od')) {
                            var od = op.od;
                            var id = od.id;
                            userMap.delete(id);
                            _this.emit('userRemoved', {
                                id: id
                            });
                        }
                        else if (_.has(op, 'oi')) {
                            var oi = op.oi;
                            var addedUser = _this.createUser(oi, myID);
                            userMap.set(oi.id, addedUser);
                            _this.emit('userAdded', {
                                user: addedUser
                            });
                        }
                    }
                    else if (_.last(p) === 'typingStatus') {
                        if (_.has(op, 'oi')) {
                            var oi = op.oi;
                            var uid = p[1];
                            var user = _this.getUser(uid);
                            user.setTypingStatus(oi);
                        }
                    }
                    else {
                        // console.log(p);
                    }
                });
            });
        }).then(function () {
            return true;
        });
        return _this;
    }
    ChatUserList.prototype.createUser = function (userInfo, myID) {
        var id = userInfo.id, joined = userInfo.joined, left = userInfo.left, info = userInfo.info;
        if (this.allUsers.has(id)) {
            var user = this.allUsers.get(id);
            return user;
        }
        else {
            var name_1 = info.name, colorIndex = info.colorIndex;
            var isMe = (id === myID);
            var user = new ChatUser(isMe, id, name_1, joined, left, colorIndex, this.channelService);
            this.allUsers.set(id, user);
            return user;
        }
    };
    ;
    ChatUserList.prototype.getUser = function (id) {
        return this.allUsers.get(id);
    };
    ChatUserList.prototype.getMe = function () {
        var activeUsers = this.getActiveUsers();
        for (var i = 0; i < activeUsers.length; i++) {
            var user = activeUsers[i];
            if (user.getIsMe()) {
                return user;
            }
        }
        return null;
    };
    ChatUserList.prototype.getActiveUsers = function () {
        return Array.from(this.activeUsers.values());
    };
    return ChatUserList;
}(event_1.EventEmitter));
exports.ChatUserList = ChatUserList;
//# sourceMappingURL=chat-user.js.map