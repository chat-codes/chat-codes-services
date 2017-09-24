"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const _ = require("underscore");
const commandLineArgs = require("command-line-args");
const fs = require("fs");
const path = require("path");
const pg = require("pg");
const ShareDB = require("sharedb");
const ShareDBMongo = require("sharedb-mongo");
const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const WebSocketJSONStream = require("websocket-json-stream");
pg.defaults.ssl = true;
function getCredentials(filename = path.join(__dirname, 'db_creds.json')) {
    return new Promise((resolve, reject) => {
        fs.readFile(filename, 'utf-8', (err, contents) => {
            if (err) {
                reject(err);
            }
            resolve(contents);
        });
    }).then((contents) => {
        return JSON.parse(contents);
    });
}
class ChatCodesChannelServer {
    constructor(sharedb, wss, channelName) {
        this.sharedb = sharedb;
        this.wss = wss;
        this.channelName = channelName;
        this.members = new Set();
    }
    initialize() {
        return Promise.all([this.getShareDBChat(), this.getShareDBUsers()]).then((result) => {
            const [chat, users] = result;
            console.log(chat);
            return true;
        });
    }
    addMember(member) {
        this.members.add(member);
    }
    getChannelName() { return this.channelName; }
    ;
    getShareDBChat() {
        return new Promise((resolve, reject) => {
            const connection = this.sharedb.connect();
            const doc = connection.get(this.getChannelName(), 'chat');
            const contents = { 'key1': 'value1', 'key2': 'value2' };
            doc.fetch((err) => {
                if (err) {
                    reject(err);
                }
                else if (doc.type === null) {
                    doc.create(contents, () => {
                        resolve(doc);
                    });
                }
                else {
                    resolve(doc);
                }
            });
        });
    }
    ;
    getShareDBDoc(id, contents) {
        return new Promise((resolve, reject) => {
            const connection = this.sharedb.connect();
            const doc = connection.get(this.getChannelName(), id);
            doc.fetch((err) => {
                if (err) {
                    reject(err);
                }
                else if (doc.type === null) {
                    doc.create(contents, () => {
                        resolve(doc);
                    });
                }
                else {
                    resolve(doc);
                }
            });
        });
    }
    ;
    getShareDBUsers() {
        return new Promise((resolve, reject) => {
            const connection = this.sharedb.connect();
            const doc = connection.get(this.getChannelName(), 'users');
            const contents = [];
            doc.fetch((err) => {
                if (err) {
                    reject(err);
                }
                else if (doc.type === null) {
                    doc.create(contents, () => {
                        resolve(doc);
                    });
                }
                else {
                    resolve(doc);
                }
            });
        });
    }
    ;
}
exports.ChatCodesChannelServer = ChatCodesChannelServer;
class ChatCodesShareDBServer {
    constructor(port, dbURL) {
        this.port = port;
        this.channels = new Map();
        this.app = express();
        this.server = http.createServer(this.app);
        this.wss = new WebSocket.Server({ server: this.server });
        this.db = ShareDBMongo('mongodb://localhost:27017/test');
        // this.sharedb = new ShareDB({ db: this.db });
        this.sharedb = new ShareDB({});
        this.wss.on('connection', (socket) => {
            this.handleConnection(socket);
        });
        this.server.listen(port);
        console.log(`Created server on port ${port}`);
    }
    ;
    handleConnection(socket) {
        const stream = new WebSocketJSONStream(socket);
        this.sharedb.listen(stream);
        this.addSocketEventListener(socket, 'join-channel', (data, respond) => {
            const { target, channel } = data;
            let channelPromise;
            if (!this.channels.has(channel)) {
                const channelServer = new ChatCodesChannelServer(this.sharedb, this.wss, channel);
                this.channels.set(channel, channelServer);
                channelPromise = channelServer.initialize();
            }
            else {
                channelPromise = Promise.resolve(true);
            }
            const channelServer = this.channels.get(channel);
            channelServer.addMember(target);
            channelPromise.then(() => {
                respond({
                    channel
                });
            });
        });
    }
    ;
    addSocketEventListener(socket, eventType, callback) {
        socket.addEventListener('message', (event) => {
            const data = JSON.parse(event.data);
            if (data.type === eventType) {
                const { responseID } = data;
                if (responseID) {
                    callback(data, (responseData) => {
                        socket.send(JSON.stringify(_.extend({
                            responseID
                        }, responseData)));
                    });
                }
                else {
                    callback(data);
                }
            }
        });
    }
    ;
    getShareDBChannelList() {
        return new Promise((resolve, reject) => {
            const connection = this.sharedb.connect();
            const doc = connection.get('', 'members');
            const contents = [];
            doc.fetch((err) => {
                if (err) {
                    reject(err);
                }
                else if (doc.type === null) {
                    doc.create(contents, () => {
                        resolve(doc);
                    });
                }
                else {
                    resolve(doc);
                }
            });
        });
    }
    ;
    destroy() {
        this.server.close();
    }
    ;
}
exports.ChatCodesShareDBServer = ChatCodesShareDBServer;
const optionDefinitions = [
    { name: 'port', alias: 'p', type: Number, defaultOption: true, defaultValue: process.env['PORT'] || 8080 },
    { name: 'dburl', alias: 'd', type: String, defaultValue: process.env['DATABASE_URL'] || 'mongodb://localhost:27017/test' }
];
const options = commandLineArgs(optionDefinitions);
const server = new ChatCodesShareDBServer(options.port, options.dburl);
//# sourceMappingURL=sharedb_server.js.map