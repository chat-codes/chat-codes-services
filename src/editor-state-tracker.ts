//<reference path="./typings/node/node.d.ts" />
import * as _ from 'underscore';
import * as FuzzySet from 'fuzzyset.js';
import { EventEmitter } from 'events';
import { ChannelCommunicationService } from './communication-service';
import { ChatUser, ChatUserList } from './chat-user';
import { Timestamped } from './chat-messages';
import * as CodeMirror from 'codemirror';
import * as ShareDB from 'sharedb/lib/client';
import * as otText from 'ot-text';

ShareDB.types.map['json0'].registerSubtype(otText.type);

interface SerializedRange {
	start: Array<number>,
	end: Array<number>
};
interface SerializedPos {
	row: number,
	column: number
}

const CURRENT:number=-1;

/*
 * Tracks a set of remote cursors.
 */
export class RemoteCursorMarker extends EventEmitter {
    constructor(private editorState:EditorState) {
		super();
	}
	private cursors:Map<number, any> = new Map();
	public updateCursor(id, user, pos:SerializedPos) {
		if(!user.getIsMe()) {
			let cursor;
			if(this.cursors.has(id)) {
				cursor = this.cursors.get(id);
			} else {
				cursor = {id: id, user: user};
				this.cursors.set(id, cursor);
				this.editorState.getEditorWrapper().addRemoteCursor(cursor, this);
			}

			const oldPos = cursor.pos;
			cursor.pos = pos;

			if(oldPos) {
				this.editorState.getEditorWrapper().updateRemoteCursorPosition(cursor, this);
			} else {
				this.editorState.getEditorWrapper().addRemoteCursorPosition(cursor, this);
			}
		}
	};
	public updateSelection(id, user, range:SerializedRange) {
		if(!user.getIsMe()) {
			let cursor;
			if(this.cursors.has(id)) {
				cursor = this.cursors.get(id);
			} else {
				cursor = {id: id, user: user};
				this.cursors.set(id, { id: id, user: user });
				this.editorState.getEditorWrapper().addRemoteCursor(cursor, this);
			}

			const oldRange = cursor.range;
			cursor.range = range;

			if(oldRange) {
				this.editorState.getEditorWrapper().updateRemoteCursorSelection(cursor, this);
			} else {
				this.editorState.getEditorWrapper().addRemoteCursorSelection(cursor, this);
			}
		}
	};
    public removeCursor(id, user) {
		if(this.cursors.has(id)) {
			this.editorState.getEditorWrapper().removeRemoteCursor(this.cursors.get(id), this);
			this.cursors.delete(id);
		}
    }
	public getCursors() {
		return Array.from(this.cursors.values());
	}
	public serialize() {
		return {
			cursors: this.cursors
		};
	}
	public removeUserCursors(user) {
		this.cursors.forEach((cursor:any, id) => {
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
	setText(value:string);
	replaceText(range, value:string);
	setEditorState(editorState:EditorState);
	setGrammar(grammarName:string);
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
export interface UndoableDelta extends Timestamped  {
    doAction(editorWrapper:EditorWrapper):void;
	undoAction(editorWrapper:EditorWrapper):void;
	// getTimestamp():number; //follows from extending Timestamped
	getAuthor():ChatUser;
	getEditorState():EditorState;
	serialize();
}

export class TitleDelta implements UndoableDelta {
    /**
     * Represents a change where the title of the editor window has changed
     */
    constructor(private serializedState, private author:ChatUser, private editorState:EditorState) {
		this.oldTitle = serializedState.oldTitle;
		this.newTitle = serializedState.newTitle;
		this.timestamp = serializedState.timestamp;
	}
	private newTitle:string;
	private oldTitle:string;
	private timestamp:number;
	public getTimestamp():number { return this.timestamp; };
    public doAction(editorWrapper:EditorWrapper) {
        this.editorState.setTitle(this.newTitle);
    }
	public undoAction(editorWrapper:EditorWrapper) {
        this.editorState.setTitle(this.oldTitle);
    }
	public serialize() {
		return this.serializedState;
	}
	public getAuthor():ChatUser { return this.author; };
	public getEditorState():EditorState { return this.editorState; };
}
export class GrammarDelta implements UndoableDelta {
	/**
	 * Represents a change where the grammar (think of syntax highlighting rules) has changed
	 */
    constructor(private serializedState, private author:ChatUser, private editorState:EditorState) {
		this.oldGrammarName = serializedState.oldGrammarName;
		this.newGrammarName = serializedState.newGrammarName;
		this.timestamp = serializedState.timestamp;
	}
	private timestamp:number;
	public getTimestamp():number { return this.timestamp; };
	private oldGrammarName:string;
	private newGrammarName:string;
    public doAction(editorWrapper:EditorWrapper) {
		editorWrapper.setGrammar(this.newGrammarName);
    }
	public undoAction(editorWrapper:EditorWrapper) {
		editorWrapper.setGrammar(this.oldGrammarName);
    }
	public serialize() { return this.serializedState; }
	public getAuthor():ChatUser { return this.author; };
	public getEditorState():EditorState { return this.editorState; };
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
    constructor(private serializedState, private author:ChatUser, private editorState:EditorState) {
		this.oldRange = serializedState.oldRange;
		this.newRange = serializedState.newRange;
		this.oldText = serializedState.oldText;
		this.newText = serializedState.newText;
	}
    public doAction(editorWrapper:EditorWrapper) {
		const {oldText, newRange} = editorWrapper.replaceText(this.oldRange, this.newText);
		this.newRange = newRange;
		this.oldText = oldText;
    }
	public undoAction(editorWrapper:EditorWrapper) {
		const {oldText, newRange} = editorWrapper.replaceText(this.newRange, this.oldText);
		this.oldRange = newRange;
		this.newText = oldText;
    }
	public serialize() { return this.serializedState; }
	public getAuthor():ChatUser { return this.author; };
	public getEditorState():EditorState { return this.editorState; };
	public getOldRange() { return this.oldRange; }
	public getNewText():string { return this.newText; }
}

export class EditDelta implements UndoableDelta {
	/**
	 * Represents a change made to the text of a document. Contains a series of EditChange
	 * objects representing the individual changes
	 */
    constructor(private serializedState, private author:ChatUser, private editorState:EditorState) {
		this.timestamp = serializedState.timestamp;
		this.changes = serializedState.changes.map((ss) => {
			return new EditChange(ss, this.author, this.editorState);
		});
	}
	private changes:Array<EditChange>;
	private timestamp:number;
	public getTimestamp():number { return this.timestamp; };
    public doAction(editorWrapper:EditorWrapper) {
		this.changes.forEach( (c) => {
			c.doAction(editorWrapper);
		});
    }
    public undoAction(editorWrapper:EditorWrapper) {
		this.changes.forEach( (c) => {
			c.undoAction(editorWrapper);
		});
    }
	public serialize() { return this.serializedState; }
	public getAuthor():ChatUser { return this.author; };
	public getEditorState():EditorState { return this.editorState; };
	public getChanges():Array<EditChange> { return this.changes; };
}

export class OpenDelta implements UndoableDelta {
	/**
	 * Represents a new text editor being opened
	 */
    constructor(private serializedState, private author:ChatUser, private editorState:EditorState) {
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
	public doAction(editorWrapper:EditorWrapper) {
		this.editorState.setTitle(this.title);
		this.editorState.setIsOpen(true);

		editorWrapper.setGrammar(this.grammarName);
		editorWrapper.setText(this.contents);
	}
	public undoAction(editorWrapper:EditorWrapper) {
		this.editorState.setTitle('');
		this.editorState.setIsOpen(false);

		editorWrapper.setText('');
	}
	public getContents():string { return this.contents; };
	public serialize() { return this.serializedState; }
	public getAuthor():ChatUser { return this.author; };
	public getEditorState():EditorState { return this.editorState; };
}
export class DestroyDelta implements UndoableDelta {
	/**
	 * Represents a text editor being closed.
	 */
    constructor(private serializedState, private author:ChatUser, private editorState:EditorState) {
		this.timestamp = serializedState.timestamp;
	}
	private timestamp:number;
	public getTimestamp():number { return this.timestamp; };
	public doAction(editorWrapper:EditorWrapper) {
		this.editorState.setIsOpen(false);
	}
	public undoAction(editorWrapper:EditorWrapper) {
		this.editorState.setIsOpen(true);
	}
	public serialize() { return this.serializedState; }
	public getAuthor():ChatUser { return this.author; };
	public getEditorState():EditorState { return this.editorState; };
}
export class ModifiedDelta implements UndoableDelta {
	/**
	 * Represents a change to the *modified* flag (which marks if a file has been changed
	 * without having been saved)
	 */
    constructor(private serializedState, private author:ChatUser, private editorState:EditorState) {
		this.timestamp = serializedState.timestamp;
		this.modified = serializedState.modified;
		this.oldModified = serializedState.oldModified;
	}
	private timestamp:number;
	private modified:boolean;
	private oldModified:boolean;
	public getTimestamp():number { return this.timestamp; };
	public doAction(editorWrapper:EditorWrapper) {
		this.editorState.setIsModified(this.modified);
	}
	public undoAction(editorWrapper:EditorWrapper) {
		this.editorState.setIsModified(this.oldModified);
	}
	public serialize() { return this.serializedState; }
	public getAuthor():ChatUser { return this.author; };
	public getEditorState():EditorState { return this.editorState; };
}


export class EditorState {
	private isOpen:boolean;
	private deltas: Array<UndoableDelta> = [];
    private selections:{[selectionID:number]:any} = {};
	private editorID:string;
	private remoteCursors:RemoteCursorMarker = new RemoteCursorMarker(this);
	private title:string;
	private modified:boolean;
	private deltaPointer:number=-1;
	private currentTimestamp:number=CURRENT;
    constructor(suppliedState, private editorWrapper, private userList:ChatUserList, mustPerformChange:boolean) {
        let state = _.extend({
            isOpen: true,
            deltas: [],
            cursors: []
        }, suppliedState);

		this.isOpen = state.isOpen;
		this.title = state.title;

		this.editorWrapper.setEditorState(this);
		this.editorID = state.id;
		if(mustPerformChange) {
			state.deltas.forEach((d) => {
				this.addDelta(d, true);
			});
		}
		state.cursors.forEach((c) => { });
	}
	public serialize() {
		return {
			deltas: _.map(this.getDeltas(), d => d.serialize() ),
			isOpen: this.isOpen,
			id: this.editorID,
			title: this.title,
			modified: this.modified,
			remoteCursors: this.remoteCursors.serialize()
		}
	};
	public getDeltas():Array<UndoableDelta> { return this.deltas; };
	public setTitle(newTitle:string):void { this.title = newTitle; };
	public setIsOpen(val:boolean):void { this.isOpen = val; };
	public setIsModified(val:boolean):void { this.modified = val; };
	public getEditorWrapper():EditorWrapper { return this.editorWrapper; };
	public getTitle():string { return this.title; };
	public getIsOpen():boolean { return this.isOpen; };
	public getRemoteCursors():RemoteCursorMarker { return this.remoteCursors; };
	public getEditorID():string { return this.editorID; };
	public getIsModified():boolean { return this.modified; };
	public addHighlight(range, extraInfo):number {
		return this.getEditorWrapper().addHighlight(range, extraInfo);
	}
	public removeHighlight(highlightID:number, extraInfo):boolean {
		return this.getEditorWrapper().removeHighlight(highlightID, extraInfo);
	}
	public focus(range, extraInfo):boolean {
		return this.getEditorWrapper().focus(range, extraInfo);
	}
	private moveDeltaPointer(index:number) {
		let d:UndoableDelta;
		const editorWrapper = this.getEditorWrapper();

		if(this.deltaPointer < index) {
			while(this.deltaPointer < index) {
				this.deltaPointer++;
				d = this.deltas[this.deltaPointer];
				d.doAction(editorWrapper);
			}
		} else if(this.deltaPointer > index) {
			while(this.deltaPointer > index) {
				d = this.deltas[this.deltaPointer];
				d.undoAction(editorWrapper);
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

	public getTextBeforeDelta(delta:UndoableDelta, asLines:boolean=false) {
		return this.getTextAfterIndex(this.getDeltaIndex(delta)-1, asLines);
	}
	public getTextAfterDelta(delta:UndoableDelta, asLines:boolean=false) {
		return this.getTextAfterIndex(this.getDeltaIndex(delta), asLines);
	};

	private getDeltaIndex(delta:UndoableDelta):number {
		return this.deltas.indexOf(delta);
	}

	private getTextAfterIndex(index:number, asLines:boolean):(string|Array<string>) {
		const cmInterface = {
			editor: CodeMirror(null),
			setText: function(value:string) {
				this.editor.setValue(value);
			},
			replaceText: function(range, value:string) {
				this.editor.replaceRange(value, {
					line: range.start[0],
					ch: range.start[1]
				}, {
					line: range.end[0],
					ch: range.end[1]
				});
			},
			getValue: function():string {
				return this.editor.getValue();
			},
			getLines: function():Array<string> {
				let lines:Array<string> = [];
				const doc = this.editor.getDoc();
				doc.eachLine((l) => {
					lines.push(doc.getLine(doc.getLineNumber(l)));
				});
				return lines;
			},
			destroy: function() {
				this.editor.clearHistory();
			}
		};
		for(let i = 0; i<=index; i++) {
			const delta = this.deltas[i];
			if(delta instanceof OpenDelta) {
				const oDelta:OpenDelta = delta as OpenDelta;
				cmInterface.setText(oDelta.getContents());
			} else if(delta instanceof EditDelta) {
				const eDelta:EditDelta = delta as EditDelta;
				eDelta.getChanges().forEach( (c:EditChange) => {
					cmInterface.replaceText(c.getOldRange(), c.getNewText())
				});
			} else {
				continue;
			}
		}
		const value = asLines ? cmInterface.getLines() : cmInterface.getValue();
		cmInterface.destroy();
		return value;
	}

	public addDelta(serializedDelta, mustPerformChange:boolean):UndoableDelta {
		const {type} = serializedDelta;
		const author:ChatUser = this.userList.getUser(serializedDelta.uid);
		let delta;

		if(type === 'open') {
			delta = new OpenDelta(serializedDelta, author, this);
		} else if(type === 'edit') {
			delta = new EditDelta(serializedDelta, author, this);
		} else if(type === 'modified') {
			delta = new ModifiedDelta(serializedDelta, author, this);
		} else if(type === 'grammar') {
			delta = new GrammarDelta(serializedDelta, author, this);
		} else if(type === 'title') {
			delta = new TitleDelta(serializedDelta, author, this);
		} else if(type === 'destroy') {
			delta = new DestroyDelta(serializedDelta, author, this);
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

		if(oldDeltaPointer < 0 || oldDeltaPointer >= lastDeltaBefore) { // is current
			this.moveDeltaPointer(lastDeltaBefore);
			this.deltas.splice(this.deltaPointer+1, 0, delta);
			if(mustPerformChange === false) {
				this.deltaPointer = this.deltaPointer + 1; // will not include this delta as we move forward
			}
		} else {
			this.deltas.splice(lastDeltaBefore + 1, 0, delta);
		}

		// Go forward and do all of the deltas that come after.
		this.updateDeltaPointer();
	}
	public removeUserCursors(user) {
		this.remoteCursors.removeUserCursors(user);
	}
	private getCurrentTimestamp():number { return this.currentTimestamp; }
	public setCurrentTimestamp(timestamp:number, extraInfo?) {
		const editorWrapper = this.getEditorWrapper();
		this.currentTimestamp = timestamp;

		editorWrapper.setReadOnly(!this.isLatestTimestamp(), extraInfo);
		this.updateDeltaPointer();
	};
	private updateDeltaPointer():void {
		if(this.isLatestTimestamp()) {
			this.moveDeltaPointer(this.deltas.length-1);
		} else {
			const lastDeltaBefore:number = this.getLastDeltaIndexBeforeTimestamp(this.getCurrentTimestamp());
			this.moveDeltaPointer(lastDeltaBefore);
		}
	};
	private isLatestTimestamp():boolean {
		return this.getCurrentTimestamp() === CURRENT;
	};
	public hasDeltaAfter(timestamp:number):boolean {
		return _.last(this.getDeltas()).getTimestamp() > timestamp;
	};
}

export class EditorStateTracker extends EventEmitter {
    private editorStates:Map<string, EditorState> = new Map();
	private currentTimestamp:number=CURRENT;
    constructor(protected EditorWrapperClass, private channelCommunicationService:ChannelCommunicationService, private userList:ChatUserList) {
		super();
		this.channelCommunicationService.getShareDBEditors().then((editorDoc) => {
			editorDoc.data.forEach((li) => {
				this.onEditorOpened(li, true);
			});
			editorDoc.on('op', (ops) => {
				ops.forEach((op) => {
					const {p} = op;
					if(p.length === 1) { // new editor
						if(_.has(op, 'li')) {
							const {li} = op;
							this.onEditorOpened(li, true);
						}
					}
				});
			});
		});
		this.channelCommunicationService.getShareDBCursors().then((cursorsDoc) => {
			_.each(cursorsDoc.data, (cursorInfo:any, editorID:string) => {
				const editor = this.getEditorState(editorID);
				if(editor) {
					const remoteCursors = editor.getRemoteCursors();
					_.each(cursorInfo['userCursors'], (cursorInfo:any, userID:string) => {
						const {newBufferPosition} = cursorInfo;
						const user = this.userList.getUser(userID);
						if(user) { remoteCursors.updateCursor(user.getID(), user, newBufferPosition); }
					});
					_.each(cursorInfo['userSelections'], (selectionInfo:any, userID:string) => {
						const {newRange} = selectionInfo;
						const user = this.userList.getUser(userID);
						if(user) { remoteCursors.updateSelection(user.getID(), user, newRange); }
					});
				}
			});

			cursorsDoc.on('op', (ops) => {
				ops.forEach((op) => {
					const {p, oi, od} = op;
					const editorID = p[0];
					const editor = this.getEditorState(editorID);

					if(editor) {
						const remoteCursors = editor.getRemoteCursors();
						if(p.length === 3) {
							const isUserCursor:boolean = p[1] === 'userCursors';
							const isUserSelection:boolean = p[1] === 'userSelections';
							const userID:string = p[2];
							const user = this.userList.getUser(userID);
							if(oi) {
								if(isUserCursor) {
									remoteCursors.updateCursor(user.getID(), user, oi['newBufferPosition']);
								} else if(isUserSelection) {
									remoteCursors.updateSelection(user.getID(), user, oi['newRange']);
								}
							} else if(od) {
								remoteCursors.removeUserCursors(user);
							}
						} else if(p.length === 1) {
							_.each(cursorsDoc.data[editorID]['userCursors'], (cursorInfo:any, userID:string) => {
								const {newBufferPosition} = cursorInfo;
								const user = this.userList.getUser(userID);
								remoteCursors.updateCursor(user.getID(), user, newBufferPosition);
							});
							_.each(cursorsDoc.data[editorID]['userSelections'], (selectionInfo:any, userID:string) => {
								const {newRange} = selectionInfo;
								const user = this.userList.getUser(userID);
								remoteCursors.updateSelection(user.getID(), user, newRange);
							});
						}
					} else {
						console.error(`Could not find editor ${editorID}`)
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

	public createEditor(id:string, title:string, contents:string, grammarName:string, modified:boolean) {
		this.channelCommunicationService.getShareDBEditors().then((editorDoc) => {
			const data = { title, id, contents, grammarName, modified, userCursors:{}, userSelections:{} };
			editorDoc.submitOp({p: [editorDoc.data.length], li: data});
			this.onEditorOpened(data, true);
		});
	}

	public getAllEditors():Array<EditorState> {
		return Array.from(this.editorStates.values());
	}

	public handleEvent(event, mustPerformChange:boolean):UndoableDelta {
		const editorState = this.getEditorState(event.id);
		if(editorState) {
			return editorState.addDelta(event, mustPerformChange);
		}
		return null;
	};

	public getEditorState(editorID:string):EditorState {
        if(this.editorStates.has(editorID)) {
    		return this.editorStates.get(editorID);
        } else {
            return null;
        }
	}

	public getActiveEditors():Array<EditorState> {
		const rv = _.filter(this.getAllEditors(), s => s.getIsOpen());
		return rv;
	}

	public onEditorOpened(state, mustPerformChange:boolean):EditorState {
		const {id} = state;
		if(this.editorStates.has(id)) {
			return this.editorStates.get(id);
		} else {
			const editorState =  new EditorState(state, new this.EditorWrapperClass(state, this.channelCommunicationService), this.userList, mustPerformChange);
			this.editorStates.set(id, editorState);
			return editorState;
		}
	}

	public removeUserCursors(user):void {
		this.editorStates.forEach((es:EditorState) => {
			es.removeUserCursors(user);
		});
	}
	public hasDeltaAfter(timestamp:number):boolean {
		return _.any(this.getAllEditors(), (e) => e.hasDeltaAfter(timestamp));
	};
	public addHighlight(editorID:string, range:SerializedRange, timestamp:number, extraInfo={}):number {
		this.setCurrentTimestamp(timestamp, extraInfo);

		const editorState:EditorState = this.getEditorState(editorID);
		if(editorState) {
			return editorState.addHighlight(range, extraInfo);
		} else {
			return -1;
		}
	}
	public removeHighlight(editorID:string, highlightID:number, extraInfo={}):boolean {
		const editorState:EditorState = this.getEditorState(editorID);
		if(editorState) {
			return editorState.removeHighlight(highlightID, extraInfo);
		} else {
			return false;
		}
	}
	public focus(editorID:string, range:SerializedRange, timestamp:number, extraInfo={}):boolean {
		this.setCurrentTimestamp(timestamp, extraInfo);

		const editorState:EditorState = this.getEditorState(editorID);
		if(editorState) {
			return editorState.focus(range, extraInfo);
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
	};
	public getCurrentTimestamp():number {
		return this.currentTimestamp;
	};
	public setCurrentTimestamp(timestamp:number, extraInfo?):void {
		if(timestamp !== CURRENT && !this.hasDeltaAfter(timestamp)) {
			timestamp = CURRENT;
		}
		this.currentTimestamp = timestamp;
		_.each(this.getAllEditors(), (e:EditorState) => {
			e.setCurrentTimestamp(timestamp, extraInfo);
		});
		(this as any).emit('timestampChanged', {
			timestamp: timestamp
		});
	};
	public toLatestTimestamp(extraInfo?):void {
		return this.setCurrentTimestamp(CURRENT, extraInfo);
	};
	public goBeforeDelta(delta:UndoableDelta, extraInfo?) {
		this.setCurrentTimestamp(delta.getTimestamp()-1, extraInfo);
	};
	public goAfterDelta(delta:UndoableDelta, extraInfo?) {
		this.setCurrentTimestamp(delta.getTimestamp()+1, extraInfo);
	};
	public isAtLatest():boolean {
		return this.getCurrentTimestamp() === CURRENT;
	};
	public isShowingCodeBefore(delta:UndoableDelta):boolean {
		return this.getCurrentTimestamp() === delta.getTimestamp()-1;
	}
	public isShowingCodeAfter(delta:UndoableDelta):boolean {
		return this.getCurrentTimestamp() === delta.getTimestamp()+1;
	}
}
