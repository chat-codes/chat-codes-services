"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
//<reference path="./typings/node/node.d.ts" />
const _ = require("underscore");
const FuzzySet = require("fuzzyset.js");
const events_1 = require("events");
const ShareDB = require("sharedb/lib/client");
const otText = require("ot-text");
ShareDB.types.map['json0'].registerSubtype(otText.type);
;
const CURRENT = -1;
/*
 * Tracks a set of remote cursors.
 */
class RemoteCursorMarker extends events_1.EventEmitter {
    constructor(editorState) {
        super();
        this.editorState = editorState;
        this.cursors = new Map();
    }
    updateCursor(id, user, pos) {
        if (!user.getIsMe()) {
            let cursor;
            if (this.cursors.has(id)) {
                cursor = this.cursors.get(id);
            }
            else {
                cursor = { id: id, user: user };
                this.cursors.set(id, cursor);
                this.editorState.getEditorWrapper().addRemoteCursor(cursor, this);
            }
            const oldPos = cursor.pos;
            cursor.pos = pos;
            if (oldPos) {
                this.editorState.getEditorWrapper().updateRemoteCursorPosition(cursor, this);
            }
            else {
                this.editorState.getEditorWrapper().addRemoteCursorPosition(cursor, this);
            }
        }
    }
    ;
    updateSelection(id, user, range) {
        if (!user.getIsMe()) {
            let cursor;
            if (this.cursors.has(id)) {
                cursor = this.cursors.get(id);
            }
            else {
                cursor = { id: id, user: user };
                this.cursors.set(id, { id: id, user: user });
                this.editorState.getEditorWrapper().addRemoteCursor(cursor, this);
            }
            const oldRange = cursor.range;
            cursor.range = range;
            if (oldRange) {
                this.editorState.getEditorWrapper().updateRemoteCursorSelection(cursor, this);
            }
            else {
                this.editorState.getEditorWrapper().addRemoteCursorSelection(cursor, this);
            }
        }
    }
    ;
    removeCursor(id, user) {
        if (this.cursors.has(id)) {
            this.editorState.getEditorWrapper().removeRemoteCursor(this.cursors.get(id), this);
            this.cursors.delete(id);
        }
    }
    getCursors() {
        return Array.from(this.cursors.values());
    }
    serialize() {
        return {
            cursors: this.cursors
        };
    }
    removeUserCursors(user) {
        this.cursors.forEach((cursor, id) => {
            if (cursor.user.id === user.id) {
                this.removeCursor(id, user);
            }
        });
    }
    hideCursors() {
        this.editorState.getEditorWrapper().hideRemoteCursors();
    }
    showCursors() {
        this.editorState.getEditorWrapper().showRemoteCursors(this);
    }
}
exports.RemoteCursorMarker = RemoteCursorMarker;
class EditorState {
    constructor(suppliedState, editorWrapper, userList, mustPerformChange) {
        this.editorWrapper = editorWrapper;
        this.userList = userList;
        this.selections = {};
        this.remoteCursors = new RemoteCursorMarker(this);
        this.deltaPointer = -1;
        this.currentVersion = CURRENT;
        let state = _.extend({
            isOpen: true,
            deltas: [],
            cursors: []
        }, suppliedState);
        this.isOpen = state.isOpen;
        this.title = state.title;
        this.editorWrapper.setEditorState(this);
        this.editorWrapper.setGrammar(state.grammarName);
        this.editorID = state.id;
        state.cursors.forEach((c) => { });
    }
    setTitle(newTitle) { this.title = newTitle; }
    ;
    setIsOpen(val) { this.isOpen = val; }
    ;
    setIsModified(val) { this.modified = val; }
    ;
    getEditorWrapper() { return this.editorWrapper; }
    ;
    getTitle() { return this.title; }
    ;
    getIsOpen() { return this.isOpen; }
    ;
    getRemoteCursors() { return this.remoteCursors; }
    ;
    getEditorID() { return this.editorID; }
    ;
    getIsModified() { return this.modified; }
    ;
    setText(val) {
        this.editorWrapper.setText(val);
    }
    addHighlight(range, extraInfo) {
        return this.getEditorWrapper().addHighlight(range, extraInfo);
    }
    removeHighlight(highlightID, extraInfo) {
        return this.getEditorWrapper().removeHighlight(highlightID, extraInfo);
    }
    focus(range, extraInfo) {
        return this.getEditorWrapper().focus(range, extraInfo);
    }
    removeUserCursors(user) {
        this.remoteCursors.removeUserCursors(user);
    }
    getCurrentVersion() { return this.currentVersion; }
    setVersion(version, extraInfo) {
        this.currentVersion = version;
        const editorWrapper = this.getEditorWrapper();
        if (this.isLatestVersion()) {
            editorWrapper.resumeEditorBinding();
            editorWrapper.setReadOnly(false, extraInfo);
            this.remoteCursors.showCursors();
        }
        else {
            editorWrapper.suspendEditorBinding();
            editorWrapper.setReadOnly(true, extraInfo);
            this.remoteCursors.hideCursors();
        }
    }
    isLatestVersion() {
        return this.getCurrentVersion() === CURRENT;
    }
    ;
}
exports.EditorState = EditorState;
class EditorStateTracker extends events_1.EventEmitter {
    constructor(EditorWrapperClass, channelCommunicationService, userList) {
        super();
        this.EditorWrapperClass = EditorWrapperClass;
        this.channelCommunicationService = channelCommunicationService;
        this.userList = userList;
        this.editorStates = new Map();
        this.currentVersion = CURRENT;
        this.currentTimestamp = CURRENT;
        this.channelCommunicationService.getShareDBEditors().then((editorDoc) => {
            editorDoc.data.forEach((li) => {
                this.onEditorOpened(li, true);
            });
            editorDoc.on('op', (ops) => {
                ops.forEach((op) => {
                    const { p } = op;
                    if (p.length === 1) {
                        if (_.has(op, 'li')) {
                            const { li } = op;
                            this.onEditorOpened(li, true);
                        }
                    }
                });
            });
        });
        this.channelCommunicationService.getShareDBCursors().then((cursorsDoc) => {
            _.each(cursorsDoc.data, (cursorInfo, editorID) => {
                const editor = this.getEditorState(editorID);
                if (editor) {
                    const remoteCursors = editor.getRemoteCursors();
                    _.each(cursorInfo['userCursors'], (cursorInfo, userID) => {
                        const { newBufferPosition } = cursorInfo;
                        const user = this.userList.getUser(userID);
                        if (user) {
                            remoteCursors.updateCursor(user.getID(), user, newBufferPosition);
                        }
                    });
                    _.each(cursorInfo['userSelections'], (selectionInfo, userID) => {
                        const { newRange } = selectionInfo;
                        const user = this.userList.getUser(userID);
                        if (user) {
                            remoteCursors.updateSelection(user.getID(), user, newRange);
                        }
                    });
                }
            });
            cursorsDoc.on('op', (ops) => {
                ops.forEach((op) => {
                    const { p, oi, od } = op;
                    const editorID = p[0];
                    const editor = this.getEditorState(editorID);
                    if (editor) {
                        const remoteCursors = editor.getRemoteCursors();
                        if (p.length === 3) {
                            const isUserCursor = p[1] === 'userCursors';
                            const isUserSelection = p[1] === 'userSelections';
                            const userID = p[2];
                            const user = this.userList.getUser(userID);
                            if (oi) {
                                if (isUserCursor) {
                                    remoteCursors.updateCursor(user.getID(), user, oi['newBufferPosition']);
                                }
                                else if (isUserSelection) {
                                    remoteCursors.updateSelection(user.getID(), user, oi['newRange']);
                                }
                            }
                            else if (od) {
                                remoteCursors.removeUserCursors(user);
                            }
                        }
                        else if (p.length === 1) {
                            _.each(cursorsDoc.data[editorID]['userCursors'], (cursorInfo, userID) => {
                                const { newBufferPosition } = cursorInfo;
                                const user = this.userList.getUser(userID);
                                remoteCursors.updateCursor(user.getID(), user, newBufferPosition);
                            });
                            _.each(cursorsDoc.data[editorID]['userSelections'], (selectionInfo, userID) => {
                                const { newRange } = selectionInfo;
                                const user = this.userList.getUser(userID);
                                remoteCursors.updateSelection(user.getID(), user, newRange);
                            });
                        }
                    }
                    else {
                        console.error(`Could not find editor ${editorID}`);
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
    }
    createEditor(id, title, contents, grammarName, modified) {
        return this.channelCommunicationService.getShareDBEditors().then((editorDoc) => {
            const data = { title, id, contents, grammarName, modified, userCursors: {}, userSelections: {} };
            return new Promise((resolve, reject) => {
                editorDoc.submitOp({ p: [editorDoc.data.length], li: data }, (err) => {
                    if (err) {
                        reject(err);
                    }
                    resolve(data);
                });
            });
        }).then((data) => {
            return this.onEditorOpened(data, true);
        });
    }
    getAllEditors() {
        return Array.from(this.editorStates.values());
    }
    getEditorState(editorID) {
        if (this.editorStates.has(editorID)) {
            return this.editorStates.get(editorID);
        }
        else {
            return null;
        }
    }
    getActiveEditors() {
        const rv = _.filter(this.getAllEditors(), s => s.getIsOpen());
        return rv;
    }
    onEditorOpened(state, mustPerformChange) {
        const { id } = state;
        if (this.editorStates.has(id)) {
            return this.editorStates.get(id);
        }
        else {
            const editorState = new EditorState(state, new this.EditorWrapperClass(state, this.channelCommunicationService), this.userList, mustPerformChange);
            this.editorStates.set(id, editorState);
            return editorState;
        }
    }
    removeUserCursors(user) {
        this.editorStates.forEach((es) => {
            es.removeUserCursors(user);
        });
    }
    addHighlight(editorID, range, version, timestamp, extraInfo = {}) {
        const editorState = this.getEditorState(editorID);
        this.setVersion(version, timestamp, extraInfo);
        if (editorState) {
            return editorState.addHighlight(range, extraInfo);
        }
        else {
            return -1;
        }
    }
    removeHighlight(editorID, highlightID, extraInfo = {}) {
        const editorState = this.getEditorState(editorID);
        if (editorState) {
            return editorState.removeHighlight(highlightID, extraInfo);
        }
        else {
            return false;
        }
    }
    focus(editorID, range, version, timestamp, extraInfo = {}) {
        const editorState = this.getEditorState(editorID);
        this.setVersion(version, timestamp, extraInfo);
        if (editorState) {
            return editorState.focus(range, extraInfo);
        }
        else {
            return false;
        }
    }
    fuzzyMatch(query) {
        const editors = this.getAllEditors();
        const editorTitleSet = new FuzzySet(_.map(editors, (e) => e.getTitle()));
        const matches = editorTitleSet.get(query);
        if (matches) {
            const bestTitleMatch = matches[0][1];
            const matchingTitles = _.filter(this.getAllEditors(), (es) => es.getTitle() === bestTitleMatch);
            if (matchingTitles.length > 0) {
                return matchingTitles[0];
            }
        }
        return null;
    }
    ;
    getCurrentTimestamp() {
        return this.currentTimestamp;
    }
    ;
    getCurrentVersion() {
        return this.currentVersion;
    }
    ;
    isAtLatest() {
        return this.getCurrentVersion() === CURRENT;
    }
    setVersion(version, timestamp, extraInfo) {
        if (version === CURRENT) {
            this.currentVersion = version;
            this.currentTimestamp = timestamp;
            _.each(this.getAllEditors(), (e) => {
                e.setVersion(this.currentVersion, extraInfo);
            });
            this.emit('timestampChanged', {
                version: this.currentVersion
            });
        }
        else {
            this.channelCommunicationService.getEditorVersion(version).then((data) => {
                this.currentVersion = version;
                this.currentTimestamp = timestamp;
                _.each(this.getAllEditors(), (e) => {
                    const stateInfo = data.get(e.getEditorID());
                    const value = stateInfo ? stateInfo.contents : '';
                    e.setVersion(this.currentVersion, extraInfo);
                    e.setText(value);
                });
                this.emit('timestampChanged', {
                    version: this.currentVersion
                });
            });
        }
    }
    toLatestVersion(extraInfo) {
        this.setVersion(CURRENT, CURRENT, extraInfo);
    }
}
exports.EditorStateTracker = EditorStateTracker;
//# sourceMappingURL=editor-state-tracker.js.map