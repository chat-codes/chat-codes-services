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
var showdown = require("showdown");
var difflib = require("difflib");
function tstamp(x) {
    if (typeof (x) === typeof (1)) {
        return x;
    }
    else {
        return x.getTimestamp();
    }
}
function before(a, b) { return tstamp(a) < tstamp(b); }
function after(a, b) { return tstamp(a) > tstamp(b); }
function beforeEQ(a, b) { return tstamp(a) <= tstamp(b); }
function afterEQ(a, b) { return tstamp(a) >= tstamp(b); }
function reverseArr(input) {
    var ret = new Array;
    for (var i = input.length - 1; i >= 0; i--) {
        ret.push(input[i]);
    }
    return ret;
}
var ConnectionAction;
(function (ConnectionAction) {
    ConnectionAction[ConnectionAction["connect"] = 1] = "connect";
    ConnectionAction[ConnectionAction["disconnect"] = 2] = "disconnect";
})(ConnectionAction || (ConnectionAction = {}));
;
var ConnectionMessage = /** @class */ (function () {
    function ConnectionMessage(user, timestamp, action) {
        this.user = user;
        this.timestamp = timestamp;
        this.action = action;
    }
    ConnectionMessage.prototype.getUser = function () { return this.user; };
    ;
    ConnectionMessage.prototype.getTimestamp = function () { return this.timestamp; };
    ;
    ConnectionMessage.prototype.isConnect = function () { return this.action === ConnectionAction.connect; };
    ConnectionMessage.prototype.isDisconnect = function () { return this.action !== ConnectionAction.connect; };
    return ConnectionMessage;
}());
exports.ConnectionMessage = ConnectionMessage;
var EditMessage = /** @class */ (function () {
    function EditMessage(users, editors, timestamp, contents) {
        this.users = users;
        this.editors = editors;
        this.timestamp = timestamp;
        this.contents = contents;
    }
    EditMessage.prototype.getUsers = function () { return this.users; };
    ;
    EditMessage.prototype.getEditors = function () { return this.editors; };
    ;
    EditMessage.prototype.getTimestamp = function () { return this.timestamp; };
    ;
    EditMessage.prototype.getContents = function () { return this.contents; };
    ;
    return EditMessage;
}());
exports.EditMessage = EditMessage;
var TextMessage = /** @class */ (function () {
    function TextMessage(sender, timestamp, message, editorsVersion, editorStateTracker) {
        var _this = this;
        this.sender = sender;
        this.timestamp = timestamp;
        this.message = message;
        this.editorsVersion = editorsVersion;
        this.converter = new showdown.Converter({ simplifiedAutoLink: true });
        this.fileLinkRegexp = new RegExp('^(.+):\s*L(\\d+)(\\s*,\\s*(\\d+))?(\s*-\s*L(\\d+)(\\s*,\\s*(\\d+))?)?$');
        var htmlBuilder = document.createElement('li');
        htmlBuilder.innerHTML = this.converter.makeHtml(this.message);
        _.each(htmlBuilder.querySelectorAll('a'), function (a) {
            var fileLinkInfo = _this.matchFileLinkAttributes(a.getAttribute('href'));
            if (fileLinkInfo) {
                var fileName = fileLinkInfo.fileName, start = fileLinkInfo.start, end = fileLinkInfo.end;
                if (isNaN(start.column)) {
                    start.column = -1;
                }
                if (isNaN(end.row)) {
                    end.row = start.row;
                } // just one line
                if (isNaN(end.column)) {
                    end.column = -1;
                }
                var editorState = editorStateTracker.fuzzyMatch(fileName);
                var fileID = editorState ? editorState.getEditorID() : fileName;
                a.setAttribute('href', 'javascript:void(0)');
                a.setAttribute('class', 'line_ref');
                a.setAttribute('data-file', fileID);
                a.setAttribute('data-start', [start.row, start.column].join(','));
                a.setAttribute('data-end', [end.row, end.column].join(','));
            }
        });
        this.html = htmlBuilder.innerHTML;
    }
    TextMessage.prototype.getSender = function () { return this.sender; };
    ;
    TextMessage.prototype.getTimestamp = function () { return this.timestamp; };
    ;
    TextMessage.prototype.getMessage = function () { return this.message; };
    ;
    TextMessage.prototype.getHTML = function () { return this.html; };
    ;
    TextMessage.prototype.getEditorVersion = function () { return this.editorsVersion; };
    ;
    TextMessage.prototype.matchFileLinkAttributes = function (str) {
        var match = str.match(this.fileLinkRegexp);
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
    };
    ;
    return TextMessage;
}());
exports.TextMessage = TextMessage;
var Group = /** @class */ (function (_super) {
    __extends(Group, _super);
    function Group(items) {
        var _this = _super.call(this) || this;
        _this.items = [];
        items.forEach(function (item) {
            _this.doAddItem(item);
        });
        return _this;
    }
    ;
    Group.prototype.getItems = function () { return this.items; };
    Group.prototype.getEarliestItem = function () { return _.first(this.getItems()); };
    Group.prototype.getLatestItem = function () { return _.last(this.getItems()); };
    Group.prototype.getEarliestTimestamp = function () { return this.getEarliestItem().getTimestamp(); };
    Group.prototype.getLatestTimestamp = function () { return this.getLatestItem().getTimestamp(); };
    Group.prototype.includesTimestamp = function (timestamp) {
        return afterEQ(timestamp, this.getEarliestTimestamp()) && beforeEQ(timestamp, this.getLatestTimestamp());
    };
    ;
    Group.prototype.occuredBefore = function (item) {
        return before(this.getLatestTimestamp(), item);
    };
    ;
    Group.prototype.occuredBeforeEQ = function (item) {
        return beforeEQ(this.getLatestTimestamp(), item);
    };
    ;
    Group.prototype.occuredAfter = function (item) {
        return after(this.getLatestTimestamp(), item);
    };
    ;
    Group.prototype.occuredAfterEQ = function (item) {
        return afterEQ(this.getLatestTimestamp(), item);
    };
    ;
    Group.prototype.getInsertionIndex = function (timestamp) {
        var items = this.getItems();
        var i = items.length - 1;
        for (; i >= 0; i--) {
            if (before(this.items[i], timestamp)) {
                return i + 1;
            }
        }
        return i;
    };
    Group.prototype.split = function (timestamp) {
        var index = this.getInsertionIndex(timestamp);
        var beforeIndex = this.constructNew(this.items.slice(0, index));
        var afterIndex = this.constructNew(this.items.slice(index));
        return [beforeIndex, afterIndex];
    };
    ;
    Group.prototype.doAddItem = function (item) {
        var insertionIndex = this.getInsertionIndex(item.getTimestamp());
        this.items.splice(insertionIndex, 0, item);
        return {
            insertionIndex: insertionIndex,
            item: item
        };
    };
    ;
    Group.prototype.addItem = function (titem) {
        this.emit('item-will-be-added', {
            group: this,
            item: titem
        });
        var _a = this.doAddItem(titem), insertionIndex = _a.insertionIndex, item = _a.item;
        this.emit('item-added', {
            group: this,
            item: titem,
            insertionIndex: insertionIndex
        });
        return insertionIndex;
    };
    ;
    Group.prototype.compatibleWith = function (item) {
        return true;
    };
    ;
    Group.prototype.constructNew = function (items) {
        return new Group(items);
    };
    ;
    Group.prototype.clearItems = function () {
        for (var i = 0; i < this.items.length; i++) {
            this.removeItem(i);
            i--;
        }
    };
    ;
    Group.prototype.removeItem = function (i) {
        var item = this.items[i];
        this.emit('item-will-be-removed', {
            group: this,
            item: item
        });
        this.items.splice(i, 1);
        this.emit('item-removed', {
            group: this,
            item: item
        });
    };
    return Group;
}(event_1.EventEmitter));
var EditGroup = /** @class */ (function (_super) {
    __extends(EditGroup, _super);
    function EditGroup() {
        return _super !== null && _super.apply(this, arguments) || this;
    }
    EditGroup.prototype.getDiffSummary = function () {
        var contentMap = new Map();
        this.getItems().forEach(function (em) {
            var contents = em.getContents();
            _.each(contents, function (info, editorID) {
                contentMap.set(editorID, info);
            });
        });
        var editors = this.getEditorStates();
        var editorMap = new Map();
        editors.forEach(function (ed) {
            editorMap.set(ed.getEditorID(), ed);
        });
        var diffs = [];
        contentMap.forEach(function (info, editorID) {
            var editorState = editorMap.get(editorID);
            var editorTitle = editorState.getTitle();
            var valueBefore = info.valueBefore, valueAfter = info.valueAfter;
            var diff = difflib.unifiedDiff(valueBefore.split('\n'), valueAfter.split('\n'), { fromfile: editorTitle, tofile: editorTitle });
            if (diff.length > 0) {
                diff[0] = diff[0].trim();
            }
            if (diff.length > 1) {
                diff[1] = diff[1].trim();
            }
            diff = diff.join('\n');
            diffs.push({
                editorState: editorState,
                valueBefore: valueBefore,
                valueAfter: valueAfter,
                diff: diff
            });
        });
        return diffs;
    };
    ;
    EditGroup.prototype.getEditorStates = function () {
        var editorStates = _.chain(this.getItems())
            .map(function (delta) { return delta.getEditors(); })
            .flatten()
            .compact()
            .unique()
            .value();
        return editorStates;
    };
    EditGroup.prototype.getAuthors = function () {
        var authors = _.chain(this.getItems())
            .map(function (delta) { return delta.getUsers(); })
            .flatten()
            .compact()
            .unique()
            .value();
        return authors;
    };
    EditGroup.prototype.compatibleWith = function (item) {
        return item instanceof EditMessage;
    };
    ;
    EditGroup.prototype.constructNew = function (items) {
        return new EditGroup(items);
    };
    ;
    return EditGroup;
}(Group));
exports.EditGroup = EditGroup;
/*
 * MessageGroup represents a group of messages that were sent by the same user *around*
 * the same time with no other users interrupting.
 */
var TextMessageGroup = /** @class */ (function (_super) {
    __extends(TextMessageGroup, _super);
    function TextMessageGroup() {
        return _super !== null && _super.apply(this, arguments) || this;
    }
    TextMessageGroup.prototype.getSender = function () { return this.getEarliestItem().getSender(); };
    TextMessageGroup.prototype.compatibleWith = function (item) {
        return item instanceof TextMessage && item.getSender() === this.getSender();
    };
    ;
    TextMessageGroup.prototype.constructNew = function (items) {
        return new TextMessageGroup(items);
    };
    ;
    TextMessageGroup.prototype.getEditorVersion = function () {
        return this.getLatestItem().getEditorVersion();
    };
    ;
    return TextMessageGroup;
}(Group));
exports.TextMessageGroup = TextMessageGroup;
;
var ConnectionMessageGroup = /** @class */ (function (_super) {
    __extends(ConnectionMessageGroup, _super);
    function ConnectionMessageGroup() {
        return _super !== null && _super.apply(this, arguments) || this;
    }
    ConnectionMessageGroup.prototype.isConnect = function () { return this.getEarliestItem().isConnect(); };
    ConnectionMessageGroup.prototype.isDisconnect = function () { return this.getEarliestItem().isDisconnect(); };
    ConnectionMessageGroup.prototype.compatibleWith = function (item) {
        return (item instanceof ConnectionMessage) && ((this.isConnect() && item.isConnect()) || (this.isDisconnect() && item.isDisconnect()));
    };
    ;
    ConnectionMessageGroup.prototype.constructNew = function (items) {
        return new ConnectionMessageGroup(items);
    };
    ;
    ConnectionMessageGroup.prototype.getUsers = function () {
        var users = this.getItems().map(function (cm) { return cm.getUser(); });
        return _.unique(users);
    };
    return ConnectionMessageGroup;
}(Group));
exports.ConnectionMessageGroup = ConnectionMessageGroup;
;
/*
 * A class to keep track of all of the messages in a conversation (where messages are grouped).
 */
var MessageGroups = /** @class */ (function (_super) {
    __extends(MessageGroups, _super);
    function MessageGroups(channelService, chatUserList, editorStateTracker) {
        var _this = _super.call(this) || this;
        _this.channelService = channelService;
        _this.chatUserList = chatUserList;
        _this.editorStateTracker = editorStateTracker;
        _this.messageGroupingTimeThreshold = 5 * 60 * 1000; // The delay between when messages should be in separate groups (5 minutes)
        _this.messageGroups = [];
        _this.chatDocPromise = _this.channelService.getShareDBChat();
        _this.ready = Promise.all([_this.chatDocPromise, _this.chatUserList.ready, editorStateTracker.ready]).then(function (info) {
            var doc = info[0];
            doc.data['messages'].forEach(function (li) {
                _this.addFromSerializedMessage(li);
            });
            doc.on('op', function (ops, source) {
                ops.forEach(function (op) {
                    var p = op.p, li = op.li, ld = op.ld;
                    var field = p[0];
                    if (field === 'messages') {
                        var messageGroups = _this.getMessageGroups();
                        var lastMessageGroup = _.last(messageGroups);
                        if (ld && !_.isEmpty(ld) && lastMessageGroup instanceof EditGroup) {
                            lastMessageGroup.addItem(_this.createMessage(li));
                            lastMessageGroup.removeItem(0);
                        }
                        else if (li) {
                            _this.addFromSerializedMessage(li);
                        }
                    }
                });
            });
        });
        return _this;
    }
    ;
    MessageGroups.prototype.createMessage = function (li) {
        var _this = this;
        if (!_.has(li, 'type')) {
            return null;
        }
        var type = li.type;
        if (type === 'text') {
            var sender = this.chatUserList.getUser(li.uid);
            return new TextMessage(sender, li.timestamp, li.message, li.editorsVersion, this.editorStateTracker);
        }
        else if (type === 'join') {
            var user = this.chatUserList.getUser(li.uid);
            return new ConnectionMessage(user, li.timestamp, ConnectionAction.connect);
        }
        else if (type === 'left') {
            var user = this.chatUserList.getUser(li.uid);
            return new ConnectionMessage(user, li.timestamp, ConnectionAction.disconnect);
        }
        else if (type === 'edit') {
            var users = li.users.map(function (uid) { return _this.chatUserList.getUser(uid); });
            var editors = li.files.map(function (eid) { return _this.editorStateTracker.getEditorState(eid); });
            return new EditMessage(users, editors, li.endTimestamp, li.fileContents);
        }
        else {
            console.error(type);
            return null;
        }
    };
    MessageGroups.prototype.addFromSerializedMessage = function (li) {
        var message = this.createMessage(li);
        if (message) {
            return this.addItem(message);
        }
    };
    MessageGroups.prototype.typeMatches = function (item, group) {
        return (group instanceof EditGroup && item instanceof EditMessage) ||
            (group instanceof TextMessageGroup && item instanceof TextMessage) ||
            (group instanceof ConnectionMessageGroup && item instanceof ConnectionMessage);
    };
    MessageGroups.prototype.addItem = function (item) {
        var _this = this;
        var itemTimestamp = item.getTimestamp();
        var insertedIntoExistingGroup = false;
        var i = this.messageGroups.length - 1;
        for (; i >= 0; i--) {
            var messageGroup = this.messageGroups[i];
            if (messageGroup.includesTimestamp(itemTimestamp)) {
                if (messageGroup.compatibleWith(item)) {
                    messageGroup.addItem(item);
                    insertedIntoExistingGroup = true;
                    break;
                }
                else {
                    this.emit('group-will-be-removed', {
                        messageGroup: messageGroup,
                        insertionIndex: i
                    });
                    this.messageGroups.splice(i, 1);
                    this.emit('group-removed', {
                        messageGroup: messageGroup,
                        insertionIndex: i
                    });
                    var splitGroup = messageGroup.split(itemTimestamp);
                    splitGroup.forEach(function (mg, j) {
                        _this.addGroup(mg, i + j);
                    });
                    i += splitGroup.length; // on the next loop, will be at the later split
                    continue;
                }
            }
            else if (messageGroup.occuredBefore(itemTimestamp)) {
                if (messageGroup.compatibleWith(item) && (itemTimestamp <= messageGroup.getEarliestTimestamp() + this.messageGroupingTimeThreshold)) {
                    messageGroup.addItem(item);
                    insertedIntoExistingGroup = true;
                }
                break;
            }
        }
        if (!insertedIntoExistingGroup) {
            var insertionIndex = i + 1;
            var group = void 0;
            if (item instanceof TextMessage) {
                group = new TextMessageGroup([item]);
            }
            else if (item instanceof ConnectionMessage) {
                group = new ConnectionMessageGroup([item]);
            }
            else {
                group = new EditGroup([item]);
            }
            this.addGroup(group, insertionIndex);
        }
    };
    MessageGroups.prototype.addGroup = function (group, insertionIndex) {
        var _this = this;
        this.emit('group-will-be-added', {
            messageGroup: group,
            insertionIndex: insertionIndex
        });
        this.messageGroups.splice(insertionIndex, 0, group);
        this.emit('group-added', {
            messageGroup: group,
            insertionIndex: insertionIndex
        });
        group.on('item-will-be-added', function (event) {
            _this.emit('item-will-be-added', event);
        });
        group.on('item-added', function (event) {
            _this.emit('item-added', event);
        });
        group.on('item-will-be-removed', function (event) {
            _this.emit('item-will-be-removed', event);
        });
        group.on('item-removed', function (event) {
            _this.emit('item-removed', event);
        });
    };
    MessageGroups.prototype.getMessageGroups = function () { return this.messageGroups; };
    /**
     * Returns true if there are no messages and false otherwise
     * @return {boolean} If there are no messages
     */
    MessageGroups.prototype.isEmpty = function () {
        return this.messageGroups.length === 0;
    };
    return MessageGroups;
}(event_1.EventEmitter));
exports.MessageGroups = MessageGroups;
//# sourceMappingURL=chat-messages.js.map