"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const sio = require("socket.io");
const _ = require("underscore");
const commandLineArgs = require("command-line-args");
class ChatCodesSocketIOServer {
    constructor(port) {
        this.port = port;
        this.namespaces = {};
        this.members = {};
        this.io = sio(this.port);
        this.io.on('connection', (socket) => {
            const { id } = socket;
            socket.on('request-join-room', (roomName, callback) => {
                const ns = this.getNamespace(roomName);
                callback();
                console.log(`Client (${id}) requested to join ${roomName}`);
            });
            socket.on('channel-available', (roomName, callback) => {
                const ns = this.getNamespace(roomName);
                ns.clients((err, clients) => {
                    if (err) {
                        console.error(err);
                    }
                    callback(clients.length === 0);
                    console.log(`Telling (${id}) that ${roomName} is${clients.length === 0 ? " " : " not "}available`);
                });
                console.log(`Client (${id}) asked if ${roomName} is available`);
            });
            socket.on('ping', function (data, callback) {
                callback('pong', {
                    success: true,
                    received: data
                });
            });
            console.log(`Client connected (id: ${id})`);
        });
        console.log(`Created server on port ${port}`);
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
                    console.log(`Client (${id} in ${name}) set username to ${username}`);
                });
                s.on('data', (eventName, payload) => {
                    s.broadcast.emit(`data-${eventName}`, payload);
                });
                s.on('disconnect', () => {
                    s.broadcast.emit('member-removed', member);
                    console.log(`Client (${id} in ${name}) disconnected`);
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
                    console.log(`Client (${id} in ${name}) requested members`);
                });
                console.log(`Client connected to namespace ${name} (${id})`);
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
const optionDefinitions = [
    { name: 'port', alias: 'p', type: Number, defaultOption: true, defaultValue: 3000 }
];
const options = commandLineArgs(optionDefinitions);
const server = new ChatCodesSocketIOServer(options.port);
//# sourceMappingURL=socketio_server.js.map