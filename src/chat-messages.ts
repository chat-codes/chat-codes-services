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
	constructor(private parent:MessageGroups, private sender:ChatUser, private timestamp:number, messages: Array<any>) {
		super();
		this.doAddMessage.apply(this, messages);
	}

	private messages: Array<any> = [];
	private converter = new showdown.Converter();

	private getLinkDataInfo(html):String{
		var htmlLatter = html.substring(html.indexOf("<a href=\"") + "<a href=\"".length);
		var linkedDataInfo = htmlLatter.substring(htmlLatter.indexOf("\">")+2, htmlLatter.indexOf("</a>"));
		return linkedDataInfo;
	}

	private translatedataInfo(dataInfo):String{
		var dataLine = -1;
		var dataCol = -1;
		if(dataInfo.indexOf(",") != -1){
			var splitted = dataInfo.split("," , 2);
			dataLine = Number(splitted[0]);
			dataCol = Number(splitted[1]);
		}else{
			dataLine = Number(dataInfo);
		}
		return dataLine+","+dataCol;
	}

	private doAddMessage(...messages):void {
		const editorStateTracker = this.parent.editorStateTracker;
		_.each(messages, (message) => {
			message.html = this.converter.makeHtml(message.message);
			var html = document.createElement('li');
			html.innerHTML = message.html;
			var aList = html.querySelectorAll("a");
			if(aList.length!=0){
				_.each(aList, (a)=>{
					var dataInfoString = a.href;
					var fileName = "None";
					var lIndex1 = dataInfoString.indexOf(":L");
					var lIndex2 = dataInfoString.indexOf("-L");

					if( lIndex1 != -1 && lIndex2 != -1 && lIndex1 < lIndex2 ){
						fileName = dataInfoString.substring(0, lIndex1);
						const editorState = editorStateTracker.fuzzyMatch(fileName);
						const fileID = editorState ? editorState.getEditorID() : fileName;
						var dataStartInfo = dataInfoString.substring(lIndex1+":L".length, lIndex2);
						var dataEndInfo = dataInfoString.substring(lIndex2+"-L".length);
						a.href = "javascript:void(0)";
						a.setAttribute("data-file", fileID);
						a.setAttribute("data-start", this.translatedataInfo(dataStartInfo));
						a.setAttribute("data-end", this.translatedataInfo(dataEndInfo));
						a.setAttribute("class", "line_ref");
					}
					else if(lIndex1 != -1){
						fileName = dataInfoString.substring(0, lIndex1);
						const editorState = editorStateTracker.fuzzyMatch(fileName);
						const fileID = editorState ? editorState.getEditorID() : fileName;
						var dataStartInfo = dataInfoString.substring(lIndex1+ ":L".length);
						a.href = "javascript:void(0)";
						a.setAttribute("data-file", fileID);
						a.setAttribute("data-start", this.translatedataInfo(dataStartInfo));
						a.setAttribute("data-end", "-1,-1");
						a.setAttribute("class", "line_ref");
					}
				})
			}
			message.html = html.innerHTML;
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

	/**
	 * Returns true if there are no messages and false otherwise
	 * @return {boolean} If there are no messages
	 */
	public isEmpty():boolean {
		return this.messageGroups.length === 0;
	}
}
