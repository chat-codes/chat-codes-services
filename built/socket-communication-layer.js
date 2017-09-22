"use strict";
const socket_io_client_1 = require("socket.io-client");
const _ = require("underscore");
class SocketIOCommunicationLayer {
    constructor(authInfo) {
        this.authInfo = authInfo;
        this.namespaces = {};
        this.username = authInfo.username;
        this.manager = new Promise((resolve, reject) => {
            resolve(new socket_io_client_1.Manager(`http://${authInfo.host}:${authInfo.port}`));
        });
        this.mainSocket = this.manager.then((manager) => {
            return manager.socket('/');
        });
    }
    getNamespaceAndHistory(name) {
        if (_.has(this.namespaces, name)) {
            return this.namespaces[name];
        }
        else {
            let socket;
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
                return new Promise((resolve, reject) => {
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
                    listeners: {}
                };
            });
            return this.namespaces[name];
        }
    }
    ;
    getNamespace(name) {
        return this.getNamespaceAndHistory(name).then((data) => {
            return data.socket;
        });
    }
    trigger(channelName, eventName, eventContents) {
        this.getNamespace(channelName).then((room) => {
            room.emit('data', eventName, eventContents);
        });
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
//# sourceMappingURL=socket-communication-layer.js.map