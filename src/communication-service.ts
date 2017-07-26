import * as _ from 'underscore';
import { ChatUserList, ChatUser } from './chat-user'
import { PusherCommunicationLayer } from './pusher-communication-layer';
import { EventEmitter } from 'events';
import { MessageGroups } from './chat-messages';
import {EditorStateTracker} from './editor-state-tracker';
declare function require(name:string);
declare var __dirname:string;

const DEBUG = true;

function generateChannelName(commLayer) {
    const fs = require('fs');
    const path = require('path');
    if(DEBUG) {
        return Promise.resolve('c2');
    } else {
        const WORD_FILE_NAME = 'google-10000-english-usa-no-swears-medium.txt'

        return new Promise(function(resolve, reject) {
            fs.readFile(path.join(__dirname, WORD_FILE_NAME), {encoding: 'utf-8'}, function(err, result) {
                if(err) {
                    reject(err);
                } else {
                    resolve(result);
                }
            });
        }).then(function(words:string) {
            return _.shuffle(words.split(/\n/));
        }).then(function(wordList) {
            function* getNextWord():Iterable<string> {
                for(var i = 0; i<wordList.length; i++) {
                    yield wordList[i];
                }
                var j = 0;
                while(true) {
                    yield j+'';
                    j++;
                }
            }

            function getNextAvailableName(iterator) {
                if(!iterator) {
                    iterator = getNextWord();
                }
                const {value} = iterator.next();
                return commLayer.channelNameAvailable(value).then(function(available) {
                    if(available) {
                        return value;
                    } else {
                        return getNextAvailableName(iterator);
                    }
                });
            }

            return getNextAvailableName(null);
        });
    }
}

export class ChannelCommunicationService extends EventEmitter {
    constructor(private commService:CommunicationService, private channelName:string, EditorWrapperClass) {
        super();
        this.editorStateTracker = new EditorStateTracker(EditorWrapperClass, this);

        this.commLayer = commService.commLayer;
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

            (this as any).emit('typing', _.extend({
                sender: user
            }, data));

            if(user) {
                user.setTypingStatus(status);
            }
    	});
        this.commLayer.bind(this.channelName, 'editor-event', (data) => {
			this.editorStateTracker.handleEvent(data);
            (this as any).emit('editor-event', data);
        });
        this.commLayer.bind(this.channelName, 'cursor-event', (data) => {
			const {id, type, uid} = data;
			let user = this.userList.getUser(uid);

			if(type === 'change-position') {
				const {newBufferPosition, oldBufferPosition, newRange, id, editorID} = data;
				const editorState = this.editorStateTracker.getEditorState(editorID);
				if(editorState) {
					const remoteCursors = editorState.getRemoteCursors();
					remoteCursors.updateCursor(id, user, {row: newBufferPosition[0], column: newBufferPosition[1]});
				}
			} else if(type === 'change-selection') {
				const {newRange, id, editorID} = data;
				const editorState = this.editorStateTracker.getEditorState(editorID);
				if(editorState) {
					const remoteCursors = editorState.getRemoteCursors();
					remoteCursors.updateSelection(id, user, newRange);
				}
			} else if(type === 'destroy') {
				const {newRange, id, editorID} = data;
				const editorState = this.editorStateTracker.getEditorState(editorID);
				if(editorState) {
					const remoteCursors = editorState.getRemoteCursors();
					remoteCursors.removeCursor(id, user);
				}
			}
            (this as any).emit('cursor-event', data);
        });
    	this.commLayer.bind(this.channelName, 'editor-state', (data) => {
            (this as any).emit('editor-state', data);
    	});
    	this.commLayer.bind(this.channelName, 'editor-opened', (data) => {
            const mustPerformChange = !this.isRoot();
    		const editorState = this.editorStateTracker.onEditorOpened(data, mustPerformChange);
            (this as any).emit('editor-opened', data);
    	});
        this.commLayer.bind(this.channelName, 'write-to-terminal', (data) => {
            (this as any).emit('write-to-terminal', data);
        });

        this.commLayer.getMembers(this.channelName).then((memberInfo) => {
            this.myID = memberInfo.myID;
            this.userList.addAll(memberInfo);
        });

        this.commLayer.onMemberAdded(this.channelName, (member) => {
            this.userList.add(false, member.id, member.info.name);
            if(this.isRoot()) {
                this.sendMessageHistory(member.id);
                this.commLayer.trigger(this.channelName, 'editor-state', {
                    forUser: member.id,
                    state: this.editorStateTracker.serializeEditorStates()
                });
            }
        });
        this.commLayer.onMemberRemoved(this.channelName, (member) => {
            this.userList.remove(member.id);
        });
    }
    private isRoot():boolean {
        return this.commService.isRoot;
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
    public emitEditorOpened(data) {
		const editorState = this.editorStateTracker.onEditorOpened(data, false);
        this.commLayer.trigger(this.channelName, 'editor-opened', _.extend({
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
    public emitEditorChanged(delta, remote=true) {
        this.commLayer.trigger(this.channelName, 'editor-event', _.extend({
			timestamp: this.getTimestamp(),
            uid: this.myID,
			remote: remote
		}, delta));
    }

    public emitCursorPositionChanged(delta, remote=true) {
        this.commLayer.trigger(this.channelName, 'cursor-event', _.extend({
			timestamp: this.getTimestamp(),
            uid: this.myID,
			remote: remote
		}, delta));
    }
    public emitCursorSelectionChanged(delta, remote=true) {
        this.commLayer.trigger(this.channelName, 'cursor-event', _.extend({
			timestamp: this.getTimestamp(),
            uid: this.myID,
			remote: remote
		}, delta));
    }
    public emitTerminalData(data, remote=false) {
        this.commLayer.trigger(this.channelName, 'terminal-data', {
			timestamp: this.getTimestamp(),
            data: data,
			remote: remote
		});
    };

    public writeToTerminal(data) {
        this.commLayer.trigger(this.channelName, 'write-to-terminal', {
			timestamp: this.getTimestamp(),
            uid: this.myID,
			remote: true,
            contents: data
		});
    }

    public getURL():string {
        const url = require('url');
        return url.format({
            protocol: 'http',
            host: 'chat.codes',
            pathname: this.channelName
        });
    }

    public sendMessageHistory(forUser) {
        this.commLayer.trigger(this.channelName, 'message-history', {
            history: this.messageGroups.getMessageHistory(),
            allUsers: this.userList.serialize(),
            forUser: forUser
        });
    }

    public destroy() {
        this.commLayer.destroy();
    }

    public getActiveEditors() {
        return this.editorStateTracker.getActiveEditors();
    }

    public userList:ChatUserList = new ChatUserList();
    public messageGroups:MessageGroups = new MessageGroups(this.userList);
    public commLayer:PusherCommunicationLayer;
    public editorStateTracker:EditorStateTracker;

    private myID:string;
    private getTimestamp():number {
        return new Date().getTime();
    }
}
export class CommunicationService {
    constructor(public isRoot:boolean, username:string, key:string, cluster:string, private EditorWrapperClass) {
        this.commLayer = new PusherCommunicationLayer({
            username: username
        }, key, cluster);
    }
    public commLayer:PusherCommunicationLayer;
    private clients:{[channelName:string]:ChannelCommunicationService} = {};

    public createChannel():Promise<ChannelCommunicationService> {
        return generateChannelName(this.commLayer).then((channelName) => {
            return this.createChannelWithName(channelName);
        });
    }

    public createChannelWithName(channelName:string):ChannelCommunicationService {
        var channel = new ChannelCommunicationService(this, channelName, this.EditorWrapperClass);
        this.clients[channelName] = channel;
        return channel;
    }

    public destroyChannel(name:string):void {
        if(this.clients[name]) {
            var client = this.clients[name]
            client.destroy();
            delete this.clients[name];
        }
    }

    destroy() {
        this.commLayer.destroy();
        _.each(this.clients, (client, name) => {
            this.destroyChannel(name);
        });
    }
}
