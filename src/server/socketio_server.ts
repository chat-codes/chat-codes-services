import * as sio from 'socket.io';
import * as _ from 'underscore';
import * as commandLineArgs from 'command-line-args';
import * as fs from 'fs';
import * as path from 'path';
import * as pg from 'pg';
import * as ShareDB from 'sharedb';
import * as ShareDBMongo from 'sharedb-mongo';
import * as ShareDBMingo from 'sharedb-mingo-memory';
import * as express from 'express';
import * as http from 'http';
import * as WebSocket from 'ws';
import * as WebSocketJSONStream from 'websocket-json-stream';
import * as otText from 'ot-text';
import * as Logger from 'js-logger';
import {EventEmitter} from 'events';

Logger.useDefaults();

ShareDB.types.map['json0'].registerSubtype(otText.type);

pg.defaults.ssl = true;

function getCredentials(filename:string=path.join(__dirname, 'db_creds.json')):Promise<string> {
	return new Promise((resolve, reject) => {
		fs.readFile(filename, 'utf-8', (err, contents) => {
			if(err) { reject(err); }
			resolve(contents);
		});
	}).then((contents:string) => {
		return JSON.parse(contents);
	});
}
export class ChatCodesChannelServer extends EventEmitter {
	private members:Set<WebSocket> = new Set<WebSocket>();
	private ns:SocketIO.Namespace;
	private chatPromise:Promise<ShareDB.Doc> = this.getShareDBChat();
	private editorsPromise:Promise<ShareDB.Doc> = this.getShareDBEditors();
	private cursorsPromise:Promise<ShareDB.Doc> = this.getShareDBCursors();
	constructor(private sharedb, private wss, private channelName:string, private io:SocketIO.Server) {
		super();
		this.ns = this.io.of(`/${channelName}`);
		this.initialize();
		Promise.all([this.subscribePromise(this.chatPromise), this.subscribePromise(this.editorsPromise)]).then((info) => {
			const chatDoc:ShareDB.Doc = info[0];
			const editorsDoc:ShareDB.Doc = info[1];

			let fromVersion:number=editorsDoc.version,
				toVersion:number=editorsDoc.version;
			let editedFiles:Set<string> = new Set();
			let editingUsers:Set<string> = new Set();

			let lastEvent:string = null;

			function createNewEditGroup() {
				console.log("Created new edit group");
				editedFiles = new Set();
				editingUsers = new Set();
				fromVersion = editorsDoc.version;
				toVersion = editorsDoc.version;
			}
			function capCurrentEditGroup() {
				console.log("CAP");
				console.log(editedFiles.values());
				console.log(editingUsers.values());
				console.log(fromVersion, toVersion);
			}

			this.on('editor-event', (info) => {
				if(lastEvent !== 'edit') {
					createNewEditGroup();
				}

				const {uid} = info;
				editingUsers.add(uid);

				lastEvent = 'edit';
			});

			chatDoc.on('op', (ops) => {
				ops.forEach((op, source) => {
					const {p, li} = op;
					if(p.length === 2 && p[0] === 'messages' && li && !source) {
						if(lastEvent !== 'chat') {
							capCurrentEditGroup();
						}
						lastEvent = 'chat';
					}
				});
			});
			editorsDoc.on('op', (ops) => {
				ops.forEach((op, source) => {
					const {p, li} = op;
					if(p.length === 3 && p[1] === 'contents') {
						if(lastEvent !== 'edit') {
							createNewEditGroup();
						} else {
							toVersion = editorsDoc.version;
						}

						editedFiles.add(editorsDoc.data[p[0]].id);
						lastEvent = 'edit'
					}
				});
			});
		});
	}
	private subscribePromise(docPromise:Promise<ShareDB.Doc>):Promise<ShareDB.Doc> {
		return docPromise.then((doc) => {
			return new Promise((resolve, reject) => {
				doc.subscribe((err) => {
					if(err) { reject(err); }
					else { resolve(doc); }
				});
			});
		});
	}
	private submitOp(doc, data, options?):Promise<ShareDB.Doc> {
		return new Promise<ShareDB.Doc>((resolve, reject) => {
			doc.submitOp(data, options, (err) => {
				if(err) { reject(err); }
				else { resolve(doc); }
			})
		});
	}
	private static NUM_COLORS:number = 4;
	private colorIndex:number = 0;
	public initialize():Promise<boolean> {
		this.ns.on('connection', (s) => {
			const {id} = s;
			let dbid:number;
			const member = {
				id: id,
				joined: this.getTimestamp(),
				left: -1,
				info: {
					typingStatus: 'IDLE',
					name: null,
					colorIndex: this.colorIndex+1
				}
			};
			this.colorIndex = (this.colorIndex+1)%ChatCodesChannelServer.NUM_COLORS;
			this.members[id] = member;

			// s.on('create-editor', (id:string, contents:string, callback) => {
			// 	this.getShareDBDoc(id, contents).then(() => {
			// 		callback('ready');
			// 	});
			// });
			s.on('data-editor-event', (info) => {
				this.emit('editor-event', info);
			});

			s.on('data-get-editors-values', (version:number, callback) => {
				return this.getEditorValues(version).then((result) => {
					console.log(result);
					callback(result.values());
				});
			});
			s.on('data-get-editors-diff', (fromVersion:number, toVersion:number, callback) => {
				return this.getEditorDiffs(fromVersion, toVersion).then((result) => {
					console.log(result);
					callback(result.values());
				});
			});

			s.on('set-username', (username:string, callback) => {
				member.info.name = username;
				Promise.all([this.chatPromise]).then((result) => {
					const chatDoc:ShareDB.Doc = result[0];
					return this.submitOp(chatDoc, [{p: ['activeUsers', id], oi: member}]);
				}).then((chatDoc:ShareDB.Doc) => {
					return this.submitOp(chatDoc, [{p: ['allUsers', id], oi: member}]);
				}).then((chatDoc:ShareDB.Doc) => {
					const userJoin = {
						uid: id,
						type: 'join',
						timestamp: this.getTimestamp()
					};
					return this.submitOp(chatDoc, [{p: ['messages', chatDoc.data['messages']['length']], li: userJoin}]);
				}).then((chatDoc:ShareDB.Doc) => {
					callback({
						myID: id
					});
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
					return this.submitOp(chatDoc, [{p: ['messages', chatDoc.data.messages.length], li: userLeft}]);
				}).then((chatDoc:ShareDB.Doc) => {
					member.left = this.getTimestamp();
					return this.submitOp(chatDoc, [{p: ['activeUsers', id], od: member}]);
				}).then(() => {
					return this.fetchDocFromPromise(this.cursorsPromise);
				}).then((cursorsDoc:ShareDB.Doc) => {
					const removeCursorsPromises = _.chain(cursorsDoc.data)
													.map((ed, i) => {
														const ucd = ed['userCursors'][id];
														const usd = ed['userSelections'][id];
														return Promise.all([this.submitOp(cursorsDoc, [{p: [i, 'userCursors', id], od: ucd}]), this.submitOp(cursorsDoc, [{p: [i, 'userSelections', id], od: ucd}])]);
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
	public ready():Promise<boolean> {
		return Promise.all([this.chatPromise]).then(([chat]) => {
			return true;
		})
	}
	public fetchDocFromPromise(docPromise:Promise<ShareDB.Doc>):Promise<ShareDB.Doc> {
		return docPromise.then((doc) => {
			return new Promise<ShareDB.Doc>((resolve, reject) => {
				doc.fetch((err) => {
					if(err) { reject(err); }
					else { resolve(doc); }
				});
			});
		});
	};

	private getTimestamp():number { return (new Date()).getTime(); };
	public addMember(member:WebSocket) {
		this.members.add(member);
	}
	public getChannelName():string { return this.channelName; };
	private getShareDBObject(docName:string, type:string, defaultContents:any):Promise<ShareDB.Doc> {
		return new Promise((resolve, reject) => {
			const connection = this.sharedb.connect();
			const doc = connection.get(this.getChannelName(), docName);
			doc.fetch((err) => {
				if(err) {
					reject(err);
				} else if(doc.type === null) {
					doc.create(defaultContents, type, () => {
						Logger.debug(`Created doc ${docName}`);
						resolve(doc);
					});
				} else {
					resolve(doc);
				}
			});
		});
	}
	private getShareDBChat():Promise<ShareDB.Doc> { return this.getShareDBObject('chat', 'json0', { 'activeUsers': {}, 'allUsers': {}, 'messages': [], }); };
	private getShareDBEditors():Promise<ShareDB.Doc> { return this.getShareDBObject('editors', 'json0', []); };
	private getShareDBCursors():Promise<ShareDB.Doc> { return this.getShareDBObject('cursors', 'json0', {}); };
	private getEditorValues(version:number):Promise<Map<string, any>> {
		let content = [];
		let editorValues:Map<string, any> = new Map<string, any>();
		const jsonType = ShareDB.types.map['json0'];

		return this.getEditorOps(0, version).then((ops) => {
			_.each(ops, (op) => {
				if(op['create']) {
					// content = _.clone(op['data']);
				} else {
					content = jsonType.apply(content, op.op);
				}
			});
			_.each(content, (editorInfo) => {
				editorValues.set(editorInfo.id, editorInfo);
			});
			return editorValues;
		});
	}
	private getEditorDiffs(fromVersion:number, toVersion:number):Promise<Map<string, any>> {
		let content = [];
		let editorFromValues:Map<string, any> = new Map<string, any>();
		let editorToValues:Map<string, any> = new Map<string, any>();
		const jsonType = ShareDB.types.map['json0'];

		return this.getEditorOps(0, fromVersion).then((ops) => {
			_.each(ops, (op) => {
				if(op['create']) {
					// content = _.clone(op['data']);
				} else {
					content = jsonType.apply(content, op.op);
				}
			});
			_.each(content, (editorInfo) => {
				editorFromValues.set(editorInfo.id, editorInfo);
			});
			return this.getEditorOps(fromVersion, toVersion);
		}).then((ops) => {
			_.each(ops, (op) => {
				if(op['create']) {
					// content = _.clone(op['data']);
				} else {
					content = jsonType.apply(content, op.op);
				}
			});
			_.each(content, (editorInfo) => {
				editorToValues.set(editorInfo.id, editorInfo);
			});

			const rv:Map<string, any> = new Map<string, any>();
			editorFromValues.forEach((editorInfo) => {
				rv.set(editorInfo.id, {
					editorID: editorInfo.id,
					fromContents: editorInfo.contents,
					toContents: ''
				});
			});
			editorToValues.forEach((editorInfo) => {
				if(rv.has(editorInfo.id)) {
					_.extend(rv.get(editorInfo.id), {
						toContents: editorInfo.contents
					})
				} else {
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
	private getEditorOps(fromVersion:number, toVersion:number, opts={}):Promise<Array<any>> {
		return new Promise<Array<any>>((resolve, reject) => {
			this.sharedb.db.getOps(this.getChannelName(), 'editors', fromVersion, toVersion, opts, (err, data) => {
				if(err) { reject(err); }
				else { resolve(data); }
			});
		});
	};
	//
	// private getShareDBDoc(id:string, contents:string):Promise<any> {
	// 	return new Promise((resolve, reject) => {
	// 		const connection = this.sharedb.connect();
	// 		const doc = connection.get(this.getChannelName(), id);
	// 		doc.fetch((err) => {
	// 			if(err) {
	// 				reject(err);
	// 			} else if(doc.type === null) {
	// 				console.log(contents==='');
	// 				doc.create(contents, 'text', () => {
	// 					resolve(doc);
	// 					console.log(`Created new editor (${id}) for channel ${this.getChannelName()}`);
	// 				});
	// 			} else {
	// 				resolve(doc);
	// 			}
	// 		});
	// 	});
	// };
}

export class ChatCodesSocketIOServer {
	private db;
	private sharedb;
	private io:SocketIO.Server;
	private namespaces:{[ns:string]: SocketIO.Namespace} = {};
	private members:{[id:string]:any} = {};
	private app = express();
	private server = http.createServer(this.app);
	private wss = new WebSocket.Server( { server: this.server } );
	private channels:Map<string, ChatCodesChannelServer> = new Map();
	constructor(private socketIOPort:number, private shareDBPort:number, private shareDBURL:string) {
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
	private setupShareDB() {
		// this.db = new ShareDBMingo();
		this.db = ShareDBMongo(this.shareDBURL);
		this.sharedb = new ShareDB({ db: this.db });

		this.wss.on('connection', (ws, req) => {
			const stream = new WebSocketJSONStream(ws);
			this.sharedb.listen(stream);
		});

		this.server.listen(this.shareDBPort);
		Logger.info(`Created ShareDB server on port ${this.shareDBPort}`)
	}
	private setupSocketIO() {
		this.io = sio(this.socketIOPort);
		this.io.on('connection', (socket:SocketIO.Socket) => {
			const {id} = socket;
			socket.emit('connection-info', {
				shareDBPort: this.shareDBPort
			});
			socket.on('request-join-room', (roomName:string, callback) => {
				const channelServer = this.createNamespace(roomName);
				channelServer.ready().then(() => {
					callback();
				});
				Logger.info(`Client (${id}) requested to join ${roomName}`);
			});
			socket.on('channel-available', (roomName:string, callback) => {
				this.getMembers(roomName).then((members) => {
					const nobodyThere:boolean = members.length === 0;
					callback(nobodyThere);
					Logger.info(`Telling (${id}) that ${roomName} is${nobodyThere?" ":" not "}available`);
				});
				Logger.info(`Client (${id}) asked if ${roomName} is available`);
			});
			socket.on('ping', function(data, callback) {
				callback('pong', {
					success: true,
					received: data
				});
			});
			// socket.on('disconnect', () => {
				// this.clusterIfEmptyForAWhile();
			// });
			Logger.info(`Client connected (id: ${id})`)
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
	private createNamespace(channelName:string):ChatCodesChannelServer {
		if(!this.channels.has(channelName)) {
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
	private getMembers(channelName:string):Promise<Array<any>> {
		return new Promise<Array<any>>((resolve, reject) => {
			const ns = this.io.of(`/${channelName}`);
			ns.clients((err, clients) => {
				if(err) { reject(err); }
				else { resolve(clients); }
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

	private nobodyThere():Promise<boolean> {
		return new Promise<boolean>((resolve, reject) => {
			if(_.keys(this.namespaces).length === 0) {
				this.io.clients((err, clients) => {
					if(err) { reject(err); }
					else { resolve(clients.length === 0); }
				});
			} else {
				resolve(false);
			}
		});
	};
	// private clusterCheck:Promise<any> = null;
	// private clusterIfEmptyForAWhile() {
	// 	if(!this.clusterCheck) {
	// 		this.clusterCheck = this.nobodyThere().then((isEmpty:boolean) => {
	// 			if(isEmpty) {
	// 				return this.wait(5);
	// 			} else {
	// 				return -1;
	// 			}
	// 		}).then((res) => {
	// 			if(res >= 0) {
	// 				return this.nobodyThere();
	// 			}
	// 			return false
	// 		}).then((stillEmpty:boolean) => {
	// 			if(stillEmpty) {
	// 				return this.cluster();
	// 			}
	// 		}).then(() => {
	// 			this.clusterCheck = null;
	// 		});
	// 	}
	// };
	// private wait(ms:number):Promise<number> {
	// 	return new Promise((resolve, reject) => {
	// 		setTimeout(() => {
	// 			resolve(ms);
	// 		}, ms);
	// 	});
	// }

	// private dropTables():Promise<pg.Client> {
	// 	const tables = this.tables;
	// 	const queries = _.map(_.keys(tables), (tableName:string) => {
	// 		return `DROP TABLE IF EXISTS ${tableName} CASCADE;`;
	// 	});
	// 	return this.clientPromise.then((client) => {
	// 		return Promise.all(_.map(queries, (q) => client.query(q) )).then(function() {
	// 			return client;
	// 		});
	// 	});
	// };
	// private getChannelState(channelID:number):Promise<any> {
	// 	return this.clientPromise.then((client) => {
	// 		const queries = [
	// 			client.query('SELECT * FROM channels WHERE id=$1::integer LIMIT 1', [channelID]),
	// 			client.query('SELECT * FROM users WHERE channel_id=$1::integer', [channelID]),
	// 			client.query('SELECT * FROM user_connections WHERE channel_id=$1::integer', [channelID]),
	// 			client.query('SELECT * FROM channel_data WHERE channel_id=$1::integer', [channelID])
	// 		];
	// 		return Promise.all(queries);
	// 	}).then((result) => {
	// 		const [channelResult, userResult, connections_result, data_result] = result;
	// 		const channelData = channelResult.rows[0];
	// 		const userMap = {};
	// 		_.each(userResult.rows, (userRow) => {
	// 			userMap[userRow.id] = {
	// 				row: userRow,
	// 				connections: []
	// 			};
	// 		});
	// 		_.each(connections_result.rows, (connectionRow) => {
	// 			const {user_id} = connectionRow;
	// 			const u = userMap[user_id];
	// 			if(u) {
	// 				u.connections.push(connectionRow);
	// 			}
	// 		});
	//
	// 		return {
	// 			data:  _.map(data_result.rows, (dataRow) => {
	// 				return {
	// 					eventName: dataRow.event_name,
	// 					payload: JSON.parse(dataRow.data)
	// 				}
	// 			}),
	// 			users: _.map(_.keys(userMap), (id) => {
	// 				const {row, connections} = userMap[id];
	// 				let joined:number = -1;
	// 				let left:number = -1;
	// 				let active:boolean = true;
	// 				_.each(connections, (c:any) => {
	// 					const {action, time} = c;
	// 					if(action === 'disconnect') {
	// 						active = false;
	// 						left = time.getTime();
	// 					} else {
	// 						joined = time.getTime();
	// 					}
	// 				});
	// 				return {
	// 					id: row.uid,
	// 					name: row.name,
	// 					joined: joined,
	// 					left: left,
	// 					active: active
	// 				};
	// 			})
	// 		};
	// 	});
	// }
	// destroy():void {
	// 	this.clientPromise.then((client) => {
	// 		client.end();
	// 	});
	// 	this.io.close();
	// }
	// private tables:{[table:string]:any} = {
	// 	'channels': {
	// 		columns: [
	// 			'id SERIAL PRIMARY KEY',
	// 			'created TIMESTAMP',
	// 			'destroyed TIMESTAMP',
	// 			'name TEXT NOT NULL'
	// 		],
	// 		indicies: {
	// 		},
	// 		cluster: false
	// 	},
	// 	'users': {
	// 		columns: [
	// 			'id SERIAL PRIMARY KEY',
	// 			'uid TEXT NOT NULL',
	// 			'channel_id INTEGER REFERENCES channels(id)',
	// 			'name TEXT NOT NULL'
	// 		],
	// 		indicies: {
	// 			'user_channel': '(channel_id)'
	// 		},
	// 		cluster: 'user_channel'
	// 	},
	// 	'user_connections': {
	// 		columns: [
	// 			'user_id INTEGER REFERENCES users(id)',
	// 			'channel_id INTEGER REFERENCES channels(id)',
	// 			'time TIMESTAMP',
	// 			'action TEXT'
	// 		],
	// 		indicies: {
	// 			'channel_conn': '(channel_id)'
	// 		},
	// 		cluster: 'channel_conn'
	// 	},
	// 	'channel_data': {
	// 		columns: [
	// 			'user_id INTEGER REFERENCES users(id)',
	// 			'channel_id INTEGER REFERENCES channels(id)',
	// 			'time TIMESTAMP',
	// 			'event_name TEXT',
	// 			'data TEXT'
	// 		],
	// 		indicies: {
	// 			'channel_dat': '(channel_id)'
	// 		},
	// 		cluster: 'channel_dat'
	// 	}
	// };
}

const optionDefinitions = [
	{ name: 'mongodb', alias: 'm', type: String, defaultValue: 'mongodb://localhost:27017/test' },
	{ name: 'sharedbport', alias: 'd', type: Number, defaultValue: 8000 },
	{ name: 'sioport', alias: 'p', type: Number,  defaultValue: 8001}
];
const options = commandLineArgs(optionDefinitions);

// const server = new ChatCodesSocketIOServer(options.port, options.dburl);
export default new ChatCodesSocketIOServer(options.sharedbport, options.sioport, options.mongodb);
