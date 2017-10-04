import { CommunicationLayer } from './communication-layer-interface';
import { EventEmitter } from 'events';
import * as sharedb from 'sharedb/lib/client';
import * as _ from 'underscore';
import * as textType from 'ot-text';
import * as json0Type from 'ot-json0';
declare var window;

class NamespaceCommunicator {
	private id:string;
	private responseCallbacks:Map<string, (err, data)=>any> = new Map();
	private typeCallbacks:Map<string, Array<(err, data)=>any>> = new Map();
	private readyPromise:Promise<NamespaceCommunicator>;
	private wsPromise:Promise<WebSocket>;
	private channelID:string;
	private shareDBNamespace:string;
	public constructor(private channelName:string, private username:string, private ws:WebSocket) {
		this.id = `/${this.getChannelName()}#${guid()}`;
		this.wsPromise = new Promise((resolve, reject) => {
			if(this.ws.readyState === WebSocket.OPEN) {
				resolve(this.ws);
			} else {
				this.ws.addEventListener('open', (event) => {
					resolve(this.ws);
				});
			}
		});
		this.readyPromise = this.wsPromise.then(() => {
			ws.addEventListener('message', (event) => {
				const {data} = event;
				try {
					const parsedData = JSON.parse(data);
					if(parsedData.cc === 2) {
						if(parsedData.channel == this.getChannelName()) {
							if(this.responseCallbacks.has(parsedData.messageID)) {
								const callback = this.responseCallbacks.get(parsedData.messageID);
								callback(null, parsedData.payload);
								this.responseCallbacks.delete(parsedData.messageID);
							} else if(this.typeCallbacks.has(parsedData.type)) {
								const callbacks = this.typeCallbacks.get(parsedData.type);
								callbacks.forEach((callback) => {
									callback(null, parsedData.payload);
								});
							}
						}
					}
				} catch(e) {
					console.error(e);
				}
			});
			if(this.getChannelName()) {
				return this.pemit('request-join-room', {
					channel: this.getChannelName(),
					username: this.username,
					id: this.getID()
				});
			} else {
				return true;
			}
		}).then((result) => {
			const {id, ns} = result;
			this.channelID = id;
			this.shareDBNamespace = ns;
			return this;
		});
	}
	public emit(type:string, payload:any, callback?) {
		let messageID = null;
		if(callback) {
			messageID = guid();
			this.responseCallbacks.set(messageID, callback);
		}
		const message = { messageID, type, channel: this.getChannelName(), payload, cc: 1};
		this.wsPromise.then((ws) => {
			try {
				ws.send(JSON.stringify(message));
			} catch (e) {
				if(callback) {
					callback(e);
					this.responseCallbacks.delete(messageID);
				}
				console.error(e);
			}
		});
	}
	public pemit(type:string, payload:any):Promise<any> {
		return new Promise((resolve, reject) => {
			const callback = (err, data) => {
				if(err) { reject(err); }
				else { resolve(data); }
			};
			this.emit(type, payload, callback);
		});
	};
	public on(type:string, callback) {
		if(this.typeCallbacks.has(type)) {
			this.typeCallbacks.get(type).push(callback);
		} else {
			this.typeCallbacks.set(type, [callback]);
		}
	}
	public off(type:string, callback) {
		if(this.typeCallbacks.has(type)) {
			const callbacks = this.typeCallbacks.get(type);
			for(let i = 0; i<callbacks.length; i++) {
				const cb = callbacks[i];
				if(cb === callback) {
					callbacks.splice(i, 1);
					i--;
				}
			}
			if(callbacks.length === 0) {
				this.typeCallbacks.delete(type);
			}
		}
	}
	public ready():Promise<NamespaceCommunicator> {
		return this.readyPromise;
	}
	public getID():string { return this.id; }

	public getChannelName():string { return this.channelName; };
	public getChannelID():string { return this.channelID; };
	public getShareDBNamespace():string { return this.shareDBNamespace; };
	public destroy() {

	};
}

export class WebSocketCommunicationLayer implements CommunicationLayer {
	private mainSocket:Promise<NamespaceCommunicator>;
	private wsPromise:Promise<WebSocket>;
	private shareDBConnectionPromise:Promise<sharedb.Connection>;
	private namespaces:Map<string, Promise<NamespaceCommunicator>> = new Map();
	private username:string;
	private disconnectListeners:Array<()=>any> = [];
	constructor(private authInfo) {
		this.username = authInfo.username;
		this.wsPromise = new Promise<WebSocket>((resolve, reject) => {
			const ws = new WebSocket(`ws://${authInfo.host}:${authInfo.port}`);
			ws.addEventListener('open', (event) => {
				resolve(ws);
			});
			ws.addEventListener('close', (event) => {
				this.disconnectListeners.forEach((cb) => cb() );
			});
		});
		this.mainSocket = this.wsPromise.then((ws) => {
			return new NamespaceCommunicator(null, this.username, ws).ready();
		});
		this.shareDBConnectionPromise = this.wsPromise.then((ws) => {
			const connection = new sharedb.Connection(ws);
			// connection.debug = true;
			return connection;
		});
	}
	public onDisconnect(callback:()=>any):WebSocketCommunicationLayer {
		this.disconnectListeners.push(callback);
		return this;
	}
	public getShareDBConnection():Promise<sharedb.Connection> {
		return this.shareDBConnectionPromise;
	}
	private getNamespace(name:string):Promise<NamespaceCommunicator> {
		if(this.namespaces.has(name)) {
			return this.namespaces.get(name);
		} else {
			const namespacePromise = this.wsPromise.then((ws) => {
				return new NamespaceCommunicator(name, this.username, ws).ready();
			});
			this.namespaces.set(name, namespacePromise);
			return namespacePromise;
		}
	}
	public getMyID(channelName:string):Promise<string> {
		return this.getNamespace(channelName).then((ns) => {
			return ns.getID();
		});
	}
	public trigger(channelName:string, eventName:string, eventContents:any, callback?):void {
		this.getNamespace(channelName).then((room) => {
			if(callback) {
				room.emit(eventName, eventContents, callback);
			} else {
				room.emit(eventName, eventContents);
			}
		});
	};
	public ptrigger(channelName, eventName:string, eventContents:any):Promise<any> {
		return this.getNamespace(channelName).then((room) => {
			return room.pemit(eventName, eventContents);
		});
	}

	public getShareDBObject(channelName:string, path:string):Promise<sharedb.Doc> {
		return Promise.all([this.getNamespace(channelName), this.shareDBConnectionPromise]).then((info) => {
			const room:NamespaceCommunicator = info[0];
			const connection:sharedb.Connection = info[1];
			const shareDBNamespace = room.getShareDBNamespace();
			const doc = connection.get(shareDBNamespace, path);
			return doc;
		});
	};

	public bind(channelName:string, eventName:string, callback:(any)=>any):void {
		this.getNamespace(channelName).then((ns) => {
			ns.on(eventName, callback);
		});
	};
	public getMembers(channelName:string):Promise<any> {
		return this.getNamespace(channelName).then((room) => {
			return new Promise((resolve, reject) => {
				room.emit('get-members', (memberInfo) => {
					resolve(memberInfo);
				});
			});
		}) as Promise<any>;
	};
	public channelNameAvailable(channelName:string):Promise<boolean> {
		return this.mainSocket.then((socket) => {
			return new Promise<boolean>((resolve, reject) => {
				socket.emit('channel-available', channelName, (available:boolean) => {
					resolve(available);
				});
			});
		});
	};
	public onMemberAdded(channelName:string, callback:(event)=>any):void {
		this.getNamespace(channelName).then((room) => {
			room.on('member-added', (member) => {
				callback(member);
			});
		});
	};
	public onMemberRemoved(channelName:string, callback:(event)=>any):void {
		this.getNamespace(channelName).then((room) => {
			room.on('member-removed', (member) => {
				callback(member);
			});
		});
	};
	public channelReady(channelName:string):Promise<any> {
		return this.getNamespace(channelName);
	};
	public destroy():void {
		// this.manager.then((manager) => {
		// });
	};
}

function guid():string {
    function s4():string {
        return Math.floor((1 + Math.random()) * 0x10000)
                    .toString(16)
                    .substring(1);
    }
    return s4() + s4() + '-' + s4() + '-' + s4() + '-' +
            s4() + '-' + s4() + s4() + s4();
}
