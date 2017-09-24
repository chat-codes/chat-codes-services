"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const _ = require("underscore");
const sharedb = require("sharedb/lib/client");
// import * as sharedb from './sdbclient';
// import * as sharedb from 'sharedb/client./sbdclient';
// const sharedb = require('./sdbclient');
// import * as WebSocket from 'ws';
// console.log(sharedb);
class WebSocketCommunicationLayer {
    constructor(authInfo) {
        this.authInfo = authInfo;
        this.namespaces = {};
        this.messageID = 1;
        this.username = authInfo.username;
        this.wsPromise = new Promise((resolve, reject) => {
            const ws = new WebSocket(`ws://${authInfo.host}:${authInfo.port}`);
            ws.addEventListener('open', function (event) {
                resolve(ws);
            });
        });
    }
    trigger(channel, event, payload) {
        this.wsSend({
            type: 'data',
            channel, event, payload
        });
    }
    ;
    bind(channelName, eventName, callback) {
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
    }
    ;
    getMembers(channelName) {
        return new Promise((resolve, reject) => {
            // this.ws.send(JSON.stringify({
            // 	type: 'get-members',
            // 	channel: channelName
            // }));
            // const membersListener = (data:string) => {
            // 	const {type, channel, event, payload} = JSON.parse(data);
            // 	if(type === 'get-members-reply' && channel === channelName) {
            // 		(this.ws as any).removeEventListener('message', membersListener);
            // 		resolve(payload);
            // 	}
            // };
            // this.ws.on('message', membersListener);
        });
        // return this.getNamespace(channelName).then((room) => {
        // 	return new Promise((resolve, reject) => {
        // 		room.emit('get-members', (memberInfo) => {
        // 			resolve(memberInfo);
        // 		});
        // 	});
        // }) as Promise<any>;
    }
    ;
    channelNameAvailable(channelName) {
        return new Promise((resolve, reject) => {
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
        // return this.mainSocket.then((socket) => {
        // 	return new Promise<boolean>((resolve, reject) => {
        // 		socket.emit('channel-available', channelName, (available:boolean) => {
        // 			resolve(available);
        // 		});
        // 	});
        // });
    }
    ;
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
    wsSend(data) {
        this.wsPromise.then((ws) => {
            ws.send(JSON.stringify(data));
        });
    }
    wsSendWithResponse(data) {
        return this.wsPromise.then((ws) => {
            return new Promise((resolve, reject) => {
                const messageID = this.messageID++;
                const responseListener = (event) => {
                    const response = JSON.parse(event.data);
                    if (response.responseID === messageID) {
                        resolve(response);
                    }
                };
                ws.addEventListener('message', responseListener);
                ws.send(JSON.stringify(_.extend({
                    responseID: messageID
                }, data)));
                // this.wsSend(_.extend({
                // 	responseID: messageID
                // }, data));
            });
        });
    }
    ;
    getShareDBChat(channelName) {
        return this.wsPromise.then((ws) => {
            const connection = new sharedb.Connection(ws);
            connection.debug = true;
            // console.log(connection);
            const doc = connection.get(channelName, 'chat');
            return new Promise((resolve, reject) => {
                doc.on('error', (err) => {
                    console.error(err);
                });
                doc.on('load', (m) => {
                    console.log(m);
                });
                console.log(doc);
                doc.subscribe((err) => {
                    console.log(err);
                    if (err) {
                        reject(err);
                    }
                    else {
                        resolve(doc);
                    }
                });
            });
        });
    }
    ;
    channelReady(channelName) {
        return new Promise((resolve, reject) => {
            this.wsSendWithResponse({
                type: 'join-channel',
                channel: channelName
            }).then((response) => {
                return this.getShareDBChat(channelName);
            }).then((chat) => {
                console.log(chat);
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
    }
    ;
    destroy() {
        this.wsPromise.then((ws) => {
            ws.close(0);
        });
        // this.manager.then((manager) => {
        // });
    }
    ;
}
exports.WebSocketCommunicationLayer = WebSocketCommunicationLayer;
//# sourceMappingURL=websocket-communication-layer.js.map