
import * as _ from 'underscore';
import { ChatUserList, ChatUser } from './chat-user'
import { PusherCommunicationLayer } from './pusher-communication-layer';
import { SocketIOCommunicationLayer } from './socket-communication-layer';
import { EventEmitter } from 'events';
import { MessageGroups } from './chat-messages';
import { UndoableDelta, EditorStateTracker, EditorState } from './editor-state-tracker';
import { CommunicationLayer } from './communication-layer-interface';

declare function require(name:string);
declare var __dirname:string;

const DEBUG = false;
const USE_PUSHER = false;


/**
 * Come up with a channel name from a list of words. If we can't find an empty channel, we just start adding
 * numbers to the channel name
 * @param  {any}          commLayer The communication channel service
 * @return {Promise<string>}           A promise whose value will resolve to the name of a channel that is empty
 */
function generateChannelName(commLayer):Promise<string> {
    const fs = require('fs');
    const path = require('path');
    if(DEBUG) {
        return Promise.resolve('example_channel');
    } else {
        const WORD_FILE_NAME = 'google-10000-english-usa-no-swears-medium.txt'

        //Open up the list of words
        return new Promise(function(resolve, reject) {
            fs.readFile(path.join(__dirname, WORD_FILE_NAME), {encoding: 'utf-8'}, function(err, result) {
                if(err) {
                    reject(err);
                } else {
                    resolve(result);
                }
            });
        }).then(function(words:string) {
            // Put the list of opened words in a random order
            return _.shuffle(words.split(/\n/));
        }).then(function(wordList:Array<string>) {
            function* getNextWord():Iterable<string> {
                for(var i = 0; i<wordList.length; i++) {
                    yield wordList[i];
                }
                // If we couldn't find anything, start adding numbers to the end of words
                var j = 0;
                while(true) {
                    yield wordList[j%wordList.length]+j+'';
                    j++;
                }
            }

            function getNextAvailableName(iterator) {
                const {value} = iterator.next();
                return commLayer.channelNameAvailable(value).then(function(available) {
                    if(available) {
                        return value;
                    } else {
                        return getNextAvailableName(iterator);
                    }
                });
            }

            return getNextAvailableName(getNextWord());
        });
    }
}

export class ChannelCommunicationService extends EventEmitter {
    public userList:ChatUserList = new ChatUserList(); // A list of chat userList
    public messageGroups:MessageGroups // A list of message groups
    public commLayer:CommunicationLayer; // The communication channel
    public editorStateTracker:EditorStateTracker; // A tool to help keep track of the editor state
    private myID:string; // The ID assigned to this user
    private _isRoot:boolean=false;

    /**
     * [constructor description]
     * @param  {CommunicationService} privatecommService The CommunicationService object that created this instance
     * @param  {string}               channelName The name of the channel we're communicating on
     * @param  {class}               EditorWrapperClass A class whose instances satisfy the EditorWrapper interface
     */
    constructor(private commService:CommunicationService, private channelName:string, EditorWrapperClass) {
        super();
        this.editorStateTracker = new EditorStateTracker(EditorWrapperClass, this, this.userList);
        this.messageGroups = new MessageGroups(this.userList, this.editorStateTracker);

        this.commLayer = commService.commLayer; // Pop this object up a level

        // Track when a user sends a message
        this.commLayer.bind(this.channelName, 'message', (data) => {
            // Forward the message to the messageGroups tracker
            this.messageGroups.addTextMessage(data);
            (this as any).emit('message', _.extend({
                sender: this.userList.getUser(data.uid)
            }, data));
        });

        // this.commLayer.bind(this.channelName, 'history', (data) => {
        //     if(data.forUser === this.myID) {
        //         const {editorState, allUsers, messageHistory} = data;
        //         // Add every user from the past to our list
        //         allUsers.forEach((u) => {
        //             this.userList.add(false, u.id, u.name, u.active);
        //         });
        //
        //         _.each(editorState, (serializedEditorState) => {
        //             const editorState:EditorState = this.editorStateTracker.onEditorOpened(serializedEditorState, true);
        //             _.each(editorState.getDeltas(), (delta:UndoableDelta) => {
        //                 this.messageGroups.addDelta(delta);
        //             });
        //         });
        //         (this as any).emit('editor-state', data);
        //
        //         _.each(messageHistory, (m:any) => {
        //             this.messageGroups.addTextMessage(m);
        //             (this as any).emit('message', _.extend({
        //                 sender: this.userList.getUser(m.uid)
        //             }, m));
        //         });
        //         (this as any).emit('history', {
        //             userList: this.userList,
        //             editorState: this.editorStateTracker
        //         });
        //     }
        // });

        // Track when users are typing
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

        // Track when something happens in the editor
        this.commLayer.bind(this.channelName, 'editor-event', (data) => {
    		const delta:UndoableDelta = this.editorStateTracker.handleEvent(data, true);
            this.messageGroups.addDelta(delta);
            (this as any).emit('editor-event', data);
        });

        // Track when the user moves the cursor
        this.commLayer.bind(this.channelName, 'cursor-event', (data) => {
			const {id, type, uid} = data;
			let user = this.userList.getUser(uid);
            const cursorID = uid + id;

			if(type === 'change-position') { // The caret position changed
				const {newBufferPosition, oldBufferPosition, newRange, cursorID, editorID} = data;
				const editorState = this.editorStateTracker.getEditorState(editorID);
				if(editorState) {
					const remoteCursors = editorState.getRemoteCursors();
					remoteCursors.updateCursor(cursorID, user, {row: newBufferPosition[0], column: newBufferPosition[1]});
				}
			} else if(type === 'change-selection') { // The selection range changed
				const {newRange, id, editorID} = data;
				const editorState = this.editorStateTracker.getEditorState(editorID);
				if(editorState) {
					const remoteCursors = editorState.getRemoteCursors();
					remoteCursors.updateSelection(cursorID, user, newRange);
				}
			} else if(type === 'destroy') { // The cursor was destroyed
				const {newRange, id, editorID} = data;
				const editorState = this.editorStateTracker.getEditorState(editorID);
				if(editorState) {
					const remoteCursors = editorState.getRemoteCursors();
					remoteCursors.removeCursor(cursorID, user);
				}
			}
            (this as any).emit('cursor-event', data);
        });

        // A new editor was opened
    	this.commLayer.bind(this.channelName, 'editor-opened', (data) => {
            // const mustPerformChange = !this.isRoot();
    		const editorState:EditorState = this.editorStateTracker.onEditorOpened(data, true);
            _.each(editorState.getDeltas(), (delta:UndoableDelta) => {
                this.messageGroups.addDelta(delta);
            });
            (this as any).emit('editor-opened', data);
    	});

        // The user wants to write something to the terminal
        this.commLayer.bind(this.channelName, 'write-to-terminal', (data) => {
            (this as any).emit('write-to-terminal', data);
        });

        // The terminal outputted something
        this.commLayer.bind(this.channelName, 'terminal-data', (event) => {
            (this as any).emit('terminal-data', event);
        });

        // Someone requested the conversation & editor history
        // this.commLayer.bind(this.channelName, 'request-history', (memberID:string) => {
        //     // If I'm root, then send over the current editor state and past message history to every new user
        //     if(this.isRoot()) {
        //         this.commLayer.trigger(this.channelName, 'history', {
        //             forUser: memberID,
        //             editorState: this.editorStateTracker.serializeEditorStates(),
        //             allUsers: this.userList.serialize(),
        //             messageHistory: this.messageGroups.getMessageHistory()
        //         });
        //     }
        // });

        // Add every current member to the user list
        // this.commLayer.getMembers(this.channelName).then((memberInfo:any) => {
        //     if(_.keys(memberInfo.members).length === 1) { // I'm the only one here
        //         this._isRoot = true;
        //     }
        //     this.myID = memberInfo.myID;
        //     this.userList.addAll(memberInfo);
        //     this.commLayer.trigger(this.channelName, 'request-history', this.myID);
        // });

        // Add anyone who subsequently joines
        this.commLayer.onMemberAdded(this.channelName, (member) => {
            const memberID = member.id;
            this.userList.add(false, memberID, member.info.name);
        });
        //When a user leaves, remove them from the user list and remove their cursor
        this.commLayer.onMemberRemoved(this.channelName, (member) => {
            this.editorStateTracker.removeUserCursors(member);
            this.userList.remove(member.id);
        });

        this.commLayer.channelReady(this.channelName).then((history) => {
            const {myID, data, users} = history;
            this.myID = myID;
            _.each(users, (u:any) => {
                this.userList.add(u.id===myID, u.id, u.name, u.active);
            });
            if(users.length === 1) { // I'm the only one here
                this._isRoot = true;
            }
            _.each(data, (h:any) => {
                const {eventName, payload} = h;
                this.commLayer.reTrigger(this.channelName, eventName, payload);
            });
        });
    }
    private isRoot():boolean {
        return this._isRoot;
        // return this.commService.isRoot;
    }

    /**
     * A promise that resolves when the communication channel is ready
     * @return {Promise<any>} [description]
     */
    public ready():Promise<any> {
        return this.commLayer.channelReady(this.channelName);
    }

    /**
     * Request that the user saves a particular file
      * @param {[type]} data Information about which file to save
     */
    public emitSave(data):void {
        (this as any).emit('save', _.extend({
            sender: this.userList.getMe(),
            timestamp: this.getTimestamp()
        }, data));
    }

    /**
     * Called when the user opens a new editor window
     * @param {[type]} data Information about the editor
     */
    public emitEditorOpened(data):void {
		const editorState = this.editorStateTracker.onEditorOpened(data, true);
        this.commLayer.trigger(this.channelName, 'editor-opened', _.extend({
            timestamp: this.getTimestamp()
        }, data));
        (this as any).emit('editor-opened', data);
    }

    /**
     * Send chat message
     * @param {string} message The text of the message to send
     */
    public sendTextMessage(message:string):void {
        const data = {
            uid: this.myID,
            type: 'text',
            message: message,
            timestamp: this.getTimestamp()
        };
        this.messageGroups.addTextMessage(data);

        this.commLayer.trigger(this.channelName, 'message', data);

        (this as any).emit('message', _.extend({
            sender: this.userList.getMe()
        }, data));
    }

    /**
     * Update typing status to either:
     * - 'IDLE' - The user is not typing anything
     * - 'ACTIVE_TYPING' - The user is actively typing
     * - 'IDLE_TYPED' - The user typed something but hasn't sent it or updated for a while
     * @param {string} status IDLE, ACTIVE_TYPING, or IDLE_TYPED
     */
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

    /**
     * The user modified something in the editor
     * @param {[type]} serializedDelta       The change
     * @param {[type]} remote=true whether the change was made by a remote client or on the editor
     */
    public emitEditorChanged(serializedDelta, remote=true):void {
        _.extend(serializedDelta, {
			timestamp: this.getTimestamp(),
            uid: this.myID,
			remote: remote
        });
		const delta:UndoableDelta = this.editorStateTracker.handleEvent(serializedDelta, serializedDelta.type !== 'edit');
        this.messageGroups.addDelta(delta);
        this.commLayer.trigger(this.channelName, 'editor-event', serializedDelta);
    }

    /**
     * The cursor position for the user changed
     * @param {[type]} delta       Information about the cursor position
     * @param {[type]} remote=true Whether this was from a remote user
     */
    public emitCursorPositionChanged(delta, remote=true):void {
        this.commLayer.trigger(this.channelName, 'cursor-event', _.extend({
			timestamp: this.getTimestamp(),
            uid: this.myID,
			remote: remote
		}, delta));
    }

    /**
     * The selected content for the user has changed
     * @param {[type]} delta       Information about the selection
     * @param {[type]} remote=true Whether this was from a remote user
     */
    public emitCursorSelectionChanged(delta, remote=true):void {
        this.commLayer.trigger(this.channelName, 'cursor-event', _.extend({
			timestamp: this.getTimestamp(),
            uid: this.myID,
			remote: remote
		}, delta));
    }

    /**
     * Called when the terminal outputs something
     * @param {[type]} data         Information about what the terminal outputted
     * @param {[type]} remote=false Whether this was outputted by a remote client
     */
    public emitTerminalData(data, remote=false):void {
        this.commLayer.trigger(this.channelName, 'terminal-data', {
			timestamp: this.getTimestamp(),
            data: data,
			remote: remote
		});
    };

    public writeToTerminal(data):void {
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

    public destroy():void {
        this.commLayer.destroy();
    }

    public getActiveEditors() {
        return this.editorStateTracker.getActiveEditors();
    }

    /**
     * Get the current timestamp (as milliseconds since Jan 1 1970)
     * @return {number} The timestamp
     */
    private getTimestamp():number {
        return new Date().getTime();
    };
}

/* A class to create and manage ChannelCommunicationService instances */
export class CommunicationService {
    constructor(authInfo, private EditorWrapperClass) {
        if(USE_PUSHER) {
            this.commLayer = new PusherCommunicationLayer(authInfo);
        } else {
            this.commLayer = new SocketIOCommunicationLayer(authInfo);
        }
    }
    public commLayer:CommunicationLayer; // The underlying communication mechanism
    private clients:{[channelName:string]:ChannelCommunicationService} = {}; // Maps channel names to channel comms

    /**
     * Create a channel with a randomly generated name
     * @return {Promise<ChannelCommunicationService>} A promise that resolves to the channel
     */
    public createChannel():Promise<ChannelCommunicationService> {
        return generateChannelName(this.commLayer).then((channelName) => {
            return this.createChannelWithName(channelName);
        });
    }

    /**
     * Create a new channel and supply the name
     * @param  {string}                      channelName The name of the channel
     * @return {ChannelCommunicationService}             The communication channel
     */
    public createChannelWithName(channelName:string):ChannelCommunicationService {
        var channel = new ChannelCommunicationService(this, channelName, this.EditorWrapperClass);
        this.clients[channelName] = channel;
        return channel;
    }

    /**
     * Clean up the resources for a specific channel client
     * @param {string} name The name of the channel
     */
    public destroyChannel(name:string):void {
        if(this.clients[name]) {
            var client = this.clients[name]
            client.destroy();
            delete this.clients[name];
        }
    }

    /**
     * Clean up resources from every client
     */
    destroy():void {
        this.commLayer.destroy();
        _.each(this.clients, (client, name) => {
            this.destroyChannel(name);
        });
    }
}
