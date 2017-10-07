"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var sharedb = require("sharedb/lib/client");
var NamespaceCommunicator = /** @class */ (function () {
    function NamespaceCommunicator(channelName, channelID, username, ws, sdbp) {
        var _this = this;
        this.channelName = channelName;
        this.channelID = channelID;
        this.username = username;
        this.ws = ws;
        this.sdbp = sdbp;
        this.responseCallbacks = new Map();
        this.typeCallbacks = new Map();
        this.id = "/" + this.getChannelName() + "#" + guid();
        this.wsPromise = new Promise(function (resolve, reject) {
            if (_this.ws.readyState === WebSocket.OPEN) {
                resolve(_this.ws);
            }
            else {
                _this.ws.addEventListener('open', function (event) {
                    resolve(_this.ws);
                });
            }
        });
        this.readyPromise = this.wsPromise.then(function () {
            ws.addEventListener('message', function (event) {
                var data = event.data;
                try {
                    var parsedData_1 = JSON.parse(data);
                    if (parsedData_1.cc === 2) {
                        if (parsedData_1.ns == _this.getShareDBNamespace()) {
                            if (_this.responseCallbacks.has(parsedData_1.messageID)) {
                                var callback = _this.responseCallbacks.get(parsedData_1.messageID);
                                callback(null, parsedData_1.payload);
                                _this.responseCallbacks.delete(parsedData_1.messageID);
                            }
                            else if (_this.typeCallbacks.has(parsedData_1.type)) {
                                var callbacks = _this.typeCallbacks.get(parsedData_1.type);
                                callbacks.forEach(function (callback) {
                                    callback(null, parsedData_1.payload);
                                });
                            }
                        }
                    }
                }
                catch (e) {
                    console.error(e);
                }
            });
            if (_this.getChannelName()) {
                return _this.pemit('request-join-room', {
                    channel: _this.getChannelName(),
                    channelID: _this.channelID,
                    username: _this.username,
                    id: _this.getID()
                });
            }
            else {
                return true;
            }
        }).then(function (result) {
            var id = result.id, ns = result.ns;
            _this.channelID = id;
            _this.shareDBNamespace = ns;
            return _this;
        });
    }
    NamespaceCommunicator.prototype.emit = function (type, payload, callback) {
        var _this = this;
        var messageID = null;
        if (callback) {
            messageID = guid();
            this.responseCallbacks.set(messageID, callback);
        }
        var message = { messageID: messageID, type: type, ns: this.getShareDBNamespace(), payload: payload, cc: 1 };
        this.wsPromise.then(function (ws) {
            try {
                ws.send(JSON.stringify(message));
            }
            catch (e) {
                if (callback) {
                    callback(e);
                    _this.responseCallbacks.delete(messageID);
                }
                console.error(e);
            }
        });
    };
    NamespaceCommunicator.prototype.pemit = function (type, payload) {
        var _this = this;
        return new Promise(function (resolve, reject) {
            var callback = function (err, data) {
                if (err) {
                    reject(err);
                }
                else {
                    resolve(data);
                }
            };
            _this.emit(type, payload, callback);
        });
    };
    ;
    NamespaceCommunicator.prototype.bind = function (type, callback) {
        if (this.typeCallbacks.has(type)) {
            this.typeCallbacks.get(type).push(callback);
        }
        else {
            this.typeCallbacks.set(type, [callback]);
        }
    };
    NamespaceCommunicator.prototype.unbind = function (type, callback) {
        if (this.typeCallbacks.has(type)) {
            var callbacks = this.typeCallbacks.get(type);
            for (var i = 0; i < callbacks.length; i++) {
                var cb = callbacks[i];
                if (cb === callback) {
                    callbacks.splice(i, 1);
                    i--;
                }
            }
            if (callbacks.length === 0) {
                this.typeCallbacks.delete(type);
            }
        }
    };
    NamespaceCommunicator.prototype.ready = function () {
        return this.readyPromise;
    };
    NamespaceCommunicator.prototype.getID = function () { return this.id; };
    NamespaceCommunicator.prototype.getChannelName = function () { return this.channelName; };
    ;
    NamespaceCommunicator.prototype.getChannelID = function () { return this.channelID; };
    ;
    NamespaceCommunicator.prototype.getShareDBNamespace = function () { return this.shareDBNamespace; };
    ;
    NamespaceCommunicator.prototype.getShareDBObject = function (path) {
        var _this = this;
        return this.sdbp.then(function (connection) {
            return connection.get(_this.getShareDBNamespace(), path);
        });
    };
    ;
    NamespaceCommunicator.prototype.destroy = function () {
    };
    ;
    NamespaceCommunicator.prototype.trigger = function (channelName, eventName, eventContents, callback) {
        if (callback) {
            this.emit(eventName, eventContents, callback);
        }
        else {
            this.emit(eventName, eventContents);
        }
    };
    ;
    return NamespaceCommunicator;
}());
exports.NamespaceCommunicator = NamespaceCommunicator;
var WebSocketCommunicationLayer = /** @class */ (function () {
    function WebSocketCommunicationLayer(authInfo) {
        var _this = this;
        this.authInfo = authInfo;
        this.namespaces = new Map();
        this.disconnectListeners = [];
        this.username = authInfo.username;
        this.wsPromise = new Promise(function (resolve, reject) {
            var wsProtocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
            var ws = new WebSocket(wsProtocol + "://" + authInfo.host);
            ws.addEventListener('open', function (event) {
                resolve(ws);
            });
            ws.addEventListener('close', function (event) {
                _this.disconnectListeners.forEach(function (cb) { return cb(); });
            });
        });
        this.mainSocket = this.wsPromise.then(function (ws) {
            return new NamespaceCommunicator(null, null, _this.username, ws, _this.shareDBConnectionPromise).ready();
        });
        this.shareDBConnectionPromise = this.wsPromise.then(function (ws) {
            var connection = new sharedb.Connection(ws);
            // connection.debug = true;
            return connection;
        });
    }
    WebSocketCommunicationLayer.prototype.onDisconnect = function (callback) {
        this.disconnectListeners.push(callback);
        return this;
    };
    WebSocketCommunicationLayer.prototype.getShareDBConnection = function () {
        return this.shareDBConnectionPromise;
    };
    WebSocketCommunicationLayer.prototype.getNamespace = function (channelName, channelID) {
        var _this = this;
        if (this.namespaces.has(channelName)) {
            return this.namespaces.get(channelName);
        }
        else {
            var namespacePromise = this.wsPromise.then(function (ws) {
                return new NamespaceCommunicator(channelName, channelID, _this.username, ws, _this.shareDBConnectionPromise).ready();
            });
            this.namespaces.set(channelName, namespacePromise);
            return namespacePromise;
        }
    };
    WebSocketCommunicationLayer.prototype.getMembers = function (channelName) {
        return this.getNamespace(channelName).then(function (room) {
            return new Promise(function (resolve, reject) {
                room.emit('get-members', function (memberInfo) {
                    resolve(memberInfo);
                });
            });
        });
    };
    ;
    WebSocketCommunicationLayer.prototype.channelNameAvailable = function (channelName) {
        return this.mainSocket.then(function (socket) {
            return new Promise(function (resolve, reject) {
                socket.emit('channel-available', channelName, function (available) {
                    resolve(available);
                });
            });
        });
    };
    ;
    WebSocketCommunicationLayer.prototype.destroy = function () {
        // this.manager.then((manager) => {
        // });
    };
    ;
    return WebSocketCommunicationLayer;
}());
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