import * as _ from 'underscore';
import { EventEmitter } from 'events';
import { ChannelCommunicationService } from './communication-service';
// import {RemoteCursorMarker} from './remote_cursor_marker';
export class RemoteCursorMarker extends EventEmitter {
    constructor(private editorState:EditorState) {
		super();
	}
	private cursors:{[cursorID:number]:any} = {};
	public updateCursor(id, user, pos) {
		if(this.cursors[id]) {
			this.cursors[id].pos = pos;
			this.editorState.getEditorWrapper().updateRemoteCursorPosition(this.cursors[id], this);
		} else {
			this.cursors[id] = { id: id, user: user, pos: pos };
			this.editorState.getEditorWrapper().addRemoteCursor(this.cursors[id], this);
		}
	};
	public updateSelection(id, user, range) {
		if(this.cursors[id]) {
			this.cursors[id].range = range;
			this.editorState.getEditorWrapper().updateRemoteCursorSelection(this.cursors[id], this);
		} else {
			this.cursors[id] = { id: id, user: user, range: range };
			this.editorState.getEditorWrapper().addRemoteCursor(this.cursors[id], this);
		}
	};
    public removeCursor(id, user) {
		if(this.cursors[id]) {
			this.editorState.getEditorWrapper().removeRemoteCursor(this.cursors[id], this);
		}
    }
	public getCursors() {
		return this.cursors;
	}
}

interface EditorWrapper {
	setEditorState(editorState:EditorState);
	setGrammar(grammarName:string);
	replaceText(range, value:string);
	getAnchor(range);
	getCurrentAnchorPosition(anchor);
	setText(value:string);
	addRemoteCursor(cursor, remoteCursorMarker:RemoteCursorMarker);
	updateRemoteCursorPosition(cursor, remoteCursorMarker:RemoteCursorMarker);
	updateRemoteCursorSelection(cursor, remoteCursorMarker:RemoteCursorMarker);
	removeRemoteCursor(cursor, remoteCursorMarker:RemoteCursorMarker);
    saveFile();
	serializeEditorStates();
}

interface Delta {
    doAction(editorState:EditorState):void;
	getTimestamp():number;
}
interface UndoableDelta extends Delta {
	undoAction(editorState:EditorState):void;
}

class TitleDelta implements UndoableDelta {
    constructor(serializedState) {
		this.oldTitle = serializedState.oldTitle;
		this.newTitle = serializedState.newTitle;
		this.timestamp = serializedState.timestamp;
	}
	private newTitle:string;
	private oldTitle:string;
	private timestamp:number;
	public getTimestamp():number { return this.timestamp; };
    public doAction(editorState:EditorState) {
        editorState.setTitle(this.newTitle);
    }
	public undoAction(editorState:EditorState) {
        editorState.setTitle(this.oldTitle);
    }
}
class GrammarDelta implements UndoableDelta {
    constructor(serializedState) {
		this.oldGrammarName = serializedState.oldGrammarName;
		this.newGrammarName = serializedState.newGrammarName;
		this.timestamp = serializedState.timestamp;
	}
	private timestamp:number;
	public getTimestamp():number { return this.timestamp; };
	private oldGrammarName:string;
	private newGrammarName:string;
    public doAction(editorState:EditorState) {
		const editorWrapper = editorState.getEditorWrapper();
		editorWrapper.setGrammar(this.newGrammarName);
    }
	public undoAction(editorState:EditorState) {
		const editorWrapper = editorState.getEditorWrapper();
		editorWrapper.setGrammar(this.oldGrammarName);
    }
}

class EditChange implements UndoableDelta {
	private oldRangeAnchor;
	private newRangeAnchor;
	private oldRange;
	private newRange;
	private oldText:string;
	private newText:string;
	private timestamp:number;
	public getTimestamp():number { return this.timestamp; };
    constructor(serializedState) {
		this.oldRange = serializedState.oldRange;
		this.newRange = serializedState.newRange;
		this.oldText = serializedState.oldText;
		this.newText = serializedState.newText;
	}
    public doAction(editorState:EditorState) {
		const editorWrapper = editorState.getEditorWrapper();
		this.updateRanges(editorState);
		editorWrapper.replaceText(this.oldRange, this.newText);
    }
	public undoAction(editorState:EditorState) {
		const editorWrapper = editorState.getEditorWrapper();
		editorWrapper.replaceText(this.newRange, this.oldText);
    }
	public addAnchor(editorState:EditorState) {
		const editorWrapper = editorState.getEditorWrapper();
		this.oldRangeAnchor = editorWrapper.getAnchor(this.oldRange);
		this.newRangeAnchor = editorWrapper.getAnchor(this.newRange);
	}
	public updateRanges(editorState:EditorState) {
		const editorWrapper = editorState.getEditorWrapper();
		this.oldRange = editorWrapper.getCurrentAnchorPosition(this.oldRangeAnchor);
		this.newRange = editorWrapper.getCurrentAnchorPosition(this.newRangeAnchor);
	}
}

class EditDelta implements UndoableDelta {
    constructor(serializedState) {
		this.timestamp = serializedState.timestamp;
		this.changes = serializedState.changes.map((ss) => {
			return new EditChange(ss);
		});
	}
	private changes:Array<EditChange>;
	private timestamp:number;
	public getTimestamp():number { return this.timestamp; };
    public doAction(editorState:EditorState) {
		this.changes.forEach( (c) => {
			c.doAction(editorState);
		});
    }
    public undoAction(editorState:EditorState) {
		this.changes.forEach( (c) => {
			c.undoAction(editorState);
		});
    }
	public addAnchors(editorState:EditorState) {
		this.changes.forEach( (c) => {
			c.addAnchor(editorState);
		});
	}
}

class OpenDelta implements UndoableDelta {
    constructor(serializedState) {
		this.grammarName = serializedState.grammarName;
		this.title = serializedState.title;
		this.timestamp = serializedState.timestamp;
		this.contents = serializedState.contents;
	}
	private grammarName:string;
	private timestamp:number;
	private title:string;
	private contents:string;
	public getTimestamp():number { return this.timestamp; };
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
}
class DestroyDelta implements UndoableDelta {
    constructor(serializedState) {
		this.timestamp = serializedState.timestamp;
	}
	private timestamp:number;
	public getTimestamp():number { return this.timestamp; };
	doAction(editorState) {
		editorState.isOpen = false;
	}
	undoAction(editorState) {
		editorState.isOpen = true;
	}
}
class ModifiedDelta implements UndoableDelta {
    constructor(serializedState) {
		this.timestamp = serializedState.timestamp;
		this.modified = serializedState.modified;
		this.oldModified = serializedState.oldModified;
	}
	private timestamp:number;
	private modified:boolean;
	private oldModified:boolean;
	public getTimestamp():number { return this.timestamp; };
	doAction(editorState) {
		editorState.modified = this.modified;
	}
	undoAction(editorState) {
		editorState.modified = this.oldModified;
	}
}


export class EditorState {
	private isOpen:boolean;
	private deltas: Array<UndoableDelta> = [];
    private selections:{[selectionID:number]:any} = {};
	private editorID:number;
	private remoteCursors:RemoteCursorMarker = new RemoteCursorMarker(this);
	private title:string;
	private modified:boolean;
    constructor(suppliedState, private editorWrapper, mustPerformChange:boolean) {
        let state = _.extend({
            isOpen: true,
            deltas: [],
            cursors: []
        }, suppliedState);

		this.editorWrapper.setEditorState(this);
		this.editorID = state.id;
		if(mustPerformChange) {
			state.deltas.forEach((d) => {
				this.addDelta(d);
			});
		}
		state.cursors.forEach((c) => {

		});
	}
	public getEditorWrapper() { return this.editorWrapper; };
	public setTitle(newTitle:string) { this.title = newTitle; };
	public setIsOpen(val:boolean) { this.isOpen = val; };
	public getIsOpen(val:boolean) { return this.isOpen; };
	public getRemoteCursors():RemoteCursorMarker { return this.remoteCursors; };
	public getEditorID():number { return this.editorID; };
	public addDelta(serializedDelta, mustPerformChange=true) {
		const {type} = serializedDelta;
		let delta;

		if(type === 'open') {
			delta = new OpenDelta(serializedDelta);
		} else if(type === 'edit') {
			delta = new EditDelta(serializedDelta);
		} else if(type === 'modified') {
			delta = new ModifiedDelta(serializedDelta);
		} else if(type === 'grammar') {
			delta = new GrammarDelta(serializedDelta);
		} else if(type === 'title') {
			delta = new TitleDelta(serializedDelta);
		} else if(type === 'destroy') {
			delta = new DestroyDelta(serializedDelta);
		} else {
			console.log(serializedDelta);
		}

		if(delta) {
			this.handleDelta(delta, mustPerformChange);
		}
	}
	private handleDelta(delta, mustPerformChange) {
		if(delta instanceof EditDelta) {
			delta.addAnchors(this);
		}
		let i = this.deltas.length-1;
		let d;
		for(; i>=0; i--) {
			d = this.deltas[i];
			if(d.getTimestamp() > delta.getTimestamp()) {
				this.undoDelta(d);
			} else {
				break;
			}
		}
		const insertAt = i+1;
		this.deltas.splice(insertAt, 0, delta);

		if(mustPerformChange) {
			i = insertAt;
		} else {
			i = insertAt + 1;
		}

		for(; i<this.deltas.length; i++) {
			d = this.deltas[i];
			this.doDelta(d);
		}
	}
	private doDelta(d) {
		d.doAction(this);
	}
	private undoDelta(d) {
		d.undoAction(this);
	}
}

export class EditorStateTracker {
    private editorStates:{[editorID:number]: EditorState} = {};
    constructor(protected EditorWrapperClass, private channelCommunicationService:ChannelCommunicationService) {
	}
	public handleEvent(event) {
		const editorState = this.getEditorState(event.id);
		if(editorState) {
			editorState.addDelta(event);
		}
	};
	public getEditorState(editorID:number):EditorState {
        if(this.editorStates[editorID]) {
    		return this.editorStates[editorID];
        } else {
            return null;
        }
	}
	public getActiveEditors():Array<EditorState> {
		const rv = _.filter(this.editorStates, (s) => {
			return s.getIsOpen();
		});
		return rv;
	}
	public onEditorOpened(state, mustPerformChange:boolean) {
		const editorState =  new EditorState(state, new this.EditorWrapperClass(state, this.channelCommunicationService), mustPerformChange);
		this.editorStates[state.id] = editorState;
		console.log(this.editorStates);
		return editorState;
	}
	public serializeEditorStates() {

	};
}
