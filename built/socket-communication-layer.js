"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const socket_io_client_1 = require("socket.io-client");
const sharedb = require("sharedb/lib/client");
class SocketIOCommunicationLayer {
    constructor(authInfo) {
        this.authInfo = authInfo;
        this.namespaces = new Map();
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
                            window.connection = connection;
                            resolve(connection);
                        });
                    });
                });
            });
        });
    }
    createEditorDoc(channelName, id, contents) {
        return this.getNamespace(channelName).then((channel) => {
            return new Promise((resolve, reject) => {
                channel.emit('create-editor', id, contents, () => {
                    resolve();
                });
            });
        }).then(() => {
            return this.getShareDBObject(channelName, id);
        });
    }
    getWSConnection() {
        return this.wsConnectionPromise;
    }
    getNamespace(name) {
        if (this.namespaces.has(name)) {
            return this.namespaces.get(name);
        }
        else {
            let socket;
            const namespacePromise = this.namespaces[name] = this.mainSocket.then((socket) => {
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
            this.namespaces.set(name, namespacePromise);
            return namespacePromise;
        }
    }
    getMyID(channelName) {
        return this.getNamespace(channelName).then((socket) => {
            return socket.id;
        });
    }
    trigger(channelName, eventName, eventContents) {
        this.getNamespace(channelName).then((room) => {
            room.emit(`data-${eventName}`, eventContents);
        });
    }
    ;
    getShareDBObject(channelName, path) {
        return this.wsConnectionPromise.then((connection) => {
            const doc = connection.get(channelName, path);
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