import * as _ from 'underscore';
import { ChatUser, ChatUserList } from './chat-user';
import { EditorStateTracker, EditorState } from './editor-state-tracker';
import { ChannelCommunicationService } from './communication-service';
import { EventEmitter } from 'typed-event-emitter';
import * as showdown from 'showdown';
import * as difflib from 'difflib';
import * as ShareDB from 'sharedb/lib/client';

function tstamp(x:number|Timestamped):number {
	if(typeof(x) === typeof(1)) { return (x as number); }
	else { return (x as Timestamped).getTimestamp(); }
}
function before(a:number|Timestamped, b:number|Timestamped):boolean { return tstamp(a) < tstamp(b); }
function after(a:number|Timestamped, b:number|Timestamped):boolean { return tstamp(a) > tstamp(b); }
function beforeEQ(a:number|Timestamped, b:number|Timestamped):boolean { return tstamp(a) <= tstamp(b); }
function afterEQ(a:number|Timestamped, b:number|Timestamped):boolean { return tstamp(a) >= tstamp(b); }

function reverseArr(input) {
    var ret = new Array;
    for(var i = input.length-1; i >= 0; i--) {
        ret.push(input[i]);
    }
    return ret;
}

enum ConnectionAction {
	connect = 1,
	disconnect
};

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

export class ConnectionMessage implements Timestamped {
	constructor(private user:ChatUser, private timestamp:number, private action:ConnectionAction) { }
	public getUser():ChatUser { return this.user; };
	public getTimestamp():number { return this.timestamp; };
	public isConnect():boolean { return this.action === ConnectionAction.connect; }
	public isDisconnect():boolean { return this.action !== ConnectionAction.connect; }
}

export class EditMessage implements Timestamped {
	constructor(private users:Array<ChatUser>, private editors:Array<EditorState>, private timestamp:number, private contents) { }
	public getUsers():Array<ChatUser> { return this.users; };
	public getEditors():Array<EditorState> { return this.editors; };
	public getTimestamp():number { return this.timestamp; };
	public getContents() { return this.contents; };
}

export class TextMessage implements Timestamped {
	constructor(private sender:ChatUser, private timestamp:number, private message:string, private editorsVersion:number, editorStateTracker:EditorStateTracker) {
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
	public getEditorVersion():number { return this.editorsVersion; };

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
	public clearItems() {
		for(let i = 0; i<this.items.length; i++) {
			this.removeItem(i);
			i--;
		}
	};
	public removeItem(i:number) {
		const item = this.items[i];
		(this as any).emit('item-will-be-removed', {
			group: this,
			item: item
		});
		this.items.splice(i, 1);
		(this as any).emit('item-removed', {
			group: this,
			item: item
		});
	}
}

export class EditGroup extends Group<EditMessage> {
	public getDiffSummary():Array<any> {
		const contentMap:Map<string, any> = new Map();
		this.getItems().forEach((em:EditMessage) => {
			const contents = em.getContents();
			_.each(contents, (info, editorID:string) => {
				contentMap.set(editorID, info);
			})
		});
		const editors = this.getEditorStates();
		const editorMap:Map<string, EditorState> = new Map<string, EditorState>();
		editors.forEach((ed:EditorState) => {
			editorMap.set(ed.getEditorID(), ed);
		});
		const diffs = [];
		contentMap.forEach((info, editorID) => {
			const editorState = editorMap.get(editorID);
			const editorTitle = editorState.getTitle();
			const {valueBefore, valueAfter} = info;

			let diff = difflib.unifiedDiff(valueBefore.split('\n'), valueAfter.split('\n'), {fromfile:editorTitle, tofile:editorTitle});
			if(diff.length > 0) { diff[0]=diff[0].trim(); }
			if(diff.length > 1) { diff[1]=diff[1].trim(); }
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

	public getEditorStates():Array<EditorState> {
		const editorStates = _.chain(this.getItems())
								.map(delta => delta.getEditors())
								.flatten()
								.compact()
								.unique()
								.value();
		return editorStates;
	}
	public getAuthors():Array<ChatUser> {
		const authors = _.chain(this.getItems())
								.map(delta => delta.getUsers())
								.flatten()
								.compact()
								.unique()
								.value();
		return authors;
	}
	public compatibleWith(item:any):boolean {
		return item instanceof EditMessage;
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
	public getEditorVersion():number {
		return this.getLatestItem().getEditorVersion();
	};
};

export class ConnectionMessageGroup extends Group<ConnectionMessage> {
	public isConnect():boolean { return this.getEarliestItem().isConnect(); }
	public isDisconnect():boolean { return this.getEarliestItem().isDisconnect(); }
	public compatibleWith(item:any):boolean {
		return (item instanceof ConnectionMessage) && ((this.isConnect() && item.isConnect()) || (this.isDisconnect() && item.isDisconnect()));
	};
	protected constructNew(items):ConnectionMessageGroup {
		return new ConnectionMessageGroup(items);
	};
	public getUsers():Array<ChatUser> {
		const users = this.getItems().map(cm => cm.getUser() )
		return _.unique(users);
	}
};

/*
 * A class to keep track of all of the messages in a conversation (where messages are grouped).
 */
export class MessageGroups extends EventEmitter {
    private chatDocPromise:Promise<ShareDB.Doc>;
	private messageGroupingTimeThreshold: number = 5 * 60 * 1000; // The delay between when messages should be in separate groups (5 minutes)
	private messageGroups: Array<Group<TextMessage|EditMessage|ConnectionMessage>> = [];
	public ready:Promise<any>;
	constructor(private channelService:ChannelCommunicationService, private chatUserList:ChatUserList, public editorStateTracker:EditorStateTracker) {
		super();
        this.chatDocPromise = this.channelService.getShareDBChat();
		this.ready = Promise.all([this.chatDocPromise, this.chatUserList.ready, editorStateTracker.ready]).then((info) => {
			const doc:ShareDB.Doc = info[0];
			doc.data['messages'].forEach((li) => {
				this.addFromSerializedMessage(li);
			});
            doc.on('op', (ops, source) => {
                ops.forEach((op) => {
                    const {p, li, ld} = op;
                    const [field] = p;
					if(field === 'messages') {
						const messageGroups = this.getMessageGroups();
						const lastMessageGroup = _.last(messageGroups);
						if(ld && !_.isEmpty(ld) && lastMessageGroup instanceof EditGroup) {
							lastMessageGroup.addItem(this.createMessage(li) as EditMessage);
							lastMessageGroup.removeItem(0);
						} else if(li) {
							this.addFromSerializedMessage(li);
						}
					}
                });
			});
		});
	};
	private createMessage(li):TextMessage|ConnectionMessage|EditMessage {
		if(!_.has(li, 'type')) {
			return null;
		}

		const {type} = li;
		if(type === 'text') {
			const sender = this.chatUserList.getUser(li.uid);
			return new TextMessage(sender, li.timestamp, li.message, li.editorsVersion, this.editorStateTracker);
		} else if(type === 'join') {
			const user = this.chatUserList.getUser(li.uid);
			return new ConnectionMessage(user, li.timestamp, ConnectionAction.connect);
		} else if(type === 'left') {
			const user = this.chatUserList.getUser(li.uid);
			return new ConnectionMessage(user, li.timestamp, ConnectionAction.disconnect);
		} else if(type === 'edit') {
			const users:Array<ChatUser> = li.users.map((uid) => this.chatUserList.getUser(uid));
			const editors:Array<EditorState> = li.files.map((eid) => this.editorStateTracker.getEditorState(eid));
			return new EditMessage(users, editors, li.endTimestamp, li.fileContents);
		} else {
			console.error(type);
			return null;
		}
	}
	private addFromSerializedMessage(li) {
		const message = this.createMessage(li);
		if(message) {
			return this.addItem(message);
		}
	}

	private typeMatches(item:Timestamped, group:Group<Timestamped>):boolean {
		return (group instanceof EditGroup && item instanceof EditMessage) ||
				(group instanceof TextMessageGroup && item instanceof TextMessage) ||
				(group instanceof ConnectionMessageGroup && item instanceof ConnectionMessage);
	}

	private addItem(item:EditMessage|TextMessage|ConnectionMessage) {
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
			let group:Group<EditMessage|TextMessage|ConnectionMessage>;
			if(item instanceof TextMessage) {
				group = new TextMessageGroup([item]);
			} else if(item instanceof ConnectionMessage){
				group = new ConnectionMessageGroup([item]);
			} else {
				group = new EditGroup([item]);
			}
			this.addGroup(group, insertionIndex);
		}
	}
	private addGroup(group:Group<EditMessage|TextMessage|ConnectionMessage>, insertionIndex:number) {
		(this as any).emit('group-will-be-added', {
			messageGroup: group,
			insertionIndex: insertionIndex
		});
		this.messageGroups.splice(insertionIndex, 0, group);
		(this as any).emit('group-added', {
			messageGroup: group,
			insertionIndex: insertionIndex
		});
		(group as any).on('item-will-be-added', (event) => {
			(this as any).emit('item-will-be-added', event);
		});
		(group as any).on('item-added', (event) => {
			(this as any).emit('item-added', event);
		});
		(group as any).on('item-will-be-removed', (event) => {
			(this as any).emit('item-will-be-removed', event);
		});
		(group as any).on('item-removed', (event) => {
			(this as any).emit('item-removed', event);
		});
	}

	public getMessageGroups() { return this.messageGroups; }

	/**
	 * Returns true if there are no messages and false otherwise
	 * @return {boolean} If there are no messages
	 */
	public isEmpty():boolean {
		return this.messageGroups.length === 0;
	}
}
