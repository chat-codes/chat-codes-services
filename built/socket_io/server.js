"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const sio = require("socket.io");
class ChatCodesSocketIOServer {
    constructor(port) {
        this.port = port;
        this.io = sio(this.port);
        console.log('started server');
        this.io.on('join-room', (room, uid) => {
            this.io.join(room);
        });
        this.io.on('leave-room', (room, uid) => {
            this.io.leave(room);
            console.log(uid + ' left ' + room);
        });
        this.io.on('send-message', (room, message, event) => {
            this.io.to(room).emit(event, message);
        });
    }
    destroy() {
        this.io.disconnect();
    }
}
exports.ChatCodesSocketIOServer = ChatCodesSocketIOServer;
const server = new ChatCodesSocketIOServer(8888);
//# sourceMappingURL=server.js.map