import * as _ from 'underscore';
import { ChatUserList, ChatUser } from './chat-user'
import { PusherCommunicationLayer } from './pusher-communication-layer';
import { EventEmitter } from 'events';
import { MessageGroups } from './chat-messages';

export class CommunicationService extends EventEmitter {
    constructor(private userName:string, private channelName:string, key:string, cluster:string) {
        super();
        this.commLayer = new PusherCommunicationLayer({
            username: userName
        }, key, cluster);
        this.channelName = channelName;
        this.commLayer.bind(this.channelName, 'terminal-data', (event) => {
            (this as any).emit('terminal-data', event);
        });
        this.commLayer.bind(this.channelName, 'message', (data) => {
            this.messageGroups.addMessage(data);
            (this as any).emit('message', _.extend({
                sender: this.userList.getUser(data.uid)
            }, data));
        });
        this.commLayer.bind(this.channelName, 'message-history', (data) => {
            if(data.forUser === this.myID) {
                data.allUsers.forEach((u) => {
                    this.userList.add(false, u.id, u.name, u.active);
                });
                _.each(data.history, (m) => {
                    this.messageGroups.addMessage(m);
                    (this as any).emit('message', _.extend({
                        sender: this.userList.getUser(m.uid)
                    }, m));
                });
            }
        });
    	this.commLayer.bind(this.channelName, 'typing', (data) => {
            const {uid, status} = data;
            const user = this.userList.getUser(uid);

            if(user) {
                user.setTypingStatus(status);
            }
    	});
        this.commLayer.bind(this.channelName, 'editor-event', (data) => {
            (this as any).emit('editor-event', data);
        });
        this.commLayer.bind(this.channelName, 'cursor-event', (data) => {
            (this as any).emit('cursor-event', data);
        });
    	this.commLayer.bind(this.channelName, 'editor-state', (data) => {
            (this as any).emit('editor-state', data);
    	});
    	this.commLayer.bind(this.channelName, 'editor-opened', (data) => {
            (this as any).emit('editor-opened', data);
    	});

        this.commLayer.getMembers(this.channelName).then((memberInfo) => {
            this.myID = memberInfo.myID;
            this.userList.addAll(memberInfo);
        });

        this.commLayer.onMemberAdded(this.channelName, (member) => {
            this.userList.add(false, member.id, member.info.name);
        });
        this.commLayer.onMemberRemoved(this.channelName, (member) => {
            this.userList.remove(member.id);
        });
    }
    public ready() {
        return this.commLayer.channelReady(this.channelName);
    }
    public emitSave(data) {
        (this as any).emit('message', _.extend({
            sender: this.userList.getMe(),
            timestamp: this.getTimestamp()
        }, data));
    }

    public sendTextMessage(message:string):void {
        const data = {
            uid: this.myID,
            type: 'text',
            message: message,
            timestamp: this.getTimestamp()
        };
        this.messageGroups.addMessage(data);

        this.commLayer.trigger(this.channelName, 'message', data);
        (this as any).emit('message', _.extend({
            sender: this.userList.getMe()
        }, data));
    }
    public sendTypingStatus(status:string):void {
        const data = {
            uid: this.myID,
            type: 'status',
            status: status,
            timestamp: this.getTimestamp()
        };
        const meUser = this.userList.getMe();

        this.commLayer.trigger(this.channelName, 'typing', data);
        (this as any).emit('typing', _.extend({
            sender: this.userList.getMe()
        }, data));

        if(meUser) {
            meUser.setTypingStatus(status);
        }
    }
    public emitEditorChanged(delta) {
        this.commLayer.trigger(this.channelName, 'editor-event', _.extend({
			timestamp: this.getTimestamp(),
            uid: this.myID,
			remote: true
		}, delta));
    }

    public emitCursorPositionChanged(delta) {
        this.commLayer.trigger(this.channelName, 'cursor-event', _.extend({
			timestamp: this.getTimestamp(),
            uid: this.myID,
			remote: true
		}, delta));
    }
    public emitCursorSelectionChanged(delta) {
        this.commLayer.trigger(this.channelName, 'cursor-event', _.extend({
			timestamp: this.getTimestamp(),
            uid: this.myID,
			remote: true
		}, delta));
    }

    public writeToTerminal(data) {
        this.commLayer.trigger(this.channelName, 'write-to-terminal', {
			timestamp: this.getTimestamp(),
            uid: this.myID,
			remote: true,
            contents: data
		});
    }

    public destroy() {
        this.commLayer.destroy();
    }

    public userList:ChatUserList = new ChatUserList();
    public messageGroups:MessageGroups = new MessageGroups(this.userList);

    private commLayer:PusherCommunicationLayer;
    private myID:string;
    private getTimestamp():number {
        return new Date().getTime();
    }
}
