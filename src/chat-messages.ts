import * as _ from 'underscore';
import { ChatUser, ChatUserList } from './chat-user';
import { EditorStateTracker, UndoableDelta, EditDelta, EditorState } from './editor-state-tracker';
import { EventEmitter } from 'events';
import * as showdown from 'showdown';
import * as jsdiff from 'diff';
import * as difflib from 'difflib';

function tstamp(x:number|Timestamped):number {
	if(typeof(x) === typeof(1)) {
		return (x as number);
	} else {
		return (x as Timestamped).getTimestamp();
	}
}
function before(a:number|Timestamped, b:number|Timestamped):boolean {
	return tstamp(a) < tstamp(b);
}
function after(a:number|Timestamped, b:number|Timestamped):boolean {
	return tstamp(a) > tstamp(b);
}
function beforeEQ(a:number|Timestamped, b:number|Timestamped):boolean {
	return tstamp(a) <= tstamp(b);
}
function afterEQ(a:number|Timestamped, b:number|Timestamped):boolean {
	return tstamp(a) >= tstamp(b);
}

function reverseArr(input) {
    var ret = new Array;
    for(var i = input.length-1; i >= 0; i--) {
        ret.push(input[i]);
    }
    return ret;
}

export interface Timestamped {
	getTimestamp():number;
}

interface MessageGroup<Timestamped> {
	getEarliestTimestamp():number;
	getLatestTimestamp():number;
	includesTimestamp(timestamp:number):boolean;
	addItem(item):number;
    split(timestamp:number):Array<MessageGroup<Timestamped>>;
	occuredBefore(item:Timestamped|number);
	occuredBeforeEQ(item:Timestamped|number);
	occuredAfter(item:Timestamped|number);
	occuredAfterEQ(item:Timestamped|number);
}

export class TextMessage implements Timestamped {
	constructor(private sender:ChatUser, private timestamp:number, private message:string, editorStateTracker:EditorStateTracker) {
		const htmlBuilder = document.createElement('li');
		htmlBuilder.innerHTML = this.converter.makeHtml(this.message);
		_.each(htmlBuilder.querySelectorAll('a'), (a) => {
			const fileLinkInfo = this.matchFileLinkAttributes(a.getAttribute('href'));
			if(fileLinkInfo) {
				const {fileName, start, end} = fileLinkInfo;
				if(isNaN(start.column)) { start.column = -1; }
				if(isNaN(end.row)) { end.row = start.row; } // just one line
				if(isNaN(end.column)) { end.column = -1; }

				const editorState = editorStateTracker.fuzzyMatch(fileName);
				const fileID = editorState ? editorState.getEditorID() : fileName;

				a.setAttribute('href', 'javascript:void(0)');
				a.setAttribute('class', 'line_ref');

				a.setAttribute('data-file', fileID);
				a.setAttribute('data-start', [start.row, start.column].join(','));
				a.setAttribute('data-end', [end.row, end.column].join(','));
			}
		});
		this.html = htmlBuilder.innerHTML;
	}
	private html:string;
	public getSender():ChatUser { return this.sender; };
	public getTimestamp():number { return this.timestamp; };
	public getMessage():string { return this.message; };
	public getHTML():string { return this.html; };

	private converter = new showdown.Converter({simplifiedAutoLink: true});
	private fileLinkRegexp = new RegExp('^(.+):\s*L(\\d+)(\\s*,\\s*(\\d+))?(\s*-\s*L(\\d+)(\\s*,\\s*(\\d+))?)?$')
	private matchFileLinkAttributes(str) {
		const match = str.match(this.fileLinkRegexp);
		if(match) {
			return {
				fileName: match[1],
				start: {
					row:  parseInt(match[2]),
					column: parseInt(match[4])
				},
				end: {
					row:  parseInt(match[6]),
					column: parseInt(match[8])
				}
			};
		} else {
			return false;
		}
	};
}

class Group<T extends Timestamped> extends EventEmitter implements MessageGroup<T> {
	private items:Array<T>=[];
	constructor(items:Array<Timestamped>) {
		super();
		items.forEach((item:T) => {
			this.doAddItem(item);
		});
	};

	public getItems():Array<T> { return this.items; }
	public getEarliestItem():T { return _.first(this.getItems()); }
	public getLatestItem():T { return _.last(this.getItems()); }
	public getEarliestTimestamp():number { return this.getEarliestItem().getTimestamp(); }
	public getLatestTimestamp():number { return this.getLatestItem().getTimestamp(); }
	public includesTimestamp(timestamp:number):boolean {
		return afterEQ(timestamp, this.getEarliestTimestamp()) && beforeEQ(timestamp, this.getLatestTimestamp());
	};
	public occuredBefore(item:Timestamped|number):boolean {
		return before(this.getLatestTimestamp(), item);
	};
	public occuredBeforeEQ(item:Timestamped|number):boolean {
		return beforeEQ(this.getLatestTimestamp(), item);
	};
	public occuredAfter(item:Timestamped|number):boolean {
		return after(this.getLatestTimestamp(), item);
	};
	public occuredAfterEQ(item:Timestamped|number):boolean {
		return afterEQ(this.getLatestTimestamp(), item);
	};
	private getInsertionIndex(timestamp:number):number {
		const items = this.getItems();

		let i = items.length-1;
		for(; i>=0; i--) {
			if(before(this.items[i], timestamp)) {
				return i+1;
			}
		}
		return i;
	}
	public split(timestamp:number):Array<Group<T>> {
		const index = this.getInsertionIndex(timestamp);
		const beforeIndex = this.constructNew(this.items.slice(0, index));
		const afterIndex = this.constructNew(this.items.slice(index));
		return [beforeIndex, afterIndex];
	};
	private doAddItem(item:T) {
		const insertionIndex = this.getInsertionIndex(item.getTimestamp());
		this.items.splice(insertionIndex, 0, item);
		return {
			insertionIndex: insertionIndex,
			item: item
		};
	};
	public addItem(titem:T):number {
		(this as any).emit('item-will-be-added', {
			group: this,
			item: titem
		});
		const {insertionIndex, item} = this.doAddItem(titem);
		(this as any).emit('item-added', {
			group: this,
			item: titem,
			insertionIndex: insertionIndex
		});
		return insertionIndex;
	};
	public compatibleWith(item:any):boolean {
		return true;
	};
	protected constructNew(items):Group<T> {
		return new Group<T>(items);
	};
}

export class EditGroup extends Group<UndoableDelta> {
	public getDiffSummary():Array<any> {
		const textBefore = this.getTextBefore();
		const textAfter = this.getTextAfter();
		const diffs = [];
		for(let i = 0; i<textBefore.length; i++) {
			let tbEditorState:EditorState = textBefore[i].editorState;
			for(let j = 0; j<textAfter.length; j++) {
				let taEditorState:EditorState = textAfter[j].editorState;
				if(taEditorState === tbEditorState) {
					const editorState:EditorState = taEditorState;
					const valueBefore = textBefore[i].value;
					const valueAfter = textAfter[j].value;
					let diff = difflib.unifiedDiff(valueBefore, valueAfter, {fromfile:editorState.getTitle(), tofile:editorState.getTitle()});
					diff[0]=diff[0].trim();
					diff[1]=diff[1].trim();
					diff = diff.join('\n');
					diffs.push({
						editorState: editorState,
						valueBefore: valueBefore,
						valueAfter: valueBefore,
						diff: diff
					});
					break;
				}
			}
		}
		return diffs;
	};

	private getTextBefore():Array<any> {
		const editorStates = [];
		const rv = [];
		this.getItems().forEach((d:UndoableDelta) => {
			const editorState = d.getEditorState();
			if(_.indexOf(editorStates, editorState)<0) {
				editorStates.push(editorState);
				rv.push({
					editorState: editorState,
					value: editorState.getTextBeforeDelta(d, true)
				});
			}
		});
		return rv;
	}
	private getTextAfter():Array<any> {
		const editorStates = [];
		const rv = [];
		reverseArr(this.getItems()).forEach((d:UndoableDelta) => {
			const editorState = d.getEditorState();
			if(_.indexOf(editorStates, editorState)<0) {
				editorStates.push(editorState);
				rv.push({
					editorState: editorState,
					value: editorState.getTextAfterDelta(d, true)
				});
			}
		});
		return rv;
	}

	public getEditorStates():Array<EditorState> {
		const editorStates = this.getItems().map(delta => delta.getEditorState() );
		return _.unique(editorStates);
	}
	public getAuthors():Array<ChatUser> {
		const authors = this.getItems().map(delta => delta.getAuthor() )
		return _.unique(authors);
	}
	public compatibleWith(item:any):boolean {
		return item instanceof EditDelta;
	};
	protected constructNew(items):EditGroup {
		return new EditGroup(items);
	};
}
/*
 * MessageGroup represents a group of messages that were sent by the same user *around*
 * the same time with no other users interrupting.
 */
export class TextMessageGroup extends Group<TextMessage> {
	public getSender():ChatUser { return this.getEarliestItem().getSender(); }
	public compatibleWith(item:TextMessage):boolean {
		return item instanceof TextMessage && item.getSender() === this.getSender();
	};
	protected constructNew(items):TextMessageGroup {
		return new TextMessageGroup(items);
	};
};

/*
 * A class to keep track of all of the messages in a conversation (where messages are grouped).
 */
export class MessageGroups extends EventEmitter {
	constructor(private chatUserList:ChatUserList, public editorStateTracker:EditorStateTracker) {
		super();
	};
	private messageGroupingTimeThreshold: number = 5 * 60 * 1000; // The delay between when messages should be in separate groups (5 minutes)
	private messageGroups: Array<Group<TextMessage|UndoableDelta>> = [];
	private messages:Array<any> = [];

	public getMessageHistory():Array<any> {
		return this.messages;
	}

	private typeMatches(item:Timestamped, group:Group<Timestamped>):boolean {
		return (group instanceof EditGroup && item instanceof EditDelta) ||
				(group instanceof TextMessageGroup && item instanceof TextMessage);
	}

	private addItem(item:UndoableDelta|TextMessage) {
		const itemTimestamp = item.getTimestamp();
		let insertedIntoExistingGroup:boolean = false;
		let i = this.messageGroups.length-1

		for(; i>=0; i--) {
			const messageGroup = this.messageGroups[i];
			if(messageGroup.includesTimestamp(itemTimestamp)) {
				if(messageGroup.compatibleWith(item)) {
					messageGroup.addItem(item);
					insertedIntoExistingGroup = true;
					break;
				} else {
					(this as any).emit('group-will-be-removed', {
						messageGroup: messageGroup,
						insertionIndex: i
					});
					this.messageGroups.splice(i, 1);
					(this as any).emit('group-removed', {
						messageGroup: messageGroup,
						insertionIndex: i
					});
					const splitGroup = messageGroup.split(itemTimestamp);
					splitGroup.forEach((mg, j) => {
						this.addGroup(mg, i+j);
					});
					i+=splitGroup.length; // on the next loop, will be at the later split
					continue;
				}
			} else if(messageGroup.occuredBefore(itemTimestamp)) {
				if(messageGroup.compatibleWith(item) && (itemTimestamp <= messageGroup.getEarliestTimestamp()+this.messageGroupingTimeThreshold)) {
					messageGroup.addItem(item);
					insertedIntoExistingGroup = true;
				}
				break;
			}
		}

		if(!insertedIntoExistingGroup) {
			const insertionIndex = i+1;
			let group:Group<UndoableDelta|TextMessage>;
			if(item instanceof TextMessage) {
				group = new TextMessageGroup([item]);
			} else {
				group = new EditGroup([item]);
			}
			this.addGroup(group, insertionIndex);
		}
	}
	private addGroup(group:Group<UndoableDelta|TextMessage>, insertionIndex:number) {
		(this as any).emit('group-will-be-added', {
			messageGroup: group,
			insertionIndex: insertionIndex
		});
		this.messageGroups.splice(insertionIndex, 0, group);
		(this as any).emit('group-added', {
			messageGroup: group,
			insertionIndex: insertionIndex
		});
	}

	public addTextMessage(data) {
		this.messages.push(data);
		const sender = this.chatUserList.getUser(data.uid);
		const message:TextMessage = new TextMessage(sender, data.timestamp, data.message, this.editorStateTracker);
		return this.addItem(message);
	};
	public addDelta(delta:UndoableDelta) {
		if(delta instanceof EditDelta) {
			this.addItem(delta);
		}
	};
	public getMessageGroups() { return this.messageGroups; }

	/**
	 * Returns true if there are no messages and false otherwise
	 * @return {boolean} If there are no messages
	 */
	public isEmpty():boolean {
		return this.messageGroups.length === 0;
	}
}