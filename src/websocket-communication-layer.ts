import { CommunicationLayer } from './communication-layer-interface';
import * as _ from 'underscore';
// import * as WebSocket from 'ws';

export class WebSocketCommunicationLayer implements CommunicationLayer {
	private ws:WebSocket;
	private namespaces:{[name:string]:any} = {};
	private username:string;
	constructor(private authInfo) {
		this.username = authInfo.username;
		this.ws = new WebSocket(`ws://${authInfo.host}:${authInfo.port}`);
	}

	public trigger(channel:string, event:string, payload:any):void {
		this.ws.send(JSON.stringify({ type: 'data', channel, event, payload }));
	};
	public bind(channelName:string, eventName:string, callback:(any)=>any):void {
		// this.ws.addEventListener('message', (data:string) => {
		// 	const {type, channel, event, payload} = JSON.parse(data);
		// 	if(event === eventName && channel === channelName) {
		// 		callback(payload);
		// 	}
		// });
		// this.getNamespaceAndHistory(channelName).then((data) => {
		// 	const {socket, listeners} = data;
		// 	if(_.has(listeners, eventName)) {
		// 		listeners[eventName].push(callback);
		// 	} else {
		// 		listeners[eventName] = [callback];
		// 	}
		//
		// 	socket.on(`data-${eventName}`, callback);
		// 	// (val) => {
		// 	// 	callback(val);
		// 	// });
		// });
	};
	public getMembers(channelName:string):Promise<any> {
		return new Promise<any>((resolve, reject) => {
			this.ws.send(JSON.stringify({
				type: 'get-members',
				channel: channelName
			}));
			const membersListener = (data:string) => {
				const {type, channel, event, payload} = JSON.parse(data);
				if(type === 'get-members-reply' && channel === channelName) {
					(this.ws as any).removeEventListener('message', membersListener);
					resolve(payload);
				}
			};
			// this.ws.on('message', membersListener);
		});
		// return this.getNamespace(channelName).then((room) => {
		// 	return new Promise((resolve, reject) => {
		// 		room.emit('get-members', (memberInfo) => {
		// 			resolve(memberInfo);
		// 		});
		// 	});
		// }) as Promise<any>;
	};
	public channelNameAvailable(channelName:string):Promise<boolean> {
		return new Promise<boolean>((resolve, reject) => {
			this.ws.send({
				type: 'channel-available',
				channel: channelName
			});
			const membersListener = (data) => {
				const {type, channel, event, payload} = data;
				if(type === 'channel-available-reply' && channel === channelName) {
					(this.ws as any).removeEventListener('message', membersListener);
					resolve(payload);
				}
			};
			// this.ws.on('message', membersListener);
		});
		// return this.mainSocket.then((socket) => {
		// 	return new Promise<boolean>((resolve, reject) => {
		// 		socket.emit('channel-available', channelName, (available:boolean) => {
		// 			resolve(available);
		// 		});
		// 	});
		// });
	};
	// public onMemberAdded(channelName:string, callback:(event)=>any):void {
	// 	this.ws.on('message', (data) => {
	// 		const {type, channel, event, payload} = data;
	// 		if(channel === channelName && type === 'member-added') {
	// 			callback(payload);
	// 		}
	// 	});
	// };
	// public onMemberRemoved(channelName:string, callback:(event)=>any):void {
	// 	this.ws.on('message', (data) => {
	// 		const {type, channel, event, payload} = data;
	// 		if(channel === channelName && type === 'member-removed') {
	// 			callback(payload);
	// 		}
	// 	});
	// };
	private wsSend(data:any) {
		this.ws.send(JSON.stringify(data));
	}
	private messageID:number=1;
	private wsSendWithResponse(data):Promise<any> {
		return new Promise((resolve, reject) => {
			const messageID = this.messageID++;
			this.wsSend(_.extend({
				responseID: messageID
			}, data));
			const responseListener = (responseStr) => {
				const response = JSON.parse(responseStr);
				if(response.responseID === messageID) {
					resolve(response);
				}
			};
			this.ws.addEventListener('message', responseListener);
		});
	};

	public channelReady(channelName:string):Promise<any> {
		return new Promise<boolean>((resolve, reject) => {
			this.wsSend({
				type: 'join-channel',
				channel: channelName
			});
			// this.ws.send({
			// 	type: 'channel-available',
			// 	channel: channelName
			// });
			// const membersListener = (data) => {
			// 	const {type, channel, event, payload} = data;
			// 	if(type === 'channel-available-reply' && channel === channelName) {
			// 		(this.ws as any).removeEventListener('message', membersListener);
			// 		resolve(payload);
			// 	}
			// };
			// this.ws.on('message', membersListener);
		});
	};
	public destroy():void {
		this.ws.close(0);
		// this.manager.then((manager) => {
		// });
	};
	// public reTrigger(channelName:string, eventName:string, payload):void {
	// 	this.getNamespaceAndHistory(channelName).then((data) => {
	// 		const {listeners} = data;
	// 		_.each(listeners[eventName], (callback:any) => {
	// 			callback(payload);
	// 		})
	// 	});
	// }
}
