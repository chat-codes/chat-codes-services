"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const _ = require("underscore");
const events_1 = require("events");
// import {RemoteCursorMarker} from './remote_cursor_marker';
class RemoteCursorMarker extends events_1.EventEmitter {
    constructor(editorState) {
        super();
        this.editorState = editorState;
        this.cursors = {};
    }
    updateCursor(id, user, pos) {
        if (this.cursors[id]) {
            this.cursors[id].pos = pos;
            this.editorState.getEditorWrapper().updateRemoteCursorPosition(this.cursors[id], this);
        }
        else {
            this.cursors[id] = { id: id, user: user, pos: pos };
            this.editorState.getEditorWrapper().addRemoteCursor(this.cursors[id], this);
        }
    }
    ;
    updateSelection(id, user, range) {
        if (this.cursors[id]) {
            this.cursors[id].range = range;
            this.editorState.getEditorWrapper().updateRemoteCursorSelection(this.cursors[id], this);
        }
        else {
            this.cursors[id] = { id: id, user: user, range: range };
            this.editorState.getEditorWrapper().addRemoteCursor(this.cursors[id], this);
        }
    }
    ;
    removeCursor(id, user) {
        if (this.cursors[id]) {
            this.editorState.getEditorWrapper().removeRemoteCursor(this.cursors[id], this);
        }
    }
    getCursors() {
        return this.cursors;
    }
    serialize() {
        return {
            cursors: this.cursors
        };
    }
}
exports.RemoteCursorMarker = RemoteCursorMarker;
class TitleDelta {
    constructor(serializedState) {
        this.serializedState = serializedState;
        this.oldTitle = serializedState.oldTitle;
        this.newTitle = serializedState.newTitle;
        this.timestamp = serializedState.timestamp;
    }
    getTimestamp() { return this.timestamp; }
    ;
    doAction(editorState) {
        editorState.setTitle(this.newTitle);
    }
    undoAction(editorState) {
        editorState.setTitle(this.oldTitle);
    }
    serialize() {
        return this.serializedState;
    }
}
class GrammarDelta {
    constructor(serializedState) {
        this.serializedState = serializedState;
        this.oldGrammarName = serializedState.oldGrammarName;
        this.newGrammarName = serializedState.newGrammarName;
        this.timestamp = serializedState.timestamp;
    }
    getTimestamp() { return this.timestamp; }
    ;
    doAction(editorState) {
        const editorWrapper = editorState.getEditorWrapper();
        editorWrapper.setGrammar(this.newGrammarName);
    }
    undoAction(editorState) {
        const editorWrapper = editorState.getEditorWrapper();
        editorWrapper.setGrammar(this.oldGrammarName);
    }
    serialize() { return this.serializedState; }
}
class EditChange {
    constructor(serializedState) {
        this.serializedState = serializedState;
        this.oldRange = serializedState.oldRange;
        this.newRange = serializedState.newRange;
        this.oldText = serializedState.oldText;
        this.newText = serializedState.newText;
    }
    getTimestamp() { return this.timestamp; }
    ;
    doAction(editorState) {
        const editorWrapper = editorState.getEditorWrapper();
        this.updateRanges(editorState);
        editorWrapper.replaceText(this.oldRange, this.newText);
    }
    undoAction(editorState) {
        const editorWrapper = editorState.getEditorWrapper();
        editorWrapper.replaceText(this.newRange, this.oldText);
    }
    addAnchor(editorState) {
        const editorWrapper = editorState.getEditorWrapper();
        this.oldRangeAnchor = editorWrapper.getAnchor(this.oldRange);
        this.newRangeAnchor = editorWrapper.getAnchor(this.newRange);
    }
    updateRanges(editorState) {
        const editorWrapper = editorState.getEditorWrapper();
        this.oldRange = editorWrapper.getCurrentAnchorPosition(this.oldRangeAnchor);
        this.newRange = editorWrapper.getCurrentAnchorPosition(this.newRangeAnchor);
    }
    serialize() { return this.serializedState; }
}
class EditDelta {
    constructor(serializedState) {
        this.serializedState = serializedState;
        this.timestamp = serializedState.timestamp;
        this.changes = serializedState.changes.map((ss) => {
            return new EditChange(ss);
        });
    }
    getTimestamp() { return this.timestamp; }
    ;
    doAction(editorState) {
        this.changes.forEach((c) => {
            c.doAction(editorState);
        });
    }
    undoAction(editorState) {
        this.changes.forEach((c) => {
            c.undoAction(editorState);
        });
    }
    addAnchors(editorState) {
        this.changes.forEach((c) => {
            c.addAnchor(editorState);
        });
    }
    serialize() { return this.serializedState; }
}
class OpenDelta {
    constructor(serializedState) {
        this.serializedState = serializedState;
        this.grammarName = serializedState.grammarName;
        this.title = serializedState.title;
        this.timestamp = serializedState.timestamp;
        this.contents = serializedState.contents;
    }
    getTimestamp() { return this.timestamp; }
    ;
    doAction(editorState) {
        const editorWrapper = editorState.getEditorWrapper();
        editorState.title = this.title;
        editorState.isOpen = true;
        editorWrapper.setGrammar(this.grammarName);
        editorWrapper.setText(this.contents);
    }
    undoAction(editorState) {
        const editorWrapper = editorState.getEditorWrapper();
        editorState.title = '';
        editorState.isOpen = false;
        editorWrapper.setText('');
    }
    serialize() { return this.serializedState; }
}
class DestroyDelta {
    constructor(serializedState) {
        this.serializedState = serializedState;
        this.timestamp = serializedState.timestamp;
    }
    getTimestamp() { return this.timestamp; }
    ;
    doAction(editorState) {
        editorState.isOpen = false;
    }
    undoAction(editorState) {
        editorState.isOpen = true;
    }
    serialize() { return this.serializedState; }
}
class ModifiedDelta {
    constructor(serializedState) {
        this.serializedState = serializedState;
        this.timestamp = serializedState.timestamp;
        this.modified = serializedState.modified;
        this.oldModified = serializedState.oldModified;
    }
    getTimestamp() { return this.timestamp; }
    ;
    doAction(editorState) {
        editorState.modified = this.modified;
    }
    undoAction(editorState) {
        editorState.modified = this.oldModified;
    }
    serialize() { return this.serializedState; }
}
class EditorState {
    constructor(suppliedState, editorWrapper, mustPerformChange) {
        this.editorWrapper = editorWrapper;
        this.deltas = [];
        this.selections = {};
        this.remoteCursors = new RemoteCursorMarker(this);
        let state = _.extend({
            isOpen: true,
            deltas: [],
            cursors: []
        }, suppliedState);
        this.editorWrapper.setEditorState(this);
        this.editorID = state.id;
        if (mustPerformChange) {
            state.deltas.forEach((d) => {
                this.addDelta(d, true);
            });
        }
        state.cursors.forEach((c) => {
        });
    }
    serialize() {
        return {
            deltas: _.map(this.deltas, d => d.serialize()),
            isOpen: this.isOpen,
            id: this.editorID,
            title: this.title,
            modified: this.modified,
            remoteCursors: this.remoteCursors.serialize()
        };
    }
    ;
    getEditorWrapper() { return this.editorWrapper; }
    ;
    getTitle() { return this.title; }
    ;
    setTitle(newTitle) { this.title = newTitle; }
    ;
    setIsOpen(val) { this.isOpen = val; }
    ;
    getIsOpen(val) { return this.isOpen; }
    ;
    getRemoteCursors() { return this.remoteCursors; }
    ;
    getEditorID() { return this.editorID; }
    ;
    getIsModified() { return this.modified; }
    ;
    addDelta(serializedDelta, mustPerformChange) {
        const { type } = serializedDelta;
        let delta;
        if (type === 'open') {
            delta = new OpenDelta(serializedDelta);
        }
        else if (type === 'edit') {
            delta = new EditDelta(serializedDelta);
        }
        else if (type === 'modified') {
            delta = new ModifiedDelta(serializedDelta);
        }
        else if (type === 'grammar') {
            delta = new GrammarDelta(serializedDelta);
        }
        else if (type === 'title') {
            delta = new TitleDelta(serializedDelta);
        }
        else if (type === 'destroy') {
            delta = new DestroyDelta(serializedDelta);
        }
        else {
            console.log(serializedDelta);
        }
        if (delta) {
            this.handleDelta(delta, mustPerformChange);
        }
    }
    handleDelta(delta, mustPerformChange) {
        if (delta instanceof EditDelta) {
            delta.addAnchors(this);
        }
        let i = this.deltas.length - 1;
        let d;
        for (; i >= 0; i--) {
            d = this.deltas[i];
            if (d.getTimestamp() > delta.getTimestamp()) {
                this.undoDelta(d);
            }
            else {
                break;
            }
        }
        const insertAt = i + 1;
        this.deltas.splice(insertAt, 0, delta);
        if (mustPerformChange) {
            i = insertAt;
        }
        else {
            i = insertAt + 1;
        }
        for (; i < this.deltas.length; i++) {
            d = this.deltas[i];
            this.doDelta(d);
        }
    }
    doDelta(d) {
        d.doAction(this);
    }
    undoDelta(d) {
        d.undoAction(this);
    }
}
exports.EditorState = EditorState;
class EditorStateTracker {
    constructor(EditorWrapperClass, channelCommunicationService) {
        this.EditorWrapperClass = EditorWrapperClass;
        this.channelCommunicationService = channelCommunicationService;
        this.editorStates = {};
    }
    handleEvent(event, mustPerformChange) {
        const editorState = this.getEditorState(event.id);
        if (editorState) {
            editorState.addDelta(event, mustPerformChange);
        }
    }
    ;
    getEditorState(editorID) {
        if (this.editorStates[editorID]) {
            return this.editorStates[editorID];
        }
        else {
            return null;
        }
    }
    getActiveEditors() {
        const rv = _.filter(this.editorStates, s => s.getIsOpen());
        return rv;
    }
    onEditorOpened(state, mustPerformChange) {
        let editorState = this.getEditorState(state.id);
        if (!editorState) {
            editorState = new EditorState(state, new this.EditorWrapperClass(state, this.channelCommunicationService), mustPerformChange);
            this.editorStates[state.id] = editorState;
        }
        editorState.addDelta(state, mustPerformChange); //open event
        return editorState;
    }
    serializeEditorStates() {
        return _.mapObject(this.editorStates, editorState => editorState.serialize());
    }
    ;
}
exports.EditorStateTracker = EditorStateTracker;
//# sourceMappingURL=editor-state-tracker.js.map