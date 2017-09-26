"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const sio = require("socket.io");
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
    constructor(sharedb, wss, channelName, io) {
        this.sharedb = sharedb;
        this.wss = wss;
        this.channelName = channelName;
        this.io = io;
        this.members = new Set();
        this.ns = this.io.of(`/${channelName}`);
        this.getShareDBChat();
        // console.log(this.ns);
    }
    initialize() {
        this.ns.on('connection', (s) => {
            const { id } = s;
            let dbid;
            const member = {
                id: id,
                joined: (new Date()).getTime(),
                left: -1,
                info: {
                    name: null
                }
            };
            this.members[id] = member;
            s.on('set-username', (username, callback) => {
                member.info.name = username;
                Promise.all([this.getShareDBChat()]).then((result) => {
                    const [chatDoc] = result;
                    chatDoc.submitOp([{ p: ['activeUsers', id], oi: member }]);
                    chatDoc.submitOp([{ p: ['allUsers', id], oi: member }]);
                    callback({
                        myID: id
                    });
                });
                console.log(`Client (${id} in ${this.getChannelName()}) set username to ${username}`);
            });
            s.on('disconnect', () => {
                Promise.all([this.getShareDBChat()]).then((result) => {
                    const [chatDoc] = result;
                    chatDoc.submitOp([{ p: ['allUsers', id], od: member }]);
                    ;
                });
            });
            console.log(`Client connected to namespace ${this.getChannelName()} (${id})`);
        });
        return Promise.all([this.getShareDBChat(), this.getShareDBUsers()]).then((result) => {
            const [chat, users] = result;
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
            connection.debug = true;
            const doc = connection.get(this.getChannelName(), 'chat');
            const contents = {
                'activeUsers': {},
                'allUsers': {},
                'messages': []
            };
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
        }).then((doc) => {
            console.log(`Created chat for channel ${this.getChannelName()}`);
            return doc;
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
class ChatCodesSocketIOServer {
    constructor(socketIOPort, shareDBPort, shareDBURL) {
        this.socketIOPort = socketIOPort;
        this.shareDBPort = shareDBPort;
        this.shareDBURL = shareDBURL;
        this.namespaces = {};
        this.members = {};
        this.app = express();
        this.server = http.createServer(this.app);
        this.wss = new WebSocket.Server({ server: this.server });
        this.channels = new Map();
        this.setupShareDB();
        this.setupSocketIO();
        // this.server.listen(8080);
        // console.log('Express listening in 8080');
        // let urlPromise:Promise<string>;
        // if(dbURL) {
        // 	urlPromise = Promise.resolve(dbURL);
        // } else {
        // 	urlPromise = getCredentials();
        // }
        // this.clientPromise = urlPromise.then((dbURL) => {
        // 	const client = new pg.Client({
        // 		connectionString: dbURL
        // 	});
        // 	return client.connect().then(() => { return client; });
        // }).then((client) => {
        // 	return this.createTables(client);
        // }).catch((err) => {
        // 	console.error(err);
        // 	return null;
        // });
        // this.dropTables();
    }
    setupShareDB() {
        this.db = ShareDBMongo(this.shareDBURL);
        // this.sharedb = new ShareDB({ db: this.db });
        this.sharedb = new ShareDB({});
        this.wss.on('connection', (ws, req) => {
            const stream = new WebSocketJSONStream(ws);
            this.sharedb.listen(stream);
        });
        this.server.listen(this.shareDBPort);
        console.log(`Created ShareDB server on port ${this.shareDBPort}`);
    }
    setupSocketIO() {
        this.io = sio(this.socketIOPort);
        this.io.on('connection', (socket) => {
            const { id } = socket;
            socket.emit('connection-info', {
                shareDBPort: this.shareDBPort
            });
            socket.on('request-join-room', (roomName, callback) => {
                const channelServer = this.createNamespace(roomName);
                channelServer.initialize().then(() => {
                    callback();
                });
                console.log(`Client (${id}) requested to join ${roomName}`);
            });
            socket.on('channel-available', (roomName, callback) => {
                this.getMembers(roomName).then((members) => {
                    const nobodyThere = members.length === 0;
                    callback(nobodyThere);
                    console.log(`Telling (${id}) that ${roomName} is${nobodyThere ? " " : " not "}available`);
                });
                console.log(`Client (${id}) asked if ${roomName} is available`);
            });
            socket.on('ping', function (data, callback) {
                callback('pong', {
                    success: true,
                    received: data
                });
            });
            // socket.on('disconnect', () => {
            // this.clusterIfEmptyForAWhile();
            // });
            console.log(`Client connected (id: ${id})`);
        });
        console.log(`Created Socket.IO server on port ${this.socketIOPort}`);
    }
    // private getNamespace(name:string): SocketIO.Namespace {
    // 	if(!_.has(this.namespaces, name)) {
    // 		this.namespaces[name] = this.createNamespace(name);
    // 	}
    // 	return this.namespaces[name];
    // };
    shouldLogData(eventType, data) {
        if (eventType === 'typing' || eventType === 'cursor-event') {
            return false;
        }
        else {
            return true;
        }
    }
    ;
    createNamespace(channelName) {
        let channelPromise;
        if (!this.channels.has(channelName)) {
            const channelServer = new ChatCodesChannelServer(this.sharedb, this.wss, channelName, this.io);
            this.channels.set(channelName, channelServer);
            channelPromise = channelServer.initialize();
        }
        else {
            channelPromise = Promise.resolve(true);
        }
        const channelServer = this.channels.get(channelName);
        return channelServer;
        // channelServer.addMember(target);
        //
        // channelPromise.then(() => {
        // 	respond({
        // 		channel
        // 	});
        // });
        // const ns = this.io.of(`/${channelName}`);
        //
        // // const dbChannelID:Promise<number> = this.clientPromise.then((client) => {
        // // 	console.log(`DB: Insert ${channelName} into channels`);
        // // 	return client.query(`INSERT INTO channels (name, created) VALUES ($1::text, now()) RETURNING id`, [channelName]);
        // // }).then((res) => {
        // // 	return res.rows[0].id;
        // // });
        //
        // ns.on('connection', (s) => {
        // 	const {id} = s;
        // 	let dbid:number;
        // 	const member = {
        // 		id: id,
        // 		joined: (new Date()).getTime(),
        // 		left: -1,
        // 		info: {
        // 			name: null
        // 		}
        // 	};
        // 	this.members[id] = member;
        //
        // 	s.on('set-username', (username:string, callback) => {
        // 		// member.info.name = username;
        // 		//
        // 		// let client:pg.Client;
        // 		// let channelID:number;
        // 		// Promise.all([dbChannelID, this.clientPromise]).then((result) => {
        // 		// 	channelID = result[0];
        // 		// 	client = result[1];
        // 		//
        // 		// 	console.log(`DB: Insert ${username} into users`);
        // 		// 	return client.query(`INSERT INTO users (uid, name, channel_id) VALUES ($1::text, $2::text, $3::integer) RETURNING id`, [id, username, channelID]);
        // 		// }).then((res) => {
        // 		// 	return res.rows[0].id;
        // 		// }).then((id:number) => {
        // 		// 	dbid = id;
        // 		// 	console.log(`DB: ${username} connected`);
        // 		// 	return client.query(`INSERT INTO user_connections(user_id, channel_id, time, action) VALUES ($1::integer, $2::integer, $3::timestamp, $4::text)`, [
        // 		// 			dbid, channelID, new Date(member.joined), 'connect'
        // 		// 	]);
        // 		// }).then(() => {
        // 		// 	return this.getChannelState(channelID);
        // 		// }).then((channelState) => {
        // 		// 	callback(_.extend({
        // 		// 		myID: id
        // 		// 	}, channelState));
        // 		// 	s.broadcast.emit('member-added', member);
        // 		// 	this.getChannelState(channelID);
        // 		// });
        // 		// console.log(`Client (${id} in ${channelName}) set username to ${username}`);
        // 	});
        //
        // 	s.on('data', (eventName:string, payload:any) => {
        // 		// if(eventName === 'editor-opened') {
        // 		// 	const {id, contents} = payload;
        // 		// }
        // 	});
        // 	s.on('disconnect', () => {
        // 		member.left = (new Date()).getTime();
        //
        // 		// Promise.all([dbChannelID, this.clientPromise, this.getMembers(channelName)]).then((result) => {
        // 		// 	const channelID:number = result[0];
        // 		// 	const client:pg.Client = result[1];
        // 		// 	const members = result[2];
        // 		// 	console.log(`DB: ${member.info.name} disconnected`);
        // 		// 	const queries = [
        // 		// 		client.query(`INSERT INTO user_connections(user_id, channel_id, time, action) VALUES ($1::integer, $2::integer, $3::timestamp, $4::text)`, [
        // 		// 			dbid, channelID, new Date(member.left), 'disconnect'
        // 		// 		])
        // 		// 	];
        // 		// 	if(members.length === 0) {
        // 		// 		delete this.namespaces[channelName];
        // 		// 		ns.removeAllListeners();
        // 		//
        // 		// 		console.log(`DB: Channel ${channelName} destroyed`);
        // 		// 		queries.push(client.query(`UPDATE channels SET destroyed=now() WHERE id=$1::integer`, [channelID]));
        // 		// 	}
        // 		// 	return Promise.all(queries);
        // 		// });
        // 		//
        // 		// s.broadcast.emit('member-removed', member);
        // 		// console.log(`Client (${id} in ${channelName}) disconnected`);
        // 		// s.removeAllListeners();
        // 	});
        //
        // 	s.on('get-members', (callback) => {
        // 		this.getMembers(channelName).then((clients) => {
        // 			const result = {};
        // 			_.each(clients, (id:string) => {
        // 				result[id] = this.members[id].info;
        // 			});
        // 			callback({
        // 				me: member,
        // 				myID: s.id,
        // 				members: result,
        // 				count: clients.length
        // 			});
        // 		});
        // 		console.log(`Client (${id} in ${channelName}) requested members`);
        // 	});
        // 	console.log(`Client connected to namespace ${channelName} (${id})`);
        // });
        // return ns;
    }
    getMembers(channelName) {
        return new Promise((resolve, reject) => {
            const ns = this.io.of(`/${channelName}`);
            ns.clients((err, clients) => {
                if (err) {
                    reject(err);
                }
                else {
                    resolve(clients);
                }
            });
        });
    }
    // private createTables(client):Promise<pg.Client> {
    // 	const tables = this.tables;
    // 	const queries = _.map(_.keys(tables), (tableName:string) => {
    // 		const tableInfo = tables[tableName];
    // 		const params = (tableInfo.columns).join(',\n\t');
    //
    // 		let q = client.query(`CREATE TABLE IF NOT EXISTS ${tableName} (\n\t${params}\n);`);
    //
    // 		_.each(tableInfo.indicies, (idx, name) => {
    // 			q = q.then(client.query(`CREATE INDEX IF NOT EXISTS ${name} ON ${tableName} ${idx}`));
    // 		});
    // 		if(tableInfo.cluster) {
    // 			q = q.then(client.query(`CLUSTER ${tableName} USING ${tableInfo.cluster}`));
    // 		}
    // 		return q;
    // 	});
    // 	return Promise.all(queries).then(() => {
    // 		return client;
    // 	});
    // };
    // private cluster():Promise<any> {
    // 	return this.clientPromise.then((client) => {
    // 		return client.query(`CLUSTER`);
    // 	});
    // };
    nobodyThere() {
        return new Promise((resolve, reject) => {
            if (_.keys(this.namespaces).length === 0) {
                this.io.clients((err, clients) => {
                    if (err) {
                        reject(err);
                    }
                    else {
                        resolve(clients.length === 0);
                    }
                });
            }
            else {
                resolve(false);
            }
        });
    }
    ;
}
exports.ChatCodesSocketIOServer = ChatCodesSocketIOServer;
const optionDefinitions = [
    { name: 'sioport', alias: 'p', type: Number, defaultOption: true, defaultValue: process.env['PORT'] || 3000 },
    { name: 'siodburl', alias: 'd', type: String, defaultValue: process.env['DATABASE_URL'] || false }
];
const options = commandLineArgs(optionDefinitions);
// const server = new ChatCodesSocketIOServer(options.port, options.dburl);
const server = new ChatCodesSocketIOServer(8000, 8001, 'mongodb://localhost:27017/test');
//# sourceMappingURL=socketio_server.js.map