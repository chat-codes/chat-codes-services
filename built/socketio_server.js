"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const sio = require("socket.io");
const _ = require("underscore");
class ChatCodesSocketIOServer {
    constructor(port) {
        this.port = port;
        this.namespaces = {};
        this.members = {};
        this.io = sio(this.port);
        this.io.on('connection', (socket) => {
            socket.on('request-join-room', (roomName, callback) => {
                const ns = this.getNamespace(roomName);
                callback();
            });
            socket.on('channel-available', (roomName, callback) => {
                const ns = this.getNamespace(roomName);
                ns.clients((err, clients) => {
                    if (err) {
                        console.error(err);
                    }
                    callback(clients.length === 0);
                });
            });
        });
    }
    ;
    getNamespace(name) {
        if (_.has(this.namespaces, name)) {
            return this.namespaces[name];
        }
        else {
            const ns = this.io.of(`/${name}`);
            ns.on('connection', (s) => {
                const { id } = s;
                const member = {
                    id: id,
                    info: {
                        name: null
                    }
                };
                this.members[id] = member;
                s.on('set-username', (username, callback) => {
                    member.info.name = username;
                    callback();
                    s.broadcast.emit('member-added', member);
                });
                s.on('data', (eventName, payload) => {
                    s.broadcast.emit(`data-${eventName}`, payload);
                });
                s.on('disconnect', () => {
                    s.broadcast.emit('member-removed', member);
                });
                s.on('get-members', (callback) => {
                    ns.clients((err, clients) => {
                        if (err) {
                            console.error(err);
                        }
                        const result = {};
                        _.each(clients, (id) => {
                            result[id] = this.members[id].info;
                        });
                        callback({
                            me: member,
                            myID: s.id,
                            members: result,
                            count: clients.length
                        });
                    });
                });
            });
            this.namespaces[name] = ns;
            return this.namespaces[name];
        }
    }
    destroy() {
        this.io.close();
    }
}
exports.ChatCodesSocketIOServer = ChatCodesSocketIOServer;
const server = new ChatCodesSocketIOServer(8888);
//# sourceMappingURL=socketio_server.js.map