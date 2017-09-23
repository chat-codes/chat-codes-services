"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const commandLineArgs = require("command-line-args");
const fs = require("fs");
const path = require("path");
const pg = require("pg");
const ShareDB = require("sharedb");
const ShareDBMongo = require("sharedb-mongo");
const express = require("express");
const http = require("http");
const WebSocket = require("ws");
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
class ChatCodesShareDBServer {
    constructor(port, dbURL) {
        this.port = port;
        this.app = express();
        this.server = http.createServer(this.app);
        this.wss = new WebSocket.Server({ server: this.server });
        this.db = ShareDBMongo('mongodb://localhost:27017/test');
        this.sharedb = new ShareDB({ db: this.db });
        this.wss.on('connection', () => {
            console.log(arguments);
        });
        this.server.listen(port);
        console.log(`Created server on port ${port}`);
    }
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
    getShareDBUserList(channelName) {
        return new Promise((resolve, reject) => {
            const connection = this.sharedb.connect();
            const doc = connection.get(channelName, 'members');
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
    getShareDBDoc(channelName, id, contents) {
        return new Promise((resolve, reject) => {
            const connection = this.sharedb.connect();
            const doc = connection.get(channelName, id);
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