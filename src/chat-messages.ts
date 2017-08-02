import * as _ from 'underscore';
import { ChatUser, ChatUserList } from './chat-user';
import { EditorStateTracker } from './editor-state-tracker';
import { EventEmitter } from 'events';
import * as showdown from 'showdown';

/*
 * MessageGroup represents a group of messages that were sent by the same user *around*
 * the same time with no other users interrupting.
 */
export class MessageGroup extends EventEmitter {
	constructor(private sender:ChatUser, private timestamp:number, messages: Array<any>) {
		super();
		this.doAddMessage.apply(this, messages);
	}

	private messages: Array<any> = [];
	private converter = new showdown.Converter();

	private doAddMessage(...messages):void {
		_.each(messages, (message) => {
			message.html = this.converter.makeHtml(message.message);
			this.messages.push(message);
		});
	};

	public addMessage(message) {
		this.doAddMessage(message);
		(this as any).emit('message-added', {
			message: message
		});
	};


	public getSender():ChatUser { return this.sender; }
	public getTimestamp() { return this.timestamp; }
	public getMessages():Array<any> { return this.messages; }
};

/*
 * A class to keep track of all of the messages in a conversation (where messages are grouped).
 */
export class MessageGroups extends EventEmitter {
	constructor(private chatUserList:ChatUserList, private editorStateTracker:EditorStateTracker) {
		super();
	};
	private messageGroupingTimeThreshold: number = 5 * 60 * 1000; // The delay between when messages should be in separate groups (5 minutes)
	private messageGroups: Array<MessageGroup> = [];
	private messages:Array<any> = [];

	public getMessageHistory():Array<any> {
		return this.messages;
	}
	public addMessage(data) {
		this.messages.push(data);

		let lastMessageGroup = _.last(this.messageGroups);
		let groupToAddTo = lastMessageGroup;

		// const editor = this.editorStateTracker.fuzzyMatch(data.message);
		// if(editor) {
		// 	const editorID = editor.getEditorID();
		// 	data.editorID = editorID;
		// }

		if (!lastMessageGroup || (lastMessageGroup.getTimestamp() < data.timestamp - this.messageGroupingTimeThreshold) || (lastMessageGroup.getSender().id !== data.uid)) {
			// Add to a new group
			const sender = this.chatUserList.getUser(data.uid);
			const messageGroup = new MessageGroup(sender, data.timestamp, [data]);
			this.messageGroups.push(messageGroup);

			(this as any).emit('group-added', {
				messageGroup: messageGroup
			});
		} else {
			// Add to the latest group
			groupToAddTo.addMessage(data);
		}
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
