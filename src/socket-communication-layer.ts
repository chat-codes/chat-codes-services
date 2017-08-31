import {Manager, Socket} from 'socket.io-client';
import { CommunicationLayer } from './communication-layer-interface';
import * as _ from 'underscore';

export class SocketIOCommunicationLayer implements CommunicationLayer {
	private manager:Promise<SocketIOClient.Manager>;
	private mainSocket:Promise<SocketIOClient.Socket>;
	private namespaces:{[name:string]:Promise<SocketIOClient.Socket>} = {};
	private username:string;
	constructor(private authInfo) {
		this.username = authInfo.username;
		this.manager = new Promise((resolve, reject) => {
			resolve(new Manager(`http://${authInfo.host}:${authInfo.port}`));
		});
		this.mainSocket = this.manager.then((manager) => {
			return manager.socket('/');
		});
	}
	private getNamespace(name:string):Promise<SocketIOClient.Socket> {
		if(_.has(this.namespaces, name)) {
			return this.namespaces[name];
		} else {
			this.namespaces[name] = this.mainSocket.then((socket) => {
				return new Promise((resolve, reject) => {
					socket.emit('request-join-room', name, (response) => {
						resolve(response);
					});
				});
			}).then(() => {
				return this.manager;
			}).then((manager) => {
				const socket = manager.socket(`/${name}`);
				return new Promise((resolve, reject) => {
					socket.on('connect', (event) => {
						socket.emit('set-username', this.username, () => {
							resolve(socket);
						});
					});
				});
			}).then((socket:SocketIOClient.Socket) => {
				return socket;
			});
			return this.namespaces[name];
		}
	};
	public trigger(channelName:string, eventName:string, eventContents:any):void {
		this.getNamespace(channelName).then((room) => {
			room.emit('data', eventName, eventContents);
		});
	};
	public bind(channelName:string, eventName:string, callback:(any)=>any):void {
		this.getNamespace(channelName).then((room) => {
			room.on(`data-${eventName}`, (val) => {
				callback(val);
			});
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
			return new Promise((resolve, reject) => {
				socket.emit('channel-available', channelName, (available:boolean) => {
					resolve(available);
				});
			});
		}) as Promise<boolean>;
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