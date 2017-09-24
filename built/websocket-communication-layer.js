"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const _ = require("underscore");
// import * as WebSocket from 'ws';
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
        this.wsPromise.then((ws) => {
            ws.send(JSON.stringify({ type: 'data', channel, event, payload }));
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
            this.ws.send(JSON.stringify({
                type: 'get-members',
                channel: channelName
            }));
            const membersListener = (data) => {
                const { type, channel, event, payload } = JSON.parse(data);
                if (type === 'get-members-reply' && channel === channelName) {
                    this.ws.removeEventListener('message', membersListener);
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
    }
    ;
    channelNameAvailable(channelName) {
        return new Promise((resolve, reject) => {
            this.ws.send({
                type: 'channel-available',
                channel: channelName
            });
            const membersListener = (data) => {
                const { type, channel, event, payload } = data;
                if (type === 'channel-available-reply' && channel === channelName) {
                    this.ws.removeEventListener('message', membersListener);
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
        return new Promise((resolve, reject) => {
            const messageID = this.messageID++;
            this.wsSend(_.extend({
                responseID: messageID
            }, data));
            const responseListener = (responseStr) => {
                const response = JSON.parse(responseStr);
                if (response.responseID === messageID) {
                    resolve(response);
                }
            };
            this.ws.addEventListener('message', responseListener);
        });
    }
    ;
    channelReady(channelName) {
        return new Promise((resolve, reject) => {
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
    }
    ;
    destroy() {
        this.ws.close(0);
        // this.manager.then((manager) => {
        // });
    }
    ;
}
exports.WebSocketCommunicationLayer = WebSocketCommunicationLayer;
//# sourceMappingURL=websocket-communication-layer.js.map