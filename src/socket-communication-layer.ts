import { Manager, Socket } from 'socket.io-client';
import { CommunicationLayer } from './communication-layer-interface';
import * as sharedb from 'sharedb/lib/client';
import * as _ from 'underscore';

export class SocketIOCommunicationLayer implements CommunicationLayer {
	private manager:Promise<SocketIOClient.Manager>;
	private mainSocket:Promise<SocketIOClient.Socket>;
	private wsConnectionPromise:Promise<sharedb.Connection>;
	private namespaces:{[name:string]:any} = {};
	private username:string;
	constructor(private authInfo) {
		this.username = authInfo.username;
		this.manager = new Promise<SocketIOClient.Manager>((resolve, reject) => {
			resolve(new Manager(`http://${authInfo.host}:${authInfo.port}`));
		});
		this.mainSocket = this.manager.then((manager) => {
			return manager.socket('/');
		});
		this.wsConnectionPromise = new Promise<sharedb.Connection>((resolve, reject) => {
			this.mainSocket.then((socket) => {
				socket.on('connect', () => {
					socket.once('connection-info', (info) => {
						const {shareDBPort} = info;
						const ws = new WebSocket(`ws://${authInfo.host}:${shareDBPort}`);
						ws.addEventListener('open', function (event) {
							const connection = new sharedb.Connection(ws);
							resolve(connection);
						});
					});
				});
			});
		});
	}
	private getNamespaceAndHistory(name:string):Promise<any> {
		if(_.has(this.namespaces, name)) {
			return this.namespaces[name];
		} else {
			let socket:SocketIOClient.Socket;
			this.namespaces[name] = this.mainSocket.then((socket) => {
				return new Promise((resolve, reject) => {
					socket.emit('request-join-room', name, (response) => {
						resolve(response);
					});
				});
			}).then(() => {
				return this.manager;
			}).then((manager) => {
				socket = manager.socket(`/${name}`);
				return new Promise<SocketIOClient.Socket>((resolve, reject) => {
					socket.on('connect', (event) => {
						socket.emit('set-username', this.username, (history) => {
							resolve(history);
						});
					});
				});
			}).then((history) => {
				return {
					history: history,
					socket: socket,
					listeners: {

					}
				};
			});
			return this.namespaces[name];
		}
	};
	private getNamespace(name:string):Promise<SocketIOClient.Socket> {
		if(_.has(this.namespaces, name)) {
			return this.namespaces[name];
		} else {
			let socket:SocketIOClient.Socket;
			return this.namespaces[name] = this.mainSocket.then((socket) => {
				return new Promise((resolve, reject) => {
					socket.emit('request-join-room', name, (response) => {
						resolve(response);
					});
				});
			}).then(() => {
				return this.manager;
			}).then((manager) => {
				socket = manager.socket(`/${name}`);
				return new Promise<SocketIOClient.Socket>((resolve, reject) => {
					socket.on('connect', (event) => {
						socket.emit('set-username', this.username, (history) => {
							resolve(history);
						});
					});
				});
			}).then(() => {
				return socket;
			});
		}
	}
	public getMyID(channelName:string):Promise<string> {
		return this.getNamespace(channelName).then((socket) => {
			return socket.id;
		});
	}
	public trigger(channelName:string, eventName:string, eventContents:any):void {
		this.getNamespace(channelName).then((room) => {
			room.emit('data', eventName, eventContents);
		});
	};

	public getShareDBChat(channelName):Promise<sharedb.Doc> {
		return this.wsConnectionPromise.then((connection) => {
			const doc = connection.get(channelName, 'chat');
			return doc;
		});
	};

	public bind(channelName:string, eventName:string, callback:(any)=>any):void {
		this.getNamespace(channelName).then((socket) => {
			// if(_.has(listeners, eventName)) {
			// 	listeners[eventName].push(callback);
			// } else {
			// 	listeners[eventName] = [callback];
			// }

			socket.on(`data-${eventName}`, callback);
			// (val) => {
			// 	callback(val);
			// });
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
		return this.getNamespace(channelName).then((socket) => {
			return Promise.all([this.getShareDBChat(channelName)]);
		});
	};
	public destroy():void {
		// this.manager.then((manager) => {
		// });
	};
}
