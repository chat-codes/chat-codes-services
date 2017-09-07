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
    getNamespace(name) {
        if (_.has(this.namespaces, name)) {
            return this.namespaces[name];
        }
        else {
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
            }).then((socket) => {
                return socket;
            });
            return this.namespaces[name];
        }
    }
    ;
    trigger(channelName, eventName, eventContents) {
        this.getNamespace(channelName).then((room) => {
            room.emit('data', eventName, eventContents);
        });
    }
    ;
    bind(channelName, eventName, callback) {
        this.getNamespace(channelName).then((room) => {
            room.on(`data-${eventName}`, (val) => {
                callback(val);
            });
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
        return this.getNamespace(channelName);
    }
    ;
    destroy() {
        // this.manager.then((manager) => {
        // });
    }
    ;
}
exports.SocketIOCommunicationLayer = SocketIOCommunicationLayer;
//# sourceMappingURL=socket-communication-layer.js.map