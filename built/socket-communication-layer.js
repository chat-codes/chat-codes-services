"use strict";
const socket_io_client_1 = require("socket.io-client");
const sharedb = require("sharedb/lib/client");
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
        this.wsConnectionPromise = new Promise((resolve, reject) => {
            this.mainSocket.then((socket) => {
                socket.on('connect', () => {
                    socket.once('connection-info', (info) => {
                        const { shareDBPort } = info;
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
        if (_.has(this.namespaces, name)) {
            return this.namespaces[name];
        }
        else {
            let socket;
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
                return new Promise((resolve, reject) => {
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
    getMyID(channelName) {
        return this.getNamespace(channelName).then((socket) => {
            return socket.id;
        });
    }
    trigger(channelName, eventName, eventContents) {
        this.getNamespace(channelName).then((room) => {
            room.emit('data', eventName, eventContents);
        });
    }
    ;
    getShareDBChat(channelName) {
        return this.wsConnectionPromise.then((connection) => {
            const doc = connection.get(channelName, 'chat');
            return doc;
        });
    }
    ;
    bind(channelName, eventName, callback) {
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
        return this.getNamespace(channelName).then((socket) => {
            return Promise.all([this.getShareDBChat(channelName)]);
        });
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