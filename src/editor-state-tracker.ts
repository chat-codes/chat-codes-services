import * as _ from 'underscore';
import * as FuzzySet from 'fuzzyset.js';
import { EventEmitter } from 'events';
import { ChannelCommunicationService } from './communication-service';

interface SerializedRange {
	start: Array<number>,
	end: Array<number>
};
interface SerializedPos {
	row: number,
	column: number
}
/*
 * Tracks a set of remote cursors.
 */
export class RemoteCursorMarker extends EventEmitter {
    constructor(private editorState:EditorState) {
		super();
	}
	private cursors:{[cursorID:number]:any} = {};
	public updateCursor(id, user, pos:SerializedPos) {
		if(!this.cursors[id]) {
			this.cursors[id] = { id: id, user: user };
			this.editorState.getEditorWrapper().addRemoteCursor(this.cursors[id], this);
		}

		let oldPos = this.cursors[id].pos;
		this.cursors[id].pos = pos;

		if(oldPos) {
			this.editorState.getEditorWrapper().updateRemoteCursorPosition(this.cursors[id], this);
		} else {
			this.editorState.getEditorWrapper().addRemoteCursorPosition(this.cursors[id], this);
		}
	};
	public updateSelection(id, user, range:SerializedRange) {
		if(!this.cursors[id]) {
			this.cursors[id] = { id: id, user: user };
			this.editorState.getEditorWrapper().addRemoteCursor(this.cursors[id], this);
		}

		let oldRange = this.cursors[id].range;
		this.cursors[id].range = range;

		if(oldRange) {
			this.editorState.getEditorWrapper().updateRemoteCursorSelection(this.cursors[id], this);
		} else {
			this.editorState.getEditorWrapper().addRemoteCursorSelection(this.cursors[id], this);
		}
	};
    public removeCursor(id, user) {
		if(this.cursors[id]) {
			this.editorState.getEditorWrapper().removeRemoteCursor(this.cursors[id], this);
			delete this.cursors[id];
		}
    }
	public getCursors() {
		return this.cursors;
	}
	public serialize() {
		return {
			cursors: this.cursors
		};
	}
	public removeUserCursors(user) {
		_.each(this.cursors, (cursor, id) => {
			if(cursor.user.id === user.id) {
				this.removeCursor(id, user);
			}
		});
	}
}

/**
 * EditorWrapper is an interface for interacting with a given editor.
 */
interface EditorWrapper {
	setEditorState(editorState:EditorState);
	setGrammar(grammarName:string);
	replaceText(range, value:string);
	getAnchor(range);
	getCurrentAnchorPosition(anchor);
	setText(value:string);
	addRemoteCursor(cursor, remoteCursorMarker:RemoteCursorMarker);
	addRemoteCursorPosition(cursor, remoteCursorMarker:RemoteCursorMarker);
	addRemoteCursorSelection(cursor, remoteCursorMarker:RemoteCursorMarker);
	updateRemoteCursorPosition(cursor, remoteCursorMarker:RemoteCursorMarker);
	updateRemoteCursorSelection(cursor, remoteCursorMarker:RemoteCursorMarker);
	removeRemoteCursor(cursor, remoteCursorMarker:RemoteCursorMarker);
    addHighlight(range:SerializedRange, extraInfo?):number;
    removeHighlight(highlightID:number, extraInfo?);
	focus(range:SerializedRange, extraInfo?);
    saveFile();
	serializeEditorStates();
	setReadOnly(readOnly:boolean, extraInfo?);
}

/**
 * A change to an editor or environment that can be done and undone
 */
export interface UndoableDelta {
    doAction(editorState:EditorState):void;
	undoAction(editorState:EditorState):void;
	getTimestamp():number;
	serialize();
}

class TitleDelta implements UndoableDelta {
    /**
     * Represents a change where the title of the editor window has changed
     */
    constructor(private serializedState) {
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
	public serialize() {
		return this.serializedState;
	}
}
class GrammarDelta implements UndoableDelta {
	/**
	 * Represents a change where the grammar (think of syntax highlighting rules) has changed
	 */
    constructor(private serializedState) {
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
	public serialize() { return this.serializedState; }
}

export class EditChange implements UndoableDelta {
	private oldRangeAnchor; // Anchors are important to keep track of where this change should be..
	private newRangeAnchor; // ..in case any edits need to be inserted before this one
	private oldRange:SerializedRange;
	private newRange:SerializedRange;
	private oldText:string;
	private newText:string;
	private timestamp:number;
	public getTimestamp():number { return this.timestamp; };
	/**
	 * Represents a change where text has been edited
	 */
    constructor(private serializedState) {
		this.oldRange = serializedState.oldRange;
		this.newRange = serializedState.newRange;
		this.oldText = serializedState.oldText;
		this.newText = serializedState.newText;
	}
    public doAction(editorState:EditorState) {
		const editorWrapper = editorState.getEditorWrapper();

		const {oldText, newRange} = editorWrapper.replaceText(this.oldRange, this.newText);
		this.newRange = newRange;
		this.oldText = oldText;
		// console.log("DO", JSON.stringify(this.oldRange), '"'+this.newText+'"');
    }
	public undoAction(editorState:EditorState) {
		const editorWrapper = editorState.getEditorWrapper();

		const {oldText, newRange} = editorWrapper.replaceText(this.newRange, this.oldText);
		this.oldRange = newRange;
		this.newText = oldText;
		// console.log("UNDO", JSON.stringify(this.newRange), '"'+this.oldText+'"');
    }
	public serialize() { return this.serializedState; }
}

class EditDelta implements UndoableDelta {
	/**
	 * Represents a change made to the text of a document. Contains a series of EditChange
	 * objects representing the individual changes
	 */
    constructor(private serializedState) {
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
	public serialize() { return this.serializedState; }
}

class OpenDelta implements UndoableDelta {
	/**
	 * Represents a new text editor being opened
	 */
    constructor(private serializedState) {
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
	public serialize() { return this.serializedState; }
}
class DestroyDelta implements UndoableDelta {
	/**
	 * Represents a text editor being closed.
	 */
    constructor(private serializedState) {
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
	public serialize() { return this.serializedState; }
}
class ModifiedDelta implements UndoableDelta {
	/**
	 * Represents a change to the *modified* flag (which marks if a file has been changed
	 * without having been saved)
	 */
    constructor(private serializedState) {
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
	public serialize() { return this.serializedState; }
}


export class EditorState {
	private isOpen:boolean;
	private deltas: Array<UndoableDelta> = [];
    private selections:{[selectionID:number]:any} = {};
	private editorID:number;
	private remoteCursors:RemoteCursorMarker = new RemoteCursorMarker(this);
	private title:string;
	private modified:boolean;
	private deltaPointer:number=-1;
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
				this.addDelta(d, true);
			});
		}
		state.cursors.forEach((c) => {

		});
	}
	public serialize() {
		return {
			deltas: _.map(this.deltas, d => d.serialize() ),
			isOpen: this.isOpen,
			id: this.editorID,
			title: this.title,
			modified: this.modified,
			remoteCursors: this.remoteCursors.serialize()
		}
	};
	public setTitle(newTitle:string):void { this.title = newTitle; };
	public setIsOpen(val:boolean):void { this.isOpen = val; };
	public getEditorWrapper():EditorWrapper { return this.editorWrapper; };
	public getTitle():string { return this.title; };
	public getIsOpen():boolean { return this.isOpen; };
	public getRemoteCursors():RemoteCursorMarker { return this.remoteCursors; };
	public getEditorID():number { return this.editorID; };
	public getIsModified():boolean { return this.modified; };
	public addHighlight(range, timestamp:number=null, extraInfo):number {
		this.revertToTimestamp(timestamp, extraInfo);
		return this.getEditorWrapper().addHighlight(range, extraInfo);
	}
	public removeHighlight(highlightID:number, extraInfo):boolean {
		this.revertToTimestamp(null, extraInfo);
		return this.getEditorWrapper().removeHighlight(highlightID, extraInfo);
	}
	public focus(range, timestamp:number=null, extraInfo):boolean {
		this.revertToTimestamp(timestamp, extraInfo);
		return this.getEditorWrapper().focus(range, extraInfo);
	}
	private moveDeltaPointer(index:number) {
		let d:UndoableDelta;

		if(this.deltaPointer < index) {
			while(this.deltaPointer < index) {
				this.deltaPointer++;
				d = this.deltas[this.deltaPointer];
				d.doAction(this);
			}
		} else if(this.deltaPointer > index) {
			while(this.deltaPointer > index) {
				d = this.deltas[this.deltaPointer];
				d.undoAction(this);
				this.deltaPointer--;
			}
		}
	}
	private getLastDeltaIndexBeforeTimestamp(timestamp:number):number {
		let d:UndoableDelta;
		let i:number = 0;
		for(; i<this.deltas.length; i++) {
			d = this.deltas[i];
			if(d.getTimestamp() > timestamp) {
				break;
			}
		}
		return i-1;
	}

	private revertToTimestamp(timestamp:number, extraInfo?) {
		const editorWrapper = this.getEditorWrapper();
		if(timestamp) {
			editorWrapper.setReadOnly(true, extraInfo);
			const lastDeltaBefore:number = this.getLastDeltaIndexBeforeTimestamp(timestamp);
			this.moveDeltaPointer(lastDeltaBefore);
		} else {
			editorWrapper.setReadOnly(false, extraInfo);
			this.moveDeltaPointer(this.deltas.length-1);
		}
	}

	public addDelta(serializedDelta, mustPerformChange:boolean):UndoableDelta {
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
			delta = null;
			console.log(serializedDelta);
		}

		if(delta) {
			this.handleDelta(delta, mustPerformChange);
		}
		return delta;
	}

	private handleDelta(delta:UndoableDelta, mustPerformChange:boolean):void {
		const oldDeltaPointer:number = this.deltaPointer;

		//Go back and undo any deltas that should have been done after this delta
		const lastDeltaBefore = this.getLastDeltaIndexBeforeTimestamp(delta.getTimestamp());
		this.moveDeltaPointer(lastDeltaBefore);
		this.deltas.splice(this.deltaPointer+1, 0, delta)
		if(mustPerformChange === false) {
			this.deltaPointer = this.deltaPointer + 1; // will not include this delta as we move forward
		}
		// Go forward and do all of the deltas that come after.
		this.moveDeltaPointer(oldDeltaPointer+1);
	}
	public removeUserCursors(user) {
		this.remoteCursors.removeUserCursors(user);
	}
}

export class EditorStateTracker {
    private editorStates:{[editorID:number]: EditorState} = {};
    constructor(protected EditorWrapperClass, private channelCommunicationService:ChannelCommunicationService) {
	}

	public getAllEditors():Array<EditorState> {
		return _.values(this.editorStates);
	}

	public handleEvent(event, mustPerformChange:boolean):UndoableDelta {
		const editorState = this.getEditorState(event.id);
		if(editorState) {
			return editorState.addDelta(event, mustPerformChange);
		}
		return null;
	};

	public getEditorState(editorID:number):EditorState {
        if(this.editorStates[editorID]) {
    		return this.editorStates[editorID];
        } else {
            return null;
        }
	}

	public getActiveEditors():Array<EditorState> {
		const rv = _.filter(this.getAllEditors(), s => s.getIsOpen());
		return rv;
	}

	public onEditorOpened(state, mustPerformChange:boolean):EditorState {
		let editorState = this.getEditorState(state.id);
		if(!editorState) {
			editorState =  new EditorState(state, new this.EditorWrapperClass(state, this.channelCommunicationService), mustPerformChange);
			this.editorStates[state.id] = editorState;
		}
		return editorState;
	}

	public serializeEditorStates() {
		return _.mapObject(this.editorStates, editorState => editorState.serialize());
	};

	public removeUserCursors(user):void {
		_.each(this.editorStates, (es) => {
			es.removeUserCursors(user);
		});
	}
	public addHighlight(editorID:number, range:SerializedRange, timestamp:number, extraInfo={}):number {
		const editorState:EditorState = this.getEditorState(editorID);
		if(editorState) {
			return editorState.addHighlight(range, timestamp, extraInfo);
		} else {
			return -1;
		}
	}
	public removeHighlight(editorID:number, highlightID:number, extraInfo={}):boolean {
		const editorState:EditorState = this.getEditorState(editorID);
		if(editorState) {
			return editorState.removeHighlight(highlightID, extraInfo);
		} else {
			return false;
		}
	}
	public focus(editorID:number, range:SerializedRange, timestamp:number, extraInfo={}):boolean {
		const editorState:EditorState = this.getEditorState(editorID);
		if(editorState) {
			return editorState.focus(range, timestamp, extraInfo);
		} else {
			return false;
		}
	}
	public fuzzyMatch(query:string):EditorState {
		const editors = this.getAllEditors();
		const editorTitleSet = new FuzzySet(_.map(editors, (e) => e.getTitle() ));
		const matches = editorTitleSet.get(query);
		if(matches) {
			const bestTitleMatch = matches[0][1];
			const matchingTitles = _.filter(this.getAllEditors(), (es) => es.getTitle() === bestTitleMatch);
			if(matchingTitles.length > 0) {
				return matchingTitles[0];
			}
		}

		return null;
	}
}
