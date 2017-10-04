"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const sharedb = require("sharedb/lib/client");
class NamespaceCommunicator {
    constructor(channelName, username, ws) {
        this.channelName = channelName;
        this.username = username;
        this.ws = ws;
        this.responseCallbacks = new Map();
        this.typeCallbacks = new Map();
        this.id = `/${this.getChannelName()}#${guid()}`;
        this.wsPromise = new Promise((resolve, reject) => {
            if (this.ws.readyState === WebSocket.OPEN) {
                resolve(this.ws);
            }
            else {
                this.ws.addEventListener('open', (event) => {
                    resolve(this.ws);
                });
            }
        });
        this.readyPromise = this.wsPromise.then(() => {
            ws.addEventListener('message', (event) => {
                const { data } = event;
                try {
                    const parsedData = JSON.parse(data);
                    if (parsedData.cc === 2) {
                        if (parsedData.ns == this.getShareDBNamespace()) {
                            if (this.responseCallbacks.has(parsedData.messageID)) {
                                const callback = this.responseCallbacks.get(parsedData.messageID);
                                callback(null, parsedData.payload);
                                this.responseCallbacks.delete(parsedData.messageID);
                            }
                            else if (this.typeCallbacks.has(parsedData.type)) {
                                const callbacks = this.typeCallbacks.get(parsedData.type);
                                callbacks.forEach((callback) => {
                                    callback(null, parsedData.payload);
                                });
                            }
                        }
                    }
                }
                catch (e) {
                    console.error(e);
                }
            });
            if (this.getChannelName()) {
                return this.pemit('request-join-room', {
                    channel: this.getChannelName(),
                    username: this.username,
                    id: this.getID()
                });
            }
            else {
                return true;
            }
        }).then((result) => {
            const { id, ns } = result;
            this.channelID = id;
            this.shareDBNamespace = ns;
            return this;
        });
    }
    emit(type, payload, callback) {
        let messageID = null;
        if (callback) {
            messageID = guid();
            this.responseCallbacks.set(messageID, callback);
        }
        const message = { messageID, type, ns: this.getShareDBNamespace(), payload, cc: 1 };
        this.wsPromise.then((ws) => {
            try {
                ws.send(JSON.stringify(message));
            }
            catch (e) {
                if (callback) {
                    callback(e);
                    this.responseCallbacks.delete(messageID);
                }
                console.error(e);
            }
        });
    }
    pemit(type, payload) {
        return new Promise((resolve, reject) => {
            const callback = (err, data) => {
                if (err) {
                    reject(err);
                }
                else {
                    resolve(data);
                }
            };
            this.emit(type, payload, callback);
        });
    }
    ;
    on(type, callback) {
        if (this.typeCallbacks.has(type)) {
            this.typeCallbacks.get(type).push(callback);
        }
        else {
            this.typeCallbacks.set(type, [callback]);
        }
    }
    off(type, callback) {
        if (this.typeCallbacks.has(type)) {
            const callbacks = this.typeCallbacks.get(type);
            for (let i = 0; i < callbacks.length; i++) {
                const cb = callbacks[i];
                if (cb === callback) {
                    callbacks.splice(i, 1);
                    i--;
                }
            }
            if (callbacks.length === 0) {
                this.typeCallbacks.delete(type);
            }
        }
    }
    ready() {
        return this.readyPromise;
    }
    getID() { return this.id; }
    getChannelName() { return this.channelName; }
    ;
    getChannelID() { return this.channelID; }
    ;
    getShareDBNamespace() { return this.shareDBNamespace; }
    ;
    destroy() {
    }
    ;
}
class WebSocketCommunicationLayer {
    constructor(authInfo) {
        this.authInfo = authInfo;
        this.namespaces = new Map();
        this.disconnectListeners = [];
        this.username = authInfo.username;
        this.wsPromise = new Promise((resolve, reject) => {
            const ws = new WebSocket(`ws://${authInfo.host}:${authInfo.port}`);
            ws.addEventListener('open', (event) => {
                resolve(ws);
            });
            ws.addEventListener('close', (event) => {
                this.disconnectListeners.forEach((cb) => cb());
            });
        });
        this.mainSocket = this.wsPromise.then((ws) => {
            return new NamespaceCommunicator(null, this.username, ws).ready();
        });
        this.shareDBConnectionPromise = this.wsPromise.then((ws) => {
            const connection = new sharedb.Connection(ws);
            // connection.debug = true;
            return connection;
        });
    }
    onDisconnect(callback) {
        this.disconnectListeners.push(callback);
        return this;
    }
    getShareDBConnection() {
        return this.shareDBConnectionPromise;
    }
    getNamespace(name) {
        if (this.namespaces.has(name)) {
            return this.namespaces.get(name);
        }
        else {
            const namespacePromise = this.wsPromise.then((ws) => {
                return new NamespaceCommunicator(name, this.username, ws).ready();
            });
            this.namespaces.set(name, namespacePromise);
            return namespacePromise;
        }
    }
    getMyID(channelName) {
        return this.getNamespace(channelName).then((ns) => {
            return ns.getID();
        });
    }
    trigger(channelName, eventName, eventContents, callback) {
        this.getNamespace(channelName).then((room) => {
            if (callback) {
                room.emit(eventName, eventContents, callback);
            }
            else {
                room.emit(eventName, eventContents);
            }
        });
    }
    ;
    ptrigger(channelName, eventName, eventContents) {
        return this.getNamespace(channelName).then((room) => {
            return room.pemit(eventName, eventContents);
        });
    }
    getShareDBObject(channelName, path) {
        return Promise.all([this.getNamespace(channelName), this.shareDBConnectionPromise]).then((info) => {
            const room = info[0];
            const connection = info[1];
            const shareDBNamespace = room.getShareDBNamespace();
            const doc = connection.get(shareDBNamespace, path);
            return doc;
        });
    }
    ;
    bind(channelName, eventName, callback) {
        this.getNamespace(channelName).then((ns) => {
            ns.on(eventName, callback);
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
exports.WebSocketCommunicationLayer = WebSocketCommunicationLayer;
function guid() {
    function s4() {
        return Math.floor((1 + Math.random()) * 0x10000)
            .toString(16)
            .substring(1);
    }
    return s4() + s4() + '-' + s4() + '-' + s4() + '-' +
        s4() + '-' + s4() + s4() + s4();
}
//# sourceMappingURL=socket-communication-layer.js.map