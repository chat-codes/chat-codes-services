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
const otText = require("ot-text");
const Logger = require("js-logger");
const events_1 = require("events");
Logger.useDefaults();
ShareDB.types.map['json0'].registerSubtype(otText.type);
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
class ChatCodesChannelServer extends events_1.EventEmitter {
    constructor(sharedb, wss, channelName, io) {
        super();
        this.sharedb = sharedb;
        this.wss = wss;
        this.channelName = channelName;
        this.io = io;
        this.members = new Set();
        this.chatPromise = this.getShareDBChat();
        this.editorsPromise = this.getShareDBEditors();
        this.cursorsPromise = this.getShareDBCursors();
        this.colorIndex = 0;
        this.ns = this.io.of(`/${channelName}`);
        this.initialize();
        Promise.all([this.subscribePromise(this.chatPromise), this.subscribePromise(this.editorsPromise)]).then((info) => {
            const chatDoc = info[0];
            const editorsDoc = info[1];
            let editedFiles = new Set();
            let editingUsers = new Set();
            let lastEvent = null;
            let editGroup = {};
            function createNewEditGroup() {
                editedFiles = new Set();
                editingUsers = new Set();
                editGroup = {
                    type: 'edit',
                    fromVersion: editorsDoc.version,
                    toVersion: editorsDoc.version,
                    files: [],
                    users: [],
                    fileContents: {},
                    startTimestamp: this.getTimestamp(),
                    endTimestamp: this.getTimestamp()
                };
            }
            function capCurrentEditGroup() {
                editorsDoc.data.forEach((docInfo) => {
                    const { id } = docInfo;
                    if (editedFiles.has(id)) {
                        editGroup['fileContents'][id]['to'] = docInfo.contents;
                    }
                });
                this.submitOp(chatDoc, { p: ['messages', chatDoc.data.messages.length - 1], li: editGroup, ld: _.last(chatDoc.data.messages[chatDoc]) });
            }
            this.on('editor-event', (info) => {
                if (lastEvent !== 'edit') {
                    createNewEditGroup();
                }
                const { uid } = info;
                if (!editingUsers.has(uid)) {
                    editingUsers.add(uid);
                    editGroup['users'].push(uid);
                }
                lastEvent = 'edit';
            });
            chatDoc.on('before op', (ops) => {
                ops.forEach((op, source) => {
                    const { p, li } = op;
                    if (p.length === 2 && p[0] === 'messages' && li && li.type !== 'edit' && !source) {
                        if (lastEvent !== 'chat') {
                            capCurrentEditGroup.call(this);
                        }
                        lastEvent = 'chat';
                    }
                });
            });
            editorsDoc.on('before op', (ops) => {
                ops.forEach((op, source) => {
                    const { p, li } = op;
                    if (p.length === 3 && p[1] === 'contents') {
                        const editorIndex = p[0];
                        const editorID = editorsDoc.data[editorIndex].id;
                        if (!editedFiles.has(editorID)) {
                            editedFiles.add(editorID);
                            editGroup['files'].push(editorID);
                            editGroup['fileContents'][editorID] = {
                                from: editorsDoc.data[editorIndex].contents,
                                to: false
                            };
                        }
                        if (lastEvent !== 'edit') {
                            createNewEditGroup();
                            this.submitOp(chatDoc, { p: ['messages', chatDoc.data.messages.length], li: editGroup }, { source: true });
                        }
                        else {
                            editGroup['toVersion'] = editorsDoc.version;
                            editGroup['endTimestamp'] = this.getTimestamp();
                            this.submitOp(chatDoc, { p: ['messages', chatDoc.data.messages.length - 1], li: editGroup, ld: _.last(chatDoc.data.messages[chatDoc]) }, { source: true });
                        }
                        lastEvent = 'edit';
                    }
                });
            });
        }).catch((e) => {
            console.error(e.stack);
        });
    }
    subscribePromise(docPromise) {
        return docPromise.then((doc) => {
            return new Promise((resolve, reject) => {
                doc.subscribe((err) => {
                    if (err) {
                        reject(err);
                    }
                    else {
                        resolve(doc);
                    }
                });
            });
        });
    }
    submitOp(doc, data, options) {
        return new Promise((resolve, reject) => {
            doc.submitOp(data, options, (err) => {
                if (err) {
                    reject(err);
                }
                else {
                    resolve(doc);
                }
            });
        });
    }
    initialize() {
        this.ns.on('connection', (s) => {
            const { id } = s;
            let dbid;
            const member = {
                id: id,
                joined: this.getTimestamp(),
                left: -1,
                info: {
                    typingStatus: 'IDLE',
                    name: null,
                    colorIndex: this.colorIndex + 1
                }
            };
            this.colorIndex = (this.colorIndex + 1) % ChatCodesChannelServer.NUM_COLORS;
            this.members[id] = member;
            // s.on('create-editor', (id:string, contents:string, callback) => {
            // 	this.getShareDBDoc(id, contents).then(() => {
            // 		callback('ready');
            // 	});
            // });
            s.on('data-editor-event', (info) => {
                this.emit('editor-event', info);
            });
            s.on('data-get-editors-values', (version, callback) => {
                return this.getEditorValues(version).then((result) => {
                    console.log(result);
                    callback(result.values());
                });
            });
            s.on('data-get-editors-diff', (fromVersion, toVersion, callback) => {
                return this.getEditorDiffs(fromVersion, toVersion).then((result) => {
                    console.log(result);
                    callback(result.values());
                });
            });
            s.on('set-username', (username, callback) => {
                member.info.name = username;
                Promise.all([this.chatPromise]).then((result) => {
                    const chatDoc = result[0];
                    return this.submitOp(chatDoc, [{ p: ['activeUsers', id], oi: member }]);
                }).then((chatDoc) => {
                    return this.submitOp(chatDoc, [{ p: ['allUsers', id], oi: member }]);
                }).then((chatDoc) => {
                    const userJoin = {
                        uid: id,
                        type: 'join',
                        timestamp: this.getTimestamp()
                    };
                    return this.submitOp(chatDoc, [{ p: ['messages', chatDoc.data['messages']['length']], li: userJoin }]);
                }).then((chatDoc) => {
                    callback({
                        myID: id
                    });
                }).catch((err) => {
                    console.error(err);
                });
                Logger.info(`Client (${id} in ${this.getChannelName()}) set username to ${username}`);
            });
            s.on('disconnect', () => {
                const timestamp = this.getTimestamp();
                Promise.all([this.chatPromise]).then(([chatDoc]) => {
                    const userLeft = {
                        uid: id,
                        type: 'left',
                        timestamp: timestamp
                    };
                    return this.submitOp(chatDoc, [{ p: ['messages', chatDoc.data.messages.length], li: userLeft }]);
                }).then((chatDoc) => {
                    member.left = this.getTimestamp();
                    return this.submitOp(chatDoc, [{ p: ['activeUsers', id], od: member }]);
                }).then(() => {
                    return this.fetchDocFromPromise(this.cursorsPromise);
                }).then((cursorsDoc) => {
                    const removeCursorsPromises = _.chain(cursorsDoc.data)
                        .map((ed, i) => {
                        const ucd = ed['userCursors'][id];
                        const usd = ed['userSelections'][id];
                        return Promise.all([this.submitOp(cursorsDoc, [{ p: [i, 'userCursors', id], od: ucd }]), this.submitOp(cursorsDoc, [{ p: [i, 'userSelections', id], od: ucd }])]);
                    })
                        .flatten(true)
                        .value();
                    return Promise.all(removeCursorsPromises);
                });
                Logger.info(`Client (${id} in ${this.getChannelName()}) disconnected`);
            });
            Logger.info(`Client connected to namespace ${this.getChannelName()} (${id})`);
        });
        return Promise.all([this.chatPromise]).then(([chatDoc]) => {
            return true;
        });
    }
    ready() {
        return Promise.all([this.chatPromise]).then(([chat]) => {
            return true;
        });
    }
    fetchDocFromPromise(docPromise) {
        return docPromise.then((doc) => {
            return new Promise((resolve, reject) => {
                doc.fetch((err) => {
                    if (err) {
                        reject(err);
                    }
                    else {
                        resolve(doc);
                    }
                });
            });
        });
    }
    ;
    getTimestamp() { return (new Date()).getTime(); }
    ;
    addMember(member) {
        this.members.add(member);
    }
    getChannelName() { return this.channelName; }
    ;
    getShareDBObject(docName, type, defaultContents) {
        return new Promise((resolve, reject) => {
            const connection = this.sharedb.connect();
            const doc = connection.get(this.getChannelName(), docName);
            doc.fetch((err) => {
                if (err) {
                    reject(err);
                }
                else if (doc.type === null) {
                    doc.create(defaultContents, type, () => {
                        Logger.debug(`Created doc ${docName}`);
                        resolve(doc);
                    });
                }
                else {
                    resolve(doc);
                }
            });
        });
    }
    getShareDBChat() { return this.getShareDBObject('chat', 'json0', { 'activeUsers': {}, 'allUsers': {}, 'messages': [], }); }
    ;
    getShareDBEditors() { return this.getShareDBObject('editors', 'json0', []); }
    ;
    getShareDBCursors() { return this.getShareDBObject('cursors', 'json0', {}); }
    ;
    getEditorValues(version) {
        let content = [];
        let editorValues = new Map();
        const jsonType = ShareDB.types.map['json0'];
        return this.getEditorOps(0, version).then((ops) => {
            _.each(ops, (op) => {
                if (op['create']) {
                    // content = _.clone(op['data']);
                }
                else {
                    content = jsonType.apply(content, op.op);
                }
            });
            _.each(content, (editorInfo) => {
                editorValues.set(editorInfo.id, editorInfo);
            });
            return editorValues;
        });
    }
    getEditorDiffs(fromVersion, toVersion) {
        let content = [];
        let editorFromValues = new Map();
        let editorToValues = new Map();
        const jsonType = ShareDB.types.map['json0'];
        return this.getEditorOps(0, fromVersion).then((ops) => {
            _.each(ops, (op) => {
                if (op['create']) {
                    // content = _.clone(op['data']);
                }
                else {
                    content = jsonType.apply(content, op.op);
                }
            });
            _.each(content, (editorInfo) => {
                editorFromValues.set(editorInfo.id, editorInfo);
            });
            return this.getEditorOps(fromVersion, toVersion);
        }).then((ops) => {
            _.each(ops, (op) => {
                if (op['create']) {
                    // content = _.clone(op['data']);
                }
                else {
                    content = jsonType.apply(content, op.op);
                }
            });
            _.each(content, (editorInfo) => {
                editorToValues.set(editorInfo.id, editorInfo);
            });
            const rv = new Map();
            editorFromValues.forEach((editorInfo) => {
                rv.set(editorInfo.id, {
                    editorID: editorInfo.id,
                    fromContents: editorInfo.contents,
                    toContents: ''
                });
            });
            editorToValues.forEach((editorInfo) => {
                if (rv.has(editorInfo.id)) {
                    _.extend(rv.get(editorInfo.id), {
                        toContents: editorInfo.contents
                    });
                }
                else {
                    rv.set(editorInfo.id, {
                        editorID: editorInfo.id,
                        fromContents: '',
                        toContents: editorInfo.contents
                    });
                }
            });
            return rv;
        });
    }
    getEditorOps(fromVersion, toVersion, opts = {}) {
        return new Promise((resolve, reject) => {
            this.sharedb.db.getOps(this.getChannelName(), 'editors', fromVersion, toVersion, opts, (err, data) => {
                if (err) {
                    reject(err);
                }
                else {
                    resolve(data);
                }
            });
        });
    }
    ;
}
ChatCodesChannelServer.NUM_COLORS = 4;
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
        // this.db = new ShareDBMingo();
        this.db = ShareDBMongo(this.shareDBURL);
        this.sharedb = new ShareDB({ db: this.db });
        this.wss.on('connection', (ws, req) => {
            const stream = new WebSocketJSONStream(ws);
            this.sharedb.listen(stream);
        });
        this.server.listen(this.shareDBPort);
        Logger.info(`Created ShareDB server on port ${this.shareDBPort}`);
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
                channelServer.ready().then(() => {
                    callback();
                });
                Logger.info(`Client (${id}) requested to join ${roomName}`);
            });
            socket.on('channel-available', (roomName, callback) => {
                this.getMembers(roomName).then((members) => {
                    const nobodyThere = members.length === 0;
                    callback(nobodyThere);
                    Logger.info(`Telling (${id}) that ${roomName} is${nobodyThere ? " " : " not "}available`);
                });
                Logger.info(`Client (${id}) asked if ${roomName} is available`);
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
            Logger.info(`Client connected (id: ${id})`);
        });
        Logger.info(`Created Socket.IO server on port ${this.socketIOPort}`);
    }
    // private getNamespace(name:string): SocketIO.Namespace {
    // 	if(!_.has(this.namespaces, name)) {
    // 		this.namespaces[name] = this.createNamespace(name);
    // 	}
    // 	return this.namespaces[name];
    // };
    // private shouldLogData(eventType:string, data:any):boolean {
    // 	if(eventType === 'typing' || eventType === 'cursor-event') {
    // 		return false;
    // 	}  else {
    // 		return true;
    // 	}
    // };
    createNamespace(channelName) {
        if (!this.channels.has(channelName)) {
            const channelServer = new ChatCodesChannelServer(this.sharedb, this.wss, channelName, this.io);
            this.channels.set(channelName, channelServer);
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
    { name: 'mongodb', alias: 'm', type: String, defaultValue: 'mongodb://localhost:27017/test' },
    { name: 'sharedbport', alias: 'd', type: Number, defaultValue: 8000 },
    { name: 'sioport', alias: 'p', type: Number, defaultValue: 8001 }
];
const options = commandLineArgs(optionDefinitions);
// const server = new ChatCodesSocketIOServer(options.port, options.dburl);
exports.default = new ChatCodesSocketIOServer(options.sharedbport, options.sioport, options.mongodb);
//# sourceMappingURL=socketio_server.js.map