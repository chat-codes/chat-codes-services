import { EventEmitter } from './event';
import * as sharedb from 'sharedb/lib/client';
import * as _ from 'underscore';
import * as textType from 'ot-text';
import * as json0Type from 'ot-json0';
declare var window;

export class NamespaceCommunicator {
	private id:string;
	private responseCallbacks:Map<string, (err, data)=>any> = new Map();
	private typeCallbacks:Map<string, Array<(err, data)=>any>> = new Map();
	private readyPromise:Promise<NamespaceCommunicator>;
	private wsPromise:Promise<WebSocket>;
	private shareDBNamespace:string;
	public constructor(private channelName:string, private channelID:string, private username:string, private ws:WebSocket, private sdbp:Promise<sharedb.Connection>) {
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
						if(parsedData.ns == this.getShareDBNamespace()) {
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
					channelID: this.channelID,
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
		const message = { messageID, type, ns: this.getShareDBNamespace(), payload, cc: 1};
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
	public bind(type:string, callback) {
		if(this.typeCallbacks.has(type)) {
			this.typeCallbacks.get(type).push(callback);
		} else {
			this.typeCallbacks.set(type, [callback]);
		}
	}
	public unbind(type:string, callback) {
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
	public getShareDBObject(path:string):Promise<sharedb.Doc> {
		return this.sdbp.then((connection) => {
			return connection.get('chatcodes', `${this.getShareDBNamespace()}-${path}`);
			// return connection.get(this.getShareDBNamespace(), path);
		});
	};
	public destroy() {

	};
	public trigger(channelName:string, eventName:string, eventContents:any, callback?):void {
		if(callback) {
			this.emit(eventName, eventContents, callback);
		} else {
			this.emit(eventName, eventContents);
		}
	};
}

export class WebSocketCommunicationLayer {
	private mainSocket:Promise<NamespaceCommunicator>;
	private wsPromise:Promise<WebSocket>;
	private shareDBConnectionPromise:Promise<sharedb.Connection>;
	private namespaces:Map<string, Promise<NamespaceCommunicator>> = new Map();
	private username:string;
	private disconnectListeners:Array<()=>any> = [];
	constructor(private authInfo) {
		this.username = authInfo.username;
		this.wsPromise = new Promise<WebSocket>((resolve, reject) => {
			const wsProtocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
			const ws = new WebSocket(`${wsProtocol}://${authInfo.host}`);
			ws.addEventListener('open', (event) => {
				resolve(ws);
			});
			ws.addEventListener('close', (event) => {
				this.disconnectListeners.forEach((cb) => cb() );
			});
		});
		this.mainSocket = this.wsPromise.then((ws) => {
			return new NamespaceCommunicator(null, null, this.username, ws, this.shareDBConnectionPromise).ready();
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
	public getNamespace(channelName:string, channelID?:string):Promise<NamespaceCommunicator> {
		if(this.namespaces.has(channelName)) {
			return this.namespaces.get(channelName);
		} else {
			const namespacePromise = this.wsPromise.then((ws) => {
				return new NamespaceCommunicator(channelName, channelID, this.username, ws, this.shareDBConnectionPromise).ready();
			});
			this.namespaces.set(channelName, namespacePromise);
			return namespacePromise;
		}
	}
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
