import * as _ from 'underscore';
import { ChatUser, ChatUserList } from './chat-user';
import { EditorStateTracker } from './editor-state-tracker';
import { EventEmitter } from 'events';
import * as showdown from 'showdown';

export class EditGroup extends EventEmitter {

}

/*
 * MessageGroup represents a group of messages that were sent by the same user *around*
 * the same time with no other users interrupting.
 */
export class MessageGroup extends EventEmitter {
	constructor(private parent:MessageGroups, private sender:ChatUser, private timestamp:number, messages: Array<any>) {
		super();
		this.doAddMessage.apply(this, messages);
	}

	private messages: Array<any> = [];
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
	}

	private getLinkDataInfo(html):String{
		var htmlLatter = html.substring(html.indexOf("<a href=\"") + "<a href=\"".length);
		var linkedDataInfo = htmlLatter.substring(htmlLatter.indexOf("\">")+2, htmlLatter.indexOf("</a>"));
		return linkedDataInfo;
	}

	private doAddMessage(...messages):void {
		const editorStateTracker = this.parent.editorStateTracker;
		_.each(messages, (message) => {
			const htmlBuilder = document.createElement('li');
			htmlBuilder.innerHTML = this.converter.makeHtml(message.message);
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
			message.html = htmlBuilder.innerHTML;
			this.messages.push(message);
		});
	};

	public addMessage(message) {
		(this as any).emit('message-will-be-added', {
			group: this,
			message: message
		});

		this.doAddMessage(message);

		(this as any).emit('message-added', {
			group: this,
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
	constructor(private chatUserList:ChatUserList, public editorStateTracker:EditorStateTracker) {
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
			const messageGroup = new MessageGroup(this, sender, data.timestamp, [data]);
			this.messageGroups.push(messageGroup);

			(this as any).emit('group-added', {
				messageGroup: messageGroup
			});
			(messageGroup as any).on('message-added', (event) => {
				(this as any).emit('message-added', event);
			});
			(messageGroup as any).on('message-will-be-added', (event) => {
				(this as any).emit('message-will-be-added', event);
			});
		} else {
			// Add to the latest group
			groupToAddTo.addMessage(data);
		}
	}
	public getMessageGroups() { return this.messageGroups; }
	public addEdit(data) {
		console.log(data);
	}

	/**
	 * Returns true if there are no messages and false otherwise
	 * @return {boolean} If there are no messages
	 */
	public isEmpty():boolean {
		return this.messageGroups.length === 0;
	}
}
