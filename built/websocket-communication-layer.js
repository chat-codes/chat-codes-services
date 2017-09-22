"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const _ = require("underscore");
const WebSocket = require("ws");
class SocketIOCommunicationLayer {
    constructor(authInfo) {
        this.authInfo = authInfo;
        this.namespaces = {};
        this.username = authInfo.username;
        this.ws = new WebSocket(`ws://${authInfo.host}:${authInfo.port}`);
    }
    trigger(channel, event, payload) {
        this.ws.send({ channel, event, payload });
    }
    ;
    bind(channelName, eventName, callback) {
        this.getNamespaceAndHistory(channelName).then((data) => {
            const { socket, listeners } = data;
            if (_.has(listeners, eventName)) {
                listeners[eventName].push(callback);
            }
            else {
                listeners[eventName] = [callback];
            }
            socket.on(`data-${eventName}`, callback);
            // (val) => {
            // 	callback(val);
            // });
        });
    }
    ;
    getMembers(channelName) {
        return this.getNamespace(channelName).then((room) => {
            return new Promise((resolve, reject) => {
                room.emit('get-members', (memberInfo) => {
                    resolve(memberInfo);
                });
            });
        });
    }
    ;
    channelNameAvailable(channelName) {
        return this.mainSocket.then((socket) => {
            return new Promise((resolve, reject) => {
                socket.emit('channel-available', channelName, (available) => {
                    resolve(available);
                });
            });
        });
    }
    ;
    onMemberAdded(channelName, callback) {
        this.getNamespace(channelName).then((room) => {
            room.on('member-added', (member) => {
                callback(member);
            });
        });
    }
    ;
    onMemberRemoved(channelName, callback) {
        this.getNamespace(channelName).then((room) => {
            room.on('member-removed', (member) => {
                callback(member);
            });
        });
    }
    ;
    channelReady(channelName) {
        return this.getNamespaceAndHistory(channelName).then((data) => {
            return data.history;
        });
    }
    ;
    destroy() {
        // this.manager.then((manager) => {
        // });
    }
    ;
    reTrigger(channelName, eventName, payload) {
        this.getNamespaceAndHistory(channelName).then((data) => {
            const { listeners } = data;
            _.each(listeners[eventName], (callback) => {
                callback(payload);
            });
        });
    }
}
exports.SocketIOCommunicationLayer = SocketIOCommunicationLayer;
//# sourceMappingURL=websocket-communication-layer.js.map