"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const sio = require("socket.io");
class ChatCodesSocketIOServer {
    constructor(port) {
        this.port = port;
        this.namespaces = {};
        this.server = new ChatCodesSocketIOServer(8888);
        this.io = sio(this.port);
        this.io.on('connection', (socket) => {
            socket.on('request-join-room', (roomName, callback) => {
                const ns = this.getNamespace(roomName);
                callback();
            });
            socket.on('get-membersin-room', (roomName, callback) => {
                const ns = this.getNamespace(roomName);
                ns.clients({});
                callback(clients);
                callback();
            });
        }, public, getNamespace(name, string), SocketIO.Namespace, {
            if(_, has = (this.namespaces, name)) {
                return this.namespaces[name];
            }, else: {
                const: ns = this.io.of(`/${name}`),
                ns: .on('connection', (s) => {
                    s.on('event', (data) => {
                        s.broadcast.emit('event', data);
                    });
                }),
                this: .namespaces[name] = ns,
                return: this.namespaces[name]
            }
        }, destroy(), void {
            this: .io.close()
        });
    }
}
exports.ChatCodesSocketIOServer = ChatCodesSocketIOServer;
//# sourceMappingURL=server.js.map