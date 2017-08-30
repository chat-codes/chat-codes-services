"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const socket_io_client_1 = require("socket.io-client");
console.log(socket_io_client_1.Manager);
const manager = new socket_io_client_1.Manager('http://localhost:8888');
// console.log(manager);
// const io = sio('http://localhost:8888', {
// 	autoConntect: false
// });
//
// io.on('connect', () => {
// 	console.log(io);
// });
//
// io.open(() => {
// 	console.log('ready');
// });
// export class ChatCodesSocketIOClient {
// 	private namespaces:{[name:string]:Promise<any>} = {};
//
// 	constructor(private server:string, private port:number) {
// 	};
// 	// public onMemberAdded(channelName:string, callback:(event)=>any):void {
// 	// 	this.getNamespace(channelName).then((ns) => {
// 	// 	});
// 	// };
// 	// public onMemberRemoved(channelName:string, callback:(event)=>any):void {
// 	// };
// 	// public channelReady(channelName:string):Promise<any> {
// 	// 	return null;
// 	// };
// 	public trigger(channelName:string, eventName:string, eventContents):void {
// 		this.getNamespace(channelName).then((ns) => {
// 			ns.emit(eventName, eventContents);
// 		}).catch((err) => {
// 			console.error(err);
// 		});
// 	};
// 	public bind(channelName:string, eventName:string, callback:(any)=>any):void {
// 		this.getNamespace(channelName).then((ns) => {
// 			ns.on(eventName, (val) => {
// 				callback(val);
// 			});
// 		}).catch((err) => {
// 			console.error(err);
// 		});
// 	};
// 	// public getMembers(channelName:string):any {
// 	// };
// 	// public channelNameAvailable(channelName:string):Promise<boolean> {
// 	// 	return null;
// 	// };
// 	// public destroy() {
// 	// 	this.ioPromise.then((socket) => {
// 	// 		socket.disconnect();
// 	// 	});
// 	// };
// 	private getNamespace(name:string):Promise<any> {
// 		if(_.has(this.namespaces, name)) {
// 			return this.namespaces[name];
// 		} else {
// 			this.namespaces[name] = new Promise((resolve, reject) => {
// 				const io = sio(`http://${this.server}:${this.port}`, {
// 					path: `/${name}`
// 				});
// 				resolve(io);
// 				// io.on('connect', () => {console.log(io); resolve(io); });
// 				// io.on('connect_error', (error) => {console.log(error); reject(error); });
// 				// io.on('connect_timeout', (timeout) => { reject(timeout); });
// 			});
// 			return this.namespaces[name];
// 		}
// 	};
// }
// const client2 = new ChatCodesSocketIOClient('localhost', 8888);
// client2.bind('example', 'ev', (d) => {
// 	console.log(d);
// });
//
// const client = new ChatCodesSocketIOClient('localhost', 8888);
// client.trigger('example', 'ev', 'DATA1');
// Custom REPL using Vorpal
// vorpal.command('\\join <room>')
// .description('Joins a room.')
// .alias('\\j')
// .action(function(args, cb){
// 	return client.joinRoom(args, cb);
// });
//
// vorpal.command('\\leave <room>')
// .description('Leaves a room.')
// .alias('\\l')
// .action(function(args, cb){
// 	return client.leaveRoom(args, cb);
// });
//
// vorpal.command('\\send <message> [event]')
// .description('Sends message to room.')
// .alias('\\s')
// .action(function(args, cb){
// 	return client.sendMessage(args, cb);
// });
//
// vorpal.command('\\subscribe <event>')
// .description('Subscribes to an event type.')
// .alias('\\sub')
// .action(function(args, cb){
// 	return client.subscribe(args, cb);
// });
//
// vorpal.command('\\unsubscribe <event>')
// .description('Unsubscribes to an event type.')
// .alias('\\un')
// .action(function(args, cb){
// 	return client.unsubscribe(args, cb);
// });
// Not using promises at all.
// There's some pretty decent reasoning re this here:
// https://stackoverflow.com/a/37365657
//
// const _ = require('underscore');
// const uid = require('guid').create();
// const io = require("socket.io-client");
// const socket = io('http://localhost:3030');
// const vorpal = require('vorpal')();
// const defaultRoom = 'general';
//
// // Main Socket Client
// class SocketClient {
// 	constructor(socket, uid, room) {
// 		this.socket = socket;
// 		this.uid = uid;
// 		this.room = room;
// 		this.resetVorpal();
// 		this.subscribe({ 'event': 'message' }, function(){});
// 	}
//
// 	joinRoom(args, callback) {
// 		this.room = _.pick(args, 'room').room;
// 		this.socket.emit('join-room', this.room, this.uid);
// 		this.resetVorpal();
// 		callback();
// 	}
//
// 	leaveRoom(args, callback) {
// 		let oldRoom = _.pick(args, 'room').room;
// 		if(oldRoom == defaultRoom) {
// 			console.log('Cant leave the default room: ' + defaultRoom);
// 		} else {
// 			this.socket.emit('leave-room', oldRoom, this.uid);
// 			this.room = defaultRoom;
// 			this.resetVorpal();
// 		}
// 		callback();
// 	}
//
// 	sendMessage(args, callback) {
// 		let message = _.pick(args, 'message').message;
// 		let event = _.pick(args, 'event').event || 'message';
// 		this.socket.emit('send-message', this.room, message, event);
// 		callback();
// 	}
//
// 	subscribe(args, callback) {
// 		let event = _.pick(args, 'event').event;
// 		let that = this;
// 		this.socket.on(event, function(data) {
// 			console.log(data);
// 			that.resetVorpal();
// 		});
// 		callback();
// 	}
//
// 	unsubscribe(args, callback) {
// 		let event = _.pick(args, 'event').event;
// 		this.socket.off(event);
// 		callback();
// 	}
//
// 	resetVorpal(){
// 		vorpal .delimiter(this.room+'-chat>')
// 				.show();
// 	}
//
// }
//# sourceMappingURL=client.js.map