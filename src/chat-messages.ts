import * as _ from 'underscore';
import { ChatUser, ChatUserList } from './chat-user';
import { EventEmitter } from 'events';

export class MessageGroup extends EventEmitter {
	constructor(private sender:ChatUser, private timestamp:number, messages: Array<any>) {
		super();
		this.messages.push.apply(this.messages, messages);
	}

	private messages: Array<any> = [];
	public addMessage(message) {
		this.messages.push(message);
		(this as any).emit('message-added', {
			message: message
		});
	}
	public getSender():ChatUser { return this.sender; }
	public getTimestamp() { return this.timestamp; }
	public getMessages():Array<any> { return this.messages; }
};

export class MessageGroups extends EventEmitter {
	constructor(private chatUserList:ChatUserList) {
		super();
	};
	private messageGroupingTimeThreshold: number = 5 * 60 * 1000; // 5 minutes
	private messageGroups: Array<MessageGroup> = [];
	public addMessage(data) {
		let lastMessageGroup = _.last(this.messageGroups);
		let groupToAddTo = lastMessageGroup;

		if (!lastMessageGroup || (lastMessageGroup.getTimestamp() < data.timestamp - this.messageGroupingTimeThreshold) || (lastMessageGroup.getSender().id !== data.uid)) {
			const sender = this.chatUserList.getUser(data.uid);
			const messageGroup = new MessageGroup(sender, data.timestamp, [data]);
			this.messageGroups.push(messageGroup);
			(this as any).emit('group-added', {
				messageGroup: messageGroup
			});
		} else {
			groupToAddTo.addMessage(data);
		}
	}
	public getMessageGroups() { return this.messageGroups; }
	public isEmpty():boolean {
		return this.messageGroups.length === 0;
	}
}
