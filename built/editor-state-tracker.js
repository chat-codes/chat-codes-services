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
var FuzzySet = require("fuzzyset.js");
var event_1 = require("./event");
var ShareDB = require("sharedb/lib/client");
var otText = require("ot-text");
ShareDB.types.map['json0'].registerSubtype(otText.type);
;
var CURRENT = -1;
/*
 * Tracks a set of remote cursors.
 */
var RemoteCursorMarker = /** @class */ (function (_super) {
    __extends(RemoteCursorMarker, _super);
    function RemoteCursorMarker(editorState) {
        var _this = _super.call(this) || this;
        _this.editorState = editorState;
        _this.cursors = new Map();
        return _this;
    }
    RemoteCursorMarker.prototype.updateCursor = function (id, user, pos) {
        if (!user.getIsMe()) {
            var cursor = void 0;
            if (this.cursors.has(id)) {
                cursor = this.cursors.get(id);
            }
            else {
                cursor = { id: id, user: user };
                this.cursors.set(id, cursor);
                this.editorState.getEditorWrapper().addRemoteCursor(cursor, this);
            }
            var oldPos = cursor.pos;
            cursor.pos = pos;
            if (oldPos) {
                this.editorState.getEditorWrapper().updateRemoteCursorPosition(cursor, this);
            }
            else {
                this.editorState.getEditorWrapper().addRemoteCursorPosition(cursor, this);
            }
        }
    };
    ;
    RemoteCursorMarker.prototype.updateSelection = function (id, user, range) {
        if (!user.getIsMe()) {
            var cursor = void 0;
            if (this.cursors.has(id)) {
                cursor = this.cursors.get(id);
            }
            else {
                cursor = { id: id, user: user };
                this.cursors.set(id, { id: id, user: user });
                this.editorState.getEditorWrapper().addRemoteCursor(cursor, this);
            }
            var oldRange = cursor.range;
            cursor.range = range;
            if (oldRange) {
                this.editorState.getEditorWrapper().updateRemoteCursorSelection(cursor, this);
            }
            else {
                this.editorState.getEditorWrapper().addRemoteCursorSelection(cursor, this);
            }
        }
    };
    ;
    RemoteCursorMarker.prototype.removeCursor = function (id, user) {
        if (this.cursors.has(id)) {
            this.editorState.getEditorWrapper().removeRemoteCursor(this.cursors.get(id), this);
            this.cursors.delete(id);
        }
    };
    RemoteCursorMarker.prototype.getCursors = function () {
        return Array.from(this.cursors.values());
    };
    RemoteCursorMarker.prototype.serialize = function () {
        return {
            cursors: this.cursors
        };
    };
    RemoteCursorMarker.prototype.removeUserCursors = function (user) {
        var _this = this;
        this.cursors.forEach(function (cursor, id) {
            if (cursor.user.id === user.id) {
                _this.removeCursor(id, user);
            }
        });
    };
    RemoteCursorMarker.prototype.hideCursors = function () {
        this.editorState.getEditorWrapper().hideRemoteCursors();
    };
    RemoteCursorMarker.prototype.showCursors = function () {
        this.editorState.getEditorWrapper().showRemoteCursors(this);
    };
    return RemoteCursorMarker;
}(event_1.EventEmitter));
exports.RemoteCursorMarker = RemoteCursorMarker;
var EditorState = /** @class */ (function () {
    function EditorState(suppliedState, editorWrapper, userList, isObserver) {
        var _this = this;
        this.editorWrapper = editorWrapper;
        this.userList = userList;
        this.isObserver = isObserver;
        this.selections = {};
        this.remoteCursors = new RemoteCursorMarker(this);
        this.deltaPointer = -1;
        this.currentVersion = CURRENT;
        var state = _.extend({
            isOpen: true,
            deltas: [],
            cursors: []
        }, suppliedState);
        this.isOpen = state.isOpen;
        this.title = state.title;
        this.editorWrapper.setEditorState(this);
        setTimeout(function () {
            _this.editorWrapper.setGrammar(state.grammarName);
        }, 100);
        this.editorID = state.id;
        state.cursors.forEach(function (c) { });
    }
    EditorState.prototype.setTitle = function (newTitle) { this.title = newTitle; };
    ;
    EditorState.prototype.setIsOpen = function (val) { this.isOpen = val; };
    ;
    EditorState.prototype.setIsModified = function (val) { this.modified = val; };
    ;
    EditorState.prototype.getEditorWrapper = function () { return this.editorWrapper; };
    ;
    EditorState.prototype.getTitle = function () { return this.title; };
    ;
    EditorState.prototype.getIsOpen = function () { return this.isOpen; };
    ;
    EditorState.prototype.getRemoteCursors = function () { return this.remoteCursors; };
    ;
    EditorState.prototype.getEditorID = function () { return this.editorID; };
    ;
    EditorState.prototype.getIsModified = function () { return this.modified; };
    ;
    EditorState.prototype.setText = function (val) {
        this.editorWrapper.setText(val);
    };
    EditorState.prototype.addHighlight = function (range, extraInfo) {
        return this.getEditorWrapper().addHighlight(range, extraInfo);
    };
    EditorState.prototype.removeHighlight = function (highlightID, extraInfo) {
        return this.getEditorWrapper().removeHighlight(highlightID, extraInfo);
    };
    EditorState.prototype.focus = function (range, extraInfo) {
        return this.getEditorWrapper().focus(range, extraInfo);
    };
    EditorState.prototype.removeUserCursors = function (user) {
        this.remoteCursors.removeUserCursors(user);
    };
    EditorState.prototype.getCurrentVersion = function () { return this.currentVersion; };
    EditorState.prototype.setVersion = function (version, extraInfo) {
        this.currentVersion = version;
        var editorWrapper = this.getEditorWrapper();
        if (this.isLatestVersion()) {
            editorWrapper.resumeEditorBinding();
            editorWrapper.setReadOnly(false, extraInfo);
            this.remoteCursors.showCursors();
        }
        else {
            editorWrapper.suspendEditorBinding();
            if (this.isObserver) {
                editorWrapper.setReadOnly(false, extraInfo);
            }
            else {
                editorWrapper.setReadOnly(true, extraInfo);
            }
            this.remoteCursors.hideCursors();
        }
    };
    EditorState.prototype.isLatestVersion = function () {
        return this.getCurrentVersion() === CURRENT;
    };
    ;
    return EditorState;
}());
exports.EditorState = EditorState;
var EditorStateTracker = /** @class */ (function (_super) {
    __extends(EditorStateTracker, _super);
    function EditorStateTracker(EditorWrapperClass, channelCommunicationService, userList, isObserver) {
        var _this = _super.call(this) || this;
        _this.EditorWrapperClass = EditorWrapperClass;
        _this.channelCommunicationService = channelCommunicationService;
        _this.userList = userList;
        _this.isObserver = isObserver;
        _this.editorStates = new Map();
        _this.currentVersion = CURRENT;
        _this.currentTimestamp = CURRENT;
        var editorsDocPromise = _this.channelCommunicationService.getShareDBEditors().then(function (editorDoc) {
            editorDoc.data.forEach(function (li) {
                _this.onEditorOpened(li, true);
            });
            editorDoc.on('op', function (ops) {
                ops.forEach(function (op) {
                    var p = op.p;
                    if (p.length === 1) {
                        if (_.has(op, 'li')) {
                            var li = op.li;
                            _this.onEditorOpened(li, true);
                        }
                    }
                });
            });
        });
        var cursorsDocPromise = _this.channelCommunicationService.getShareDBCursors().then(function (cursorsDoc) {
            _.each(cursorsDoc.data, function (cursorInfo, editorID) {
                var editor = _this.getEditorState(editorID);
                if (editor) {
                    var remoteCursors_1 = editor.getRemoteCursors();
                    _.each(cursorInfo['userCursors'], function (cursorInfo, userID) {
                        var newBufferPosition = cursorInfo.newBufferPosition;
                        var user = _this.userList.getUser(userID);
                        if (user) {
                            remoteCursors_1.updateCursor(user.getID(), user, newBufferPosition);
                        }
                    });
                    _.each(cursorInfo['userSelections'], function (selectionInfo, userID) {
                        var newRange = selectionInfo.newRange;
                        var user = _this.userList.getUser(userID);
                        if (user) {
                            remoteCursors_1.updateSelection(user.getID(), user, newRange);
                        }
                    });
                }
            });
            cursorsDoc.on('op', function (ops) {
                ops.forEach(function (op) {
                    var p = op.p, oi = op.oi, od = op.od;
                    var editorID = p[0];
                    var editor = _this.getEditorState(editorID);
                    if (editor) {
                        var remoteCursors_2 = editor.getRemoteCursors();
                        if (p.length === 3) {
                            var isUserCursor = p[1] === 'userCursors';
                            var isUserSelection = p[1] === 'userSelections';
                            var userID = p[2];
                            var user = _this.userList.getUser(userID);
                            if (oi) {
                                if (isUserCursor) {
                                    remoteCursors_2.updateCursor(user.getID(), user, oi['newBufferPosition']);
                                }
                                else if (isUserSelection) {
                                    remoteCursors_2.updateSelection(user.getID(), user, oi['newRange']);
                                }
                            }
                            else if (od) {
                                remoteCursors_2.removeUserCursors(user);
                            }
                        }
                        else if (p.length === 1) {
                            _.each(cursorsDoc.data[editorID]['userCursors'], function (cursorInfo, userID) {
                                var newBufferPosition = cursorInfo.newBufferPosition;
                                var user = _this.userList.getUser(userID);
                                remoteCursors_2.updateCursor(user.getID(), user, newBufferPosition);
                            });
                            _.each(cursorsDoc.data[editorID]['userSelections'], function (selectionInfo, userID) {
                                var newRange = selectionInfo.newRange;
                                var user = _this.userList.getUser(userID);
                                remoteCursors_2.updateSelection(user.getID(), user, newRange);
                            });
                        }
                    }
                    else {
                        console.error("Could not find editor " + editorID);
                    }
                });
            });
            // if(p.length === 3) {
            // 	const editorID = editorDoc.data[p[0]]['id'];
            // 	const editor = this.getEditorState(editorID);
            // 	const isUserCursor:boolean = p[1] === 'userCursors';
            // 	const isUserSelection:boolean = p[1] === 'userSelections';
            //
            // 	if(isUserCursor || isUserSelection) {
            // 		const remoteCursors = editor.getRemoteCursors();
            // 		const userID:string = p[2];
            // 		const user = this.userList.getUser(userID);
            // 		const {oi, od} = op;
            // 		if(oi) {
            // 			if(isUserCursor) {
            // 				remoteCursors.updateCursor(user.getID(), user, oi.newBufferPosition);
            // 			} else if(isUserSelection) {
            // 				remoteCursors.updateSelection(user.getID(), user, oi.newRange);
            // 			}
            // 		} else if(od) {
            // 			remoteCursors.removeUserCursors(user);
            // 		}
            // 	}
            // }
        });
        _this.ready = Promise.all([editorsDocPromise, cursorsDocPromise]).then(function () {
            return true;
        });
        return _this;
    }
    EditorStateTracker.prototype.createEditor = function (id, title, contents, grammarName, modified) {
        var _this = this;
        return this.channelCommunicationService.getShareDBEditors().then(function (editorDoc) {
            var data = { title: title, id: id, contents: contents, grammarName: grammarName, modified: modified, userCursors: {}, userSelections: {} };
            return new Promise(function (resolve, reject) {
                editorDoc.submitOp({ p: [editorDoc.data.length], li: data }, function (err) {
                    if (err) {
                        reject(err);
                    }
                    resolve(data);
                });
            });
        }).then(function (data) {
            return _this.onEditorOpened(data, true);
        });
    };
    EditorStateTracker.prototype.getAllEditors = function () {
        return Array.from(this.editorStates.values());
    };
    EditorStateTracker.prototype.getEditorState = function (editorID) {
        if (this.editorStates.has(editorID)) {
            return this.editorStates.get(editorID);
        }
        else {
            return null;
        }
    };
    EditorStateTracker.prototype.getActiveEditors = function () {
        var rv = _.filter(this.getAllEditors(), function (s) { return s.getIsOpen(); });
        return rv;
    };
    EditorStateTracker.prototype.onEditorOpened = function (state, mustPerformChange) {
        var id = state.id;
        if (this.editorStates.has(id)) {
            return this.editorStates.get(id);
        }
        else {
            var editorState = new EditorState(state, new this.EditorWrapperClass(state, this.channelCommunicationService), this.userList, this.isObserver);
            this.editorStates.set(id, editorState);
            return editorState;
        }
    };
    EditorStateTracker.prototype.removeUserCursors = function (user) {
        this.editorStates.forEach(function (es) {
            es.removeUserCursors(user);
        });
    };
    EditorStateTracker.prototype.addHighlight = function (editorID, range, version, timestamp, extraInfo) {
        if (extraInfo === void 0) { extraInfo = {}; }
        var editorState = this.getEditorState(editorID);
        this.setVersion(version, timestamp, extraInfo);
        if (editorState) {
            return editorState.addHighlight(range, extraInfo);
        }
        else {
            return -1;
        }
    };
    EditorStateTracker.prototype.removeHighlight = function (editorID, highlightID, extraInfo) {
        if (extraInfo === void 0) { extraInfo = {}; }
        var editorState = this.getEditorState(editorID);
        if (editorState) {
            return editorState.removeHighlight(highlightID, extraInfo);
        }
        else {
            return false;
        }
    };
    EditorStateTracker.prototype.focus = function (editorID, range, version, timestamp, extraInfo) {
        if (extraInfo === void 0) { extraInfo = {}; }
        var editorState = this.getEditorState(editorID);
        this.setVersion(version, timestamp, extraInfo);
        if (editorState) {
            return editorState.focus(range, extraInfo);
        }
        else {
            return false;
        }
    };
    EditorStateTracker.prototype.fuzzyMatch = function (query) {
        var editors = this.getAllEditors();
        var editorTitleSet = new FuzzySet(_.map(editors, function (e) { return e.getTitle(); }));
        var matches = editorTitleSet.get(query);
        if (matches) {
            var bestTitleMatch_1 = matches[0][1];
            var matchingTitles = _.filter(this.getAllEditors(), function (es) { return es.getTitle() === bestTitleMatch_1; });
            if (matchingTitles.length > 0) {
                return matchingTitles[0];
            }
        }
        return null;
    };
    ;
    EditorStateTracker.prototype.getCurrentTimestamp = function () {
        return this.currentTimestamp;
    };
    ;
    EditorStateTracker.prototype.getCurrentVersion = function () {
        return this.currentVersion;
    };
    ;
    EditorStateTracker.prototype.isAtLatest = function () {
        return this.getCurrentVersion() === CURRENT;
    };
    EditorStateTracker.prototype.setVersion = function (version, timestamp, extraInfo) {
        var _this = this;
        if (version === CURRENT) {
            this.currentVersion = version;
            this.currentTimestamp = timestamp;
            _.each(this.getAllEditors(), function (e) {
                e.setVersion(_this.currentVersion, extraInfo);
            });
            this.emit('timestampChanged', {
                version: this.currentVersion
            });
        }
        else {
            this.channelCommunicationService.getEditorVersion(version).then(function (data) {
                _this.currentVersion = version;
                _this.currentTimestamp = timestamp;
                _.each(_this.getAllEditors(), function (e) {
                    var stateInfo = data.get(e.getEditorID());
                    var value = stateInfo ? stateInfo.contents : '';
                    e.setVersion(_this.currentVersion, extraInfo);
                    e.setText(value);
                });
                _this.emit('timestampChanged', {
                    version: _this.currentVersion
                });
            });
        }
    };
    EditorStateTracker.prototype.toLatestVersion = function (extraInfo) {
        this.setVersion(CURRENT, CURRENT, extraInfo);
    };
    return EditorStateTracker;
}(event_1.EventEmitter));
exports.EditorStateTracker = EditorStateTracker;
//# sourceMappingURL=editor-state-tracker.js.map