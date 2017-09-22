import { CommunicationLayer } from './communication-layer-interface';
import * as _ from 'underscore';
import * as WebSocket from 'ws';

export class SocketIOCommunicationLayer implements CommunicationLayer {
	private ws:WebSocket;
	private namespaces:{[name:string]:any} = {};
	private username:string;
	constructor(private authInfo) {
		this.username = authInfo.username;
		this.ws = new WebSocket(`ws://${authInfo.host}:${authInfo.port}`);
	}

	public trigger(channel:string, event:string, payload:any):void {
		this.ws.send({ channel, event, payload });
	};
	public bind(channelName:string, eventName:string, callback:(any)=>any):void {
		this.getNamespaceAndHistory(channelName).then((data) => {
			const {socket, listeners} = data;
			if(_.has(listeners, eventName)) {
				listeners[eventName].push(callback);
			} else {
				listeners[eventName] = [callback];
			}

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
		return this.getNamespaceAndHistory(channelName).then((data) => {
			return data.history;
		});
	};
	public destroy():void {
		// this.manager.then((manager) => {
		// });
	};
	public reTrigger(channelName:string, eventName:string, payload):void {
		this.getNamespaceAndHistory(channelName).then((data) => {
			const {listeners} = data;
			_.each(listeners[eventName], (callback:any) => {
				callback(payload);
			})
		});
	}
}
