import * as _ from 'underscore';
import * as FuzzySet from 'fuzzyset.js';
import { EventEmitter } from 'typed-event-emitter';
import { ChannelCommunicationService } from './communication-service';
import { ChatUser, ChatUserList } from './chat-user';
import { Timestamped } from './chat-messages';
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
	public hideCursors() {
		this.editorState.getEditorWrapper().hideRemoteCursors();
	}
	public showCursors() {
		this.editorState.getEditorWrapper().showRemoteCursors(this);
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
	hideRemoteCursors();
	showRemoteCursors(cursors?);
	suspendEditorBinding();
	resumeEditorBinding();
}


export class EditorState {
	private isOpen:boolean;
    private selections:{[selectionID:number]:any} = {};
	private editorID:string;
	private remoteCursors:RemoteCursorMarker = new RemoteCursorMarker(this);
	private title:string;
	private modified:boolean;
	private deltaPointer:number=-1;
	private currentVersion:number=CURRENT;
    constructor(suppliedState, private editorWrapper, private userList:ChatUserList, mustPerformChange:boolean) {
        let state = _.extend({
            isOpen: true,
            deltas: [],
            cursors: []
        }, suppliedState);

		this.isOpen = state.isOpen;
		this.title = state.title;

		this.editorWrapper.setEditorState(this);
		setTimeout(() => {
			this.editorWrapper.setGrammar(state.grammarName);
		}, 100)
		this.editorID = state.id;
		state.cursors.forEach((c) => { });
	}
	public setTitle(newTitle:string):void { this.title = newTitle; };
	public setIsOpen(val:boolean):void { this.isOpen = val; };
	public setIsModified(val:boolean):void { this.modified = val; };
	public getEditorWrapper():EditorWrapper { return this.editorWrapper; };
	public getTitle():string { return this.title; };
	public getIsOpen():boolean { return this.isOpen; };
	public getRemoteCursors():RemoteCursorMarker { return this.remoteCursors; };
	public getEditorID():string { return this.editorID; };
	public getIsModified():boolean { return this.modified; };
	public setText(val:string) {
		this.editorWrapper.setText(val);
	}
	public addHighlight(range, extraInfo):number {
		return this.getEditorWrapper().addHighlight(range, extraInfo);
	}
	public removeHighlight(highlightID:number, extraInfo):boolean {
		return this.getEditorWrapper().removeHighlight(highlightID, extraInfo);
	}
	public focus(range, extraInfo):boolean {
		return this.getEditorWrapper().focus(range, extraInfo);
	}
	public removeUserCursors(user) {
		this.remoteCursors.removeUserCursors(user);
	}
	private getCurrentVersion():number { return this.currentVersion; }
	public setVersion(version:number, extraInfo?) {
		this.currentVersion = version;

		const editorWrapper = this.getEditorWrapper();

		if(this.isLatestVersion()) {
			editorWrapper.resumeEditorBinding();
			editorWrapper.setReadOnly(false, extraInfo);
			this.remoteCursors.showCursors();
		} else {
			editorWrapper.suspendEditorBinding();
			editorWrapper.setReadOnly(true, extraInfo);
			this.remoteCursors.hideCursors();
		}
	}
	private isLatestVersion():boolean {
		return this.getCurrentVersion() === CURRENT;
	};
}

export class EditorStateTracker extends EventEmitter {
    private editorStates:Map<string, EditorState> = new Map();
	private currentVersion:number=CURRENT;
	private currentTimestamp:number=CURRENT;
    public ready:Promise<boolean>;
    constructor(protected EditorWrapperClass, private channelCommunicationService:ChannelCommunicationService, private userList:ChatUserList) {
		super();
		const editorsDocPromise = this.channelCommunicationService.getShareDBEditors().then((editorDoc) => {
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
		const cursorsDocPromise =this.channelCommunicationService.getShareDBCursors().then((cursorsDoc) => {
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
		this.ready = Promise.all([editorsDocPromise, cursorsDocPromise]).then(() => {
			return true;
		});
	}

	public createEditor(id:string, title:string, contents:string, grammarName:string, modified:boolean):Promise<EditorState> {
		return this.channelCommunicationService.getShareDBEditors().then((editorDoc) => {
			const data = { title, id, contents, grammarName, modified, userCursors:{}, userSelections:{} };
			return new Promise((resolve, reject) => {
				editorDoc.submitOp({p: [editorDoc.data.length], li: data}, (err) => {
					if(err) { reject(err); }
					resolve(data);
				});
			});
		}).then((data) => {
			return this.onEditorOpened(data, true);
		});
	}

	public getAllEditors():Array<EditorState> {
		return Array.from(this.editorStates.values());
	}

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
	public addHighlight(editorID:string, range:SerializedRange, version:number, timestamp:number, extraInfo={}):number {
		const editorState:EditorState = this.getEditorState(editorID);
		this.setVersion(version, timestamp, extraInfo);
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
	public focus(editorID:string, range:SerializedRange, version:number, timestamp:number, extraInfo={}):boolean {
		const editorState:EditorState = this.getEditorState(editorID);
		this.setVersion(version, timestamp, extraInfo);
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
	public getCurrentVersion():number {
		return this.currentVersion;
	};
	public isAtLatest():boolean {
		return this.getCurrentVersion() === CURRENT;
	}
	public setVersion(version:number, timestamp:number, extraInfo?):void {
		if(version === CURRENT) {
			this.currentVersion = version;
			this.currentTimestamp = timestamp;
			_.each(this.getAllEditors(), (e:EditorState) => {
				e.setVersion(this.currentVersion, extraInfo);
			});
			(this as any).emit('timestampChanged', {
				version: this.currentVersion
			});
		} else {
			this.channelCommunicationService.getEditorVersion(version).then((data) => {
				this.currentVersion = version;
				this.currentTimestamp = timestamp;
				_.each(this.getAllEditors(), (e:EditorState) => {
					const stateInfo = data.get(e.getEditorID());
					const value = stateInfo ? stateInfo.contents : '';
					e.setVersion(this.currentVersion, extraInfo);
					e.setText(value);
				});
				(this as any).emit('timestampChanged', {
					version: this.currentVersion
				});
			});
		}
	}
	public toLatestVersion(extraInfo?):void {
		this.setVersion(CURRENT, CURRENT, extraInfo);
	}
}
