
import * as _ from 'underscore';
import { ChatUserList, ChatUser } from './chat-user'
import { PusherCommunicationLayer } from './pusher-communication-layer';
import { EventEmitter } from 'events';
import { MessageGroups } from './chat-messages';
import { EditorStateTracker } from './editor-state-tracker';

declare function require(name:string);
declare var __dirname:string;

const DEBUG = true;


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
        }).then(function(wordList) {
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
    public commLayer:PusherCommunicationLayer; // The communication channel
    public editorStateTracker:EditorStateTracker; // A tool to help keep track of the editor state
    private myID:string; // The ID assigned to this user

    /**
     * [constructor description]
     * @param  {CommunicationService} privatecommService The CommunicationService object that created this instance
     * @param  {string}               channelName The name of the channel we're communicating on
     * @param  {class}               EditorWrapperClass A class whose instances satisfy the EditorWrapper interface
     */
    constructor(private commService:CommunicationService, private channelName:string, EditorWrapperClass) {
        super();
        this.editorStateTracker = new EditorStateTracker(EditorWrapperClass, this);
        this.messageGroups = new MessageGroups(this.userList, this.editorStateTracker);

        this.commLayer = commService.commLayer; // Pop this object up a level

        // Track when a user sends a message
        this.commLayer.bind(this.channelName, 'message', (data) => {
            // Forward the message to the messageGroups tracker
            this.messageGroups.addMessage(data);
            (this as any).emit('message', _.extend({
                sender: this.userList.getUser(data.uid)
            }, data));
        });

        // Track when someone sends the complete history of messages
        this.commLayer.bind(this.channelName, 'message-history', (data) => {
            if(data.forUser === this.myID) {
                // Add every user from the past to our list
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
			this.editorStateTracker.handleEvent(data, true);
            (this as any).emit('editor-event', data);
        });

        // Track when the user moves the cursor
        this.commLayer.bind(this.channelName, 'cursor-event', (data) => {
			const {id, type, uid} = data;
			let user = this.userList.getUser(uid);

			if(type === 'change-position') { // The caret position changed
				const {newBufferPosition, oldBufferPosition, newRange, id, editorID} = data;
				const editorState = this.editorStateTracker.getEditorState(editorID);
				if(editorState) {
					const remoteCursors = editorState.getRemoteCursors();
					remoteCursors.updateCursor(id, user, {row: newBufferPosition[0], column: newBufferPosition[1]});
				}
			} else if(type === 'change-selection') { // The selection range changed
				const {newRange, id, editorID} = data;
				const editorState = this.editorStateTracker.getEditorState(editorID);
				if(editorState) {
					const remoteCursors = editorState.getRemoteCursors();
					remoteCursors.updateSelection(id, user, newRange);
				}
			} else if(type === 'destroy') { // The cursor was destroyed
				const {newRange, id, editorID} = data;
				const editorState = this.editorStateTracker.getEditorState(editorID);
				if(editorState) {
					const remoteCursors = editorState.getRemoteCursors();
					remoteCursors.removeCursor(id, user);
				}
			}
            (this as any).emit('cursor-event', data);
        });

        // The complete editor state was sent
    	this.commLayer.bind(this.channelName, 'editor-state', (data) => {
            const {forUser, state} = data;
            // If it was sent specifically to me
            if(forUser === this.myID) {
                _.each(state, (serializedEditorState) => {
                    this.editorStateTracker.onEditorOpened(serializedEditorState, true);
                });
                (this as any).emit('editor-state', data);
            }
    	});

        // A new editor was opened
    	this.commLayer.bind(this.channelName, 'editor-opened', (data) => {
            // const mustPerformChange = !this.isRoot();
    		const editorState = this.editorStateTracker.onEditorOpened(data, true);
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

        // Add every current member to the user list
        this.commLayer.getMembers(this.channelName).then((memberInfo) => {
            this.myID = memberInfo.myID;
            this.userList.addAll(memberInfo);
        });

        // Add anyone who subsequently joines
        this.commLayer.onMemberAdded(this.channelName, (member) => {
            this.userList.add(false, member.id, member.info.name);
            // If I'm root, then send over the current editor state and past message history to every new user
            if(this.isRoot()) {
                const memberID = member.id;
                const serializedState = this.editorStateTracker.serializeEditorStates();
                this.sendMessageHistory(memberID);
                this.commLayer.trigger(this.channelName, 'editor-state', {
                    forUser: memberID,
                    state: serializedState
                });
            }
        });
        //When a user leaves, remove them from the user list and remove their cursor
        this.commLayer.onMemberRemoved(this.channelName, (member) => {
            this.editorStateTracker.removeUserCursors(member);
            this.userList.remove(member.id);
        });
    }
    private isRoot():boolean {
        return this.commService.isRoot;
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
        this.messageGroups.addMessage(data);

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
     * @param {[type]} delta       The change
     * @param {[type]} remote=true whether the change was made by a remote client or on the editor
     */
    public emitEditorChanged(delta, remote=true):void {
		this.editorStateTracker.handleEvent(delta, delta.type !== 'edit');
        this.commLayer.trigger(this.channelName, 'editor-event', _.extend({
			timestamp: this.getTimestamp(),
            uid: this.myID,
			remote: remote
		}, delta));
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

    /**
     * Sends the complete history of chat messages
     * @param {[type]} forUser The user for whom this history is intended
     */
    public sendMessageHistory(forUser):void {
        this.commLayer.trigger(this.channelName, 'message-history', {
            history: this.messageGroups.getMessageHistory(),
            allUsers: this.userList.serialize(),
            forUser: forUser
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
    constructor(public isRoot:boolean, authInfo, private EditorWrapperClass) {
        this.commLayer = new PusherCommunicationLayer(authInfo);
        // {
        //     username: username
        // }, key, cluster);
    }
    public commLayer:PusherCommunicationLayer; // The underlying communication mechanism
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
