import * as _ from 'underscore';
import { ChatUser, ChatUserList } from './chat-user';
import { EventEmitter } from 'events';
import * as showdown from 'showdown';
import * as $ from 'jquery';

/*
 * MessageGroup represents a group of messages that were sent by the same user *around*
 * the same time with no other users interrupting.
 */
console.log('abcd');
export class MessageGroup extends EventEmitter {
	constructor(private sender:ChatUser, private timestamp:number, messages: Array<any>) {
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

	private translatedataInfo(dataInfo, dataLine, dataCol):void{
		dataLine = -1;
		dataCol = -1;
		if(dataInfo.indexOf(",") != -1){
			var splitted = dataInfo.split("," , 2);
			dataLine = Number(splitted[0]);
			dataCol = Number(splitted[1]);

		}else{
			dataLine = Number(dataInfo);
		}
		console.log(dataLine);
		console.log(dataCol);
	}

	private doAddMessage(...messages):void {
		_.each(messages, (message) => {
			message.html = this.converter.makeHtml(message.message);
			var html = message.html;

      var fileName = "None";
			var dataStartLine = -1;  var dataStartCol = -1;
			var dataEndLine = -1; var dataEndCol = -1;

			if (html.indexOf("<a href=\"") != -1){
				var dataInfoString = this.getLinkDataInfo(html);
				if( dataInfoString.indexOf(":L") != -1 &&
						dataInfoString.indexOf("-L") != -1 &&
						dataInfoString.indexOf(":L") < dataInfoString.indexOf("-L") ){
					fileName = dataInfoString.substring(0, dataInfoString.indexOf(":L"));
					var dataStartInfo = dataInfoString.substring(dataInfoString.indexOf(":L")+2, dataInfoString.indexOf("-L"));
					var dataEndInfo = dataInfoString.substring(dataInfoString.indexOf("-L")+2);
					//this.translatedataInfo(dataStartInfo, dataStartLine, dataStartCol);
					if(dataStartInfo.indexOf(",") != -1){
						var splitted = dataStartInfo.split("," , 2);
						dataStartLine = Number(splitted[0]);
						dataStartCol = Number(splitted[1]);
					}else{
						dataStartLine = Number(dataStartInfo);
					}
					if(dataEndInfo.indexOf(",") != -1){
						var splitted = dataEndInfo.split("," , 2);
						dataEndLine = Number(splitted[0]);
						dataEndCol = Number(splitted[1]);
					}else{
						dataEndLine = Number(dataEndInfo);
					}
					//console.log(fileName);
					//console.log(dataStartLine);
					//console.log(dataStartCol);
					//console.log(dataEndLine);
					//console.log(dataEndCol);
				}
				else if(dataInfoString.indexOf(":L") != -1){
					fileName = dataInfoString.substring(0, dataInfoString.indexOf(":L"));
					var dataStartInfo = dataInfoString.substring(dataInfoString.indexOf(":L")+2);
					if(dataStartInfo.indexOf(",") != -1){
						var splitted = dataStartInfo.split("," , 2);
						dataStartLine = Number(splitted[0]);
						dataStartCol = Number(splitted[1]);
					}else{
						dataStartLine = Number(dataStartInfo);
					}
				}
			}
			message.fileName = fileName;
			message.dataStartLine = dataStartLine;
			message.dataStartCol = dataStartCol;
			message.dataEndLine = dataEndLine;
			message.dataEndCol = dataEndCol;
		  console.log(message);
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
	constructor(private chatUserList:ChatUserList) {
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
