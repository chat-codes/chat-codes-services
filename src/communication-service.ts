import * as _ from 'underscore';
import * as sharedb from 'sharedb/lib/client';
import { ChatUserList, ChatUser } from './chat-user'
import { WebSocketCommunicationLayer, NamespaceCommunicator } from './socket-communication-layer';
import { MessageGroups } from './chat-messages';
import { EventEmitter } from './event';
import { EditorStateTracker, EditorState } from './editor-state-tracker';

export class ChannelCommunicationService extends EventEmitter {
    private userList:ChatUserList; // A list of chat userList
    private messageGroups:MessageGroups // A list of message groups
    private editorStateTracker:EditorStateTracker; // A tool to help keep track of the editor state
    private myID:string; // The ID assigned to this user
    private _isRoot:boolean=false;
    private chatDoc:Promise<sharedb.Doc>;
    private editorsDoc:Promise<sharedb.Doc>;
    private cursorsDoc:Promise<sharedb.Doc>;
    private commLayer:WebSocketCommunicationLayer;
    private channelCommLayer:Promise<NamespaceCommunicator>;
    /**
     * [constructor description]
     * @param  {CommunicationService} privatecommService The CommunicationService object that created this instance
     * @param  {string}               channelName The name of the channel we're communicating on
     * @param  {class}               EditorWrapperClass A class whose instances satisfy the EditorWrapper interface
     */
    constructor(private commService:CommunicationService, private channelName:string, private channelID:string, private isObserver:boolean, EditorWrapperClass) {
        super();
        this.commLayer = commService.commLayer;
        this.channelCommLayer = this.commLayer.getNamespace(this.getChannelName(), this.channelID);

        this.chatDoc = this.createDocSubscription('chat');
        this.editorsDoc = this.createDocSubscription('editors');
        this.cursorsDoc = this.createDocSubscription('cursors');

        this.userList = new ChatUserList(this.getMyID(), this);
        this.editorStateTracker = new EditorStateTracker(EditorWrapperClass, this, this.userList, this.isObserver);
        this.messageGroups = new MessageGroups(this, this.userList, this.editorStateTracker);
    }
    public getUserList():ChatUserList { return this.userList; };
    public getEditorStateTracker():EditorStateTracker { return this.editorStateTracker; };
    public getMessageGroups():MessageGroups { return this.messageGroups; };
    private createDocSubscription(docName:string):Promise<sharedb.Doc> {
        return this.channelCommLayer.then((ccomm:NamespaceCommunicator) => {
            return ccomm.getShareDBObject(docName);
        }).then((doc) => {
            return new Promise((resolve, reject) => {
                doc.subscribe((err) => {
                    if(err) {
                        reject(err);
                    } else {
                        resolve(doc);
                    }
                });
            });
        });
    }
	public getMyID():Promise<string> {
        return this.channelCommLayer.then((ccomm) => {
            return ccomm.getID();
        })
	}
    public getShareDBChat():Promise<sharedb.Doc> { return this.chatDoc; }
    public getShareDBEditors():Promise<sharedb.Doc> { return this.editorsDoc; }
    public getShareDBCursors():Promise<sharedb.Doc> { return this.cursorsDoc; }

    private cachedEditorVersions:Map<number, Promise<Map<string,any>>> = new Map();
    public getEditorVersion(version:number):Promise<Map<string, any>> {
        if(this.cachedEditorVersions.has(version)) {
            return this.cachedEditorVersions.get(version);
        } else {
            const prv = this.channelCommLayer.then((ccomm) => {
                return ccomm.pemit('get-editors-values', version);
            }).then((data) => {
                const rv:Map<string, any> = new Map<string, any>();

                _.each(data, (x:any) => {
                    rv.set(x.id, x);
                })
                return rv;
            });
            this.cachedEditorVersions.set(version, prv);
            return prv;
        }
    }

    /**
     * A promise that resolves when the communication channel is ready
     * @return {Promise<any>} [description]
     */
    public ready():Promise<any> {
        return Promise.all([ this.channelCommLayer, this.editorStateTracker.ready, this.userList.ready , this.messageGroups.ready ])
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
        (this as any).emit('editor-opened', data);
    }

    /**
     * Send chat message
     * @param {string} message The text of the message to send
     */
    public sendTextMessage(message:string):void {
        if(!this.isObserver) {
            Promise.all([this.getMyID(), this.getShareDBChat(), this.getShareDBEditors()]).then((info) => {
                const myID:string = info[0]
                const chatDoc:sharedb.Doc = info[1]
                const editorsDoc:sharedb.Doc = info[2]

                const data = {
                    uid: myID,
                    type: 'text',
                    message: message,
                    timestamp: this.getTimestamp(),
                    editorsVersion: editorsDoc.version
                };
    			chatDoc.submitOp([{p: ['messages', chatDoc.data.messages.length], li: data}]);
            });
        }
    }

    /**
     * Update typing status to either:
     * - 'IDLE' - The user is not typing anything
     * - 'ACTIVE_TYPING' - The user is actively typing
     * - 'IDLE_TYPED' - The user typed something but hasn't sent it or updated for a while
     * @param {string} status IDLE, ACTIVE_TYPING, or IDLE_TYPED
     */
    public sendTypingStatus(status:string):void {
        if(!this.isObserver) {
            Promise.all([this.getMyID(), this.getShareDBChat()]).then((info) => {
                const myID:string = info[0]
                const doc:sharedb.Doc = info[1]

                const oldValue = doc.data['activeUsers'][myID]['info']['typingStatus'];
                doc.submitOp([{p: ['activeUsers', myID, 'info', 'typingStatus'], od: oldValue, oi: status}]);
            });
        }
    }

    /**
     * The user modified something in the editor
     * @param {[type]} serializedDelta       The change
     * @param {[type]} remote=true whether the change was made by a remote client or on the editor
     */
    public emitEditorChanged(serializedDelta, remote=true):void {
        this.channelCommLayer.then((ccomm) => {
            const myID = ccomm.getID();
            _.extend(serializedDelta, {
    			timestamp: this.getTimestamp(),
                uid: myID,
    			remote: remote
            });
            return ccomm.pemit('editor-event', serializedDelta);
        });
    }

    /**
     * The cursor position for the user changed
     * @param {[type]} delta       Information about the cursor position
     * @param {[type]} remote=true Whether this was from a remote user
     */
    public onCursorPositionChanged(delta):void {
        if(!this.isObserver) {
            Promise.all([this.getMyID(), this.getShareDBCursors()]).then((info) => {
                const myID:string = info[0]
                const doc:sharedb.Doc = info[1]
                const {editorID} = delta;
                if(_.has(doc.data, editorID)) {
                    doc.submitOp({p: [editorID, 'userCursors', myID], oi: delta, od: doc.data[editorID]['userCursors'][myID]});
                } else {
                    const oi = { 'userCursors': {}, 'userSelections': {} };
                    oi['userCursors'][myID] = delta;
                    doc.submitOp({p: [editorID], oi});
                }
            });
        }
    }

    /**
     * The selected content for the user has changed
     * @param {[type]} delta       Information about the selection
     * @param {[type]} remote=true Whether this was from a remote user
     */
    public onCursorSelectionChanged(delta):void {
        if(!this.isObserver) {
            Promise.all([this.getMyID(), this.getShareDBCursors()]).then((info) => {
                const myID:string = info[0]
                const doc:sharedb.Doc = info[1]
                const {editorID} = delta;
                if(_.has(doc.data, editorID)) {
                    doc.submitOp({p: [editorID, 'userSelections', myID], oi: delta, od: doc.data[editorID]['userSelections'][myID]});
                } else {
                    const oi = { 'userCursors':{}, 'userSelections': {} };
                    oi['userSelections'][myID] = delta;
                    doc.submitOp({p: [editorID], oi});
                }
            });
        }
    }

    /**
     * Called when the terminal outputs something
     * @param {[type]} data         Information about what the terminal outputted
     * @param {[type]} remote=false Whether this was outputted by a remote client
     */
    public emitTerminalData(data, remote=false):void {
        this.channelCommLayer.then((ccomm) => {
            return ccomm.pemit('terminal-data', {
    			timestamp: this.getTimestamp(),
                data: data,
    			remote: remote
    		});
        });
    };

    public writeToTerminal(data):void {
        this.channelCommLayer.then((ccomm) => {
            return ccomm.pemit('write-to-terminal', {
    			timestamp: this.getTimestamp(),
                uid: this.myID,
    			remote: true,
                contents: data
    		});
        });
    }

    public getURL():string { return `https://chat.codes/${this.getChannelName()}`; }

    public destroy():void {
        this.channelCommLayer.then((ccomm) => {
            ccomm.destroy();
        });
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
    public getChannelName():string {
        return this.channelName;
    }
    public getIsObserver():boolean {
        return this.isObserver;
    }
}

/* A class to create and manage ChannelCommunicationService instances */
export class CommunicationService {
    constructor(authInfo, private EditorWrapperClass) {
        this.commLayer = new WebSocketCommunicationLayer(authInfo);
        // // if(USE_PUSHER) {
        // //     this.commLayer = new PusherCommunicationLayer(authInfo);
        // // } else {
        //     // this.commLayer = new WebSocketCommunicationLayer(authInfo);
        // }
    }
    public commLayer:WebSocketCommunicationLayer; // The underlying communication mechanism
    private clients:{[channelName:string]:ChannelCommunicationService} = {}; // Maps channel names to channel comms

    /**
     * Create a new channel and supply the name
     * @param  {string}                      channelName The name of the channel
     * @return {ChannelCommunicationService}             The communication channel
     */
    public createChannelWithName(channelName:string, channelID:string=null, isObserver:boolean=false):ChannelCommunicationService {
        var channel = new ChannelCommunicationService(this, channelName, channelID, isObserver, this.EditorWrapperClass);
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
