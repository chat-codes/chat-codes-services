import * as _ from 'underscore';
import { ChatUser, ChatUserList } from './chat-user';
import { EditorStateTracker, UndoableDelta, EditChange, EditorState } from './editor-state-tracker';
import { EventEmitter } from 'events';
import * as showdown from 'showdown';

export interface DisplayableMessage {
	getTimestamp():number;
	getEarliestTimestamp():number;
	getLatestTimestamp():number;
	addItem(item):number;
}

export class EditGroup extends EventEmitter implements DisplayableMessage {
	constructor(private parent:MessageGroups, private deltas:Array<UndoableDelta>) {
		super();
	}
	public getEarliestTimestamp():number { return _.first(this.deltas).getTimestamp(); }
	public getLatestTimestamp():number { return _.last(this.deltas).getTimestamp(); }
	public getTimestamp():number { return this.getLatestTimestamp(); }
	public getDeltas():Array<UndoableDelta> { return this.deltas; }
	public addItem(delta:UndoableDelta):number {
		(this as any).emit('delta-will-be-added', {
			group: this,
			delta: delta
		});
		const insertionIndex = this.getInsertionIndex(delta.getTimestamp());
		this.deltas.splice(insertionIndex, 0, delta);
		(this as any).emit('delta-added', {
			group: this,
			insertionIndex: insertionIndex,
			delta: delta
		});
		return insertionIndex;
	}
	public getEditorStates():Array<EditorState> {
		const editorStates = this.getDeltas().map(delta => delta.getEditorState() );
		return _.unique(editorStates);
	}
	public getAuthors():Array<ChatUser> {
		const authors = this.getDeltas().map(delta => delta.getAuthor() )
		return _.unique(authors);
	}
	private getInsertionIndex(timestamp:number):number {
		const deltas:Array<UndoableDelta> = this.getDeltas();
		for(let i = deltas.length-1; i>=0; i--) {
			const delta = this.deltas[i];
			if(delta.getTimestamp() < timestamp) {
				return i+1;
			}
		}
		return 0;
	}
}

export class Message {
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

/*
 * MessageGroup represents a group of messages that were sent by the same user *around*
 * the same time with no other users interrupting.
 */
export class MessageGroup extends EventEmitter implements DisplayableMessage {
	constructor(private parent:MessageGroups, private chatUserList:ChatUserList, private editorStateTracker:EditorStateTracker, messages: Array<any>) {
		super();
		_.each(messages, (m) => { this.doAddMessage(m); });
	}

	private messages: Array<Message> = [];

	private getLinkDataInfo(html):String{
		var htmlLatter = html.substring(html.indexOf("<a href=\"") + "<a href=\"".length);
		var linkedDataInfo = htmlLatter.substring(htmlLatter.indexOf("\">")+2, htmlLatter.indexOf("</a>"));
		return linkedDataInfo;
	}

	private doAddMessage(message) {
		const editorStateTracker = this.parent.editorStateTracker;

		const sender = this.chatUserList.getUser(message.uid);
		this.sender = sender;

		const messageObject = new Message(sender, message.timestamp, message.message, this.editorStateTracker)
		const insertionIndex = this.getInsertionIndex(messageObject.getTimestamp());
		this.messages.splice(insertionIndex, 0, messageObject);
		return {
			insertionIndex: insertionIndex,
			messageObject: messageObject
		};
	};

	public addItem(message):number {
		(this as any).emit('message-will-be-added', {
			group: this,
			message: message
		});

		const {insertionIndex, messageObject} = this.doAddMessage(message);

		(this as any).emit('message-added', {
			group: this,
			message: messageObject,
			insertionIndex: insertionIndex
		});
		return insertionIndex;
	};

	private sender:ChatUser;
	public getSender():ChatUser { return this.sender; }
	public getMessages():Array<Message> { return this.messages; }
	public getTimestamp():number { return this.getLatestTimestamp(); };
	public getEarliestTimestamp():number { return _.first(this.messages).timestamp; }
	public getLatestTimestamp():number { return _.last(this.messages).timestamp; }

	private getInsertionIndex(timestamp:number):number {
		const messages:Array<Message> = this.getMessages();
		for(let i = messages.length-1; i>=0; i--) {
			const message = this.messages[i];
			if(message.getTimestamp() < timestamp) {
				return i+1;
			}
		}
		return 0;
	}
};

/*
 * A class to keep track of all of the messages in a conversation (where messages are grouped).
 */
export class MessageGroups extends EventEmitter {
	constructor(private chatUserList:ChatUserList, public editorStateTracker:EditorStateTracker) {
		super();
	};
	private messageGroupingTimeThreshold: number = 5 * 60 * 1000; // The delay between when messages should be in separate groups (5 minutes)
	private messageGroups: Array<DisplayableMessage> = [];
	private messages:Array<any> = [];

	public getMessageHistory():Array<any> {
		return this.messages;
	}
	private getAppropriateGroup(checkMatch:(DisplayableMessage)=>boolean, CheckClass) {
		for(let i = this.messageGroups.length-1; i>=0; i--) {
			const messageGroup = this.messageGroups[i];
			// if(messageGroup instanceof CheckClass) {
			if(checkMatch(messageGroup)) {
				return messageGroup;
			} else {
				break;
			}
			// }
		}
		return null;
	}
	private getInsertionIndex(timestamp:number):number {
		for(let i = this.messageGroups.length-1; i>=0; i--) {
			const messageGroup = this.messageGroups[i];
			if(messageGroup.getLatestTimestamp() < timestamp) {
				return i+1;
			}
		}
		return 0;
	}

	public addMessage(data) {
		this.messages.push(data);
		let groupToAddTo:DisplayableMessage = this.getAppropriateGroup((g) => ((g instanceof MessageGroup) &&
											 			((data.timestamp >= g.getLatestTimestamp()  - this.messageGroupingTimeThreshold) ||
														(data.timestamp <= g.getEarliestTimestamp() + this.messageGroupingTimeThreshold)) &&
														g.getSender().getID() === data.uid), MessageGroup);
		if(groupToAddTo) {
			groupToAddTo.addItem(data);
		} else {
			// Add to a new group
			groupToAddTo = new MessageGroup(this, this.chatUserList, this.editorStateTracker, [data]);
			let insertionIndex = this.getInsertionIndex(data.timestamp);


			(this as any).emit('group-will-be-added', {
				messageGroup: groupToAddTo,
				insertionIndex: insertionIndex
			});

			this.messageGroups.splice(insertionIndex, 0, groupToAddTo);

			(this as any).emit('group-added', {
				messageGroup: groupToAddTo,
				insertionIndex: insertionIndex
			});
			(groupToAddTo as any).on('message-will-be-added', (event) => {
				(this as any).emit('message-will-be-added', event);
			});
			(groupToAddTo as any).on('message-added', (event) => {
				(this as any).emit('message-added', event);
			});
		}
	}
	public getMessageGroups() { return this.messageGroups; }
	public addDelta(delta:UndoableDelta) {
		let groupToAddTo:DisplayableMessage = this.getAppropriateGroup((g) => ((g instanceof EditGroup) &&
															((delta.getTimestamp() >= g.getLatestTimestamp()  - this.messageGroupingTimeThreshold) ||
															(delta.getTimestamp() <= g.getEarliestTimestamp() + this.messageGroupingTimeThreshold))), EditGroup);

		if(groupToAddTo) {
			groupToAddTo.addItem(delta);
		} else {
			groupToAddTo = new EditGroup(this, [delta]);
			let insertionIndex = this.getInsertionIndex(delta.getTimestamp());

			(this as any).emit('group-will-be-added', {
				messageGroup: groupToAddTo,
				insertionIndex: insertionIndex
			});

			this.messageGroups.splice(insertionIndex, 0, groupToAddTo);

			(this as any).emit('group-added', {
				messageGroup: groupToAddTo,
				insertionIndex: insertionIndex
			});
			(groupToAddTo as any).on('delta-will-be-added', (event) => {
				(this as any).emit('delta-will-be-added', event);
			});
			(groupToAddTo as any).on('delta-added', (event) => {
				(this as any).emit('delta-added', event);
			});
		}
	}

	/**
	 * Returns true if there are no messages and false otherwise
	 * @return {boolean} If there are no messages
	 */
	public isEmpty():boolean {
		return this.messageGroups.length === 0;
	}
}