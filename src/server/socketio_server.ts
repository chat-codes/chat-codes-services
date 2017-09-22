import * as sio from 'socket.io';
import * as _ from 'underscore';
import * as commandLineArgs from 'command-line-args';
import * as fs from 'fs';
import * as path from 'path';
import * as pg from 'pg';
import * as ShareDB from 'sharedb';
import * as ShareDBMongo from 'sharedb-mongo';
import * as express from 'express';
import * as http from 'http';
import * as WebSocket from 'ws';
import * as WebSocketJSONStream from 'websocket-json-stream';

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

export class ChatCodesSocketIOServer {
	private db = ShareDBMongo('mongodb://localhost:27017/test');
	private sharedb = new ShareDB({ db: this.db });
	private io:SocketIO.Server;
	private namespaces:{[ns:string]: SocketIO.Namespace} = {};
	private members:{[id:string]:any} = {};
	private clientPromise:Promise<pg.Client>;
	private app = express();
	private server = http.createServer(this.app);
	private wss = new WebSocket.Server( { server: this.server } );
	constructor(private port:number, dbURL:string) {
		this.server.listen(8080);
		console.log('Express listening in 8080');
		let urlPromise:Promise<string>;
		if(dbURL) {
			urlPromise = Promise.resolve(dbURL);
		} else {
			urlPromise = getCredentials();
		}
		this.clientPromise = urlPromise.then((dbURL) => {
			const client = new pg.Client({
				connectionString: dbURL
			});
			return client.connect().then(() => { return client; });
		}).then((client) => {
			return this.createTables(client);
		}).catch((err) => {
			console.error(err);
			return null;
		});
		// this.dropTables();

		this.io = sio(this.port);
		this.io.on('connection', (socket:SocketIO.Socket) => {
			const {id} = socket;
			socket.on('request-join-room', (roomName:string, callback) => {
				this.getNamespace(roomName);
				callback();
				console.log(`Client (${id}) requested to join ${roomName}`);
			});
			socket.on('channel-available', (roomName:string, callback) => {
				this.getMembers(roomName).then((members) => {
					const nobodyThere:boolean = members.length === 0;
					callback(nobodyThere);
					console.log(`Telling (${id}) that ${roomName} is${nobodyThere?" ":" not "}available`);
				});
				console.log(`Client (${id}) asked if ${roomName} is available`);
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
			console.log(`Client connected (id: ${id})`)
		});

		console.log(`Created server on port ${port}`)
	}
	private getNamespace(name:string): SocketIO.Namespace {
		if(!_.has(this.namespaces, name)) {
			this.namespaces[name] = this.createNamespace(name);
		}
		return this.namespaces[name];
	};
	private shouldLogData(eventType:string, data:any):boolean {
		if(eventType === 'typing' || eventType === 'cursor-event') {
			return false;
		}  else {
			return true;
		}
	};
	private createShareDBDoc(channelName:string, id:string, contents:string):Promise<any> {
		return new Promise((resolve, reject) => {
			const connection = this.sharedb.connect();
			const doc = connection.get(channelName, id);
			doc.fetch((err) => {
				if(err) {
					reject(err);
				} else if(doc.type === null) {
					doc.create(contents, () => {
						resolve(doc);
					});
				} else {
					resolve(doc);
				}
			});
		});
	};
	private createNamespace(channelName:string):SocketIO.Namespace {
		const ns = this.io.of(`/${channelName}`);

		const dbChannelID:Promise<number> = this.clientPromise.then((client) => {
			console.log(`DB: Insert ${channelName} into channels`);
			return client.query(`INSERT INTO channels (name, created) VALUES ($1::text, now()) RETURNING id`, [channelName]);
		}).then((res) => {
			return res.rows[0].id;
		});

		ns.on('connection', (s) => {
			const {id} = s;
			let dbid:number;
			const member = {
				id: id,
				joined: (new Date()).getTime(),
				left: -1,
				info: {
					name: null
				}
			};
			this.members[id] = member;

			s.on('set-username', (username:string, callback) => {
				member.info.name = username;

				let client:pg.Client;
				let channelID:number;
				Promise.all([dbChannelID, this.clientPromise]).then((result) => {
					channelID = result[0];
					client = result[1];

					console.log(`DB: Insert ${username} into users`);
					return client.query(`INSERT INTO users (uid, name, channel_id) VALUES ($1::text, $2::text, $3::integer) RETURNING id`, [id, username, channelID]);
				}).then((res) => {
					return res.rows[0].id;
				}).then((id:number) => {
					dbid = id;
					console.log(`DB: ${username} connected`);
					return client.query(`INSERT INTO user_connections(user_id, channel_id, time, action) VALUES ($1::integer, $2::integer, $3::timestamp, $4::text)`, [
							dbid, channelID, new Date(member.joined), 'connect'
					]);
				}).then(() => {
					return this.getChannelState(channelID);
				}).then((channelState) => {
					callback(_.extend({
						myID: id
					}, channelState));
					s.broadcast.emit('member-added', member);
					this.getChannelState(channelID);
				});
				console.log(`Client (${id} in ${channelName}) set username to ${username}`);
			});

			s.on('data', (eventName:string, payload:any) => {
				if(eventName === 'editor-opened') {
					const {id, contents} = payload;
					this.createShareDBDoc(channelName, id, contents).then((doc) => {
						console.log("DOC");
					});
				}
	//
	// private createShareDBDoc(channelName:string, id:string, contents:string):Promise<any> {
	// 			if(this.shouldLogData(eventName, payload)) {
	// 				Promise.all([dbChannelID, this.clientPromise]).then((result) => {
	// 					const channelID:number = result[0];
	// 					const client:pg.Client = result[1];
	//
	// 					return client.query(`INSERT INTO channel_data (user_id, channel_id, time, data, event_name) VALUES ($1::integer, $2::integer, now(), $3::text, $4::text)`, [dbid, channelID, JSON.stringify(payload), eventName]);
	// 				});
	// 			}
	// 			s.broadcast.emit(`data-${eventName}`, payload);
			});
			s.on('disconnect', () => {
				member.left = (new Date()).getTime();

				Promise.all([dbChannelID, this.clientPromise, this.getMembers(channelName)]).then((result) => {
					const channelID:number = result[0];
					const client:pg.Client = result[1];
					const members = result[2];
					console.log(`DB: ${member.info.name} disconnected`);
					const queries = [
						client.query(`INSERT INTO user_connections(user_id, channel_id, time, action) VALUES ($1::integer, $2::integer, $3::timestamp, $4::text)`, [
							dbid, channelID, new Date(member.left), 'disconnect'
						])
					];
					if(members.length === 0) {
						delete this.namespaces[channelName];
						ns.removeAllListeners();

						console.log(`DB: Channel ${channelName} destroyed`);
						queries.push(client.query(`UPDATE channels SET destroyed=now() WHERE id=$1::integer`, [channelID]));
					}
					return Promise.all(queries);
				});

				s.broadcast.emit('member-removed', member);
				console.log(`Client (${id} in ${channelName}) disconnected`);
				s.removeAllListeners();
			});

			s.on('get-members', (callback) => {
				this.getMembers(channelName).then((clients) => {
					const result = {};
					_.each(clients, (id:string) => {
						result[id] = this.members[id].info;
					});
					callback({
						me: member,
						myID: s.id,
						members: result,
						count: clients.length
					});
				});
				console.log(`Client (${id} in ${channelName}) requested members`);
			});
			console.log(`Client connected to namespace ${channelName} (${id})`);
		});
		return ns;
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
	private createTables(client):Promise<pg.Client> {
		const tables = this.tables;
		const queries = _.map(_.keys(tables), (tableName:string) => {
			const tableInfo = tables[tableName];
			const params = (tableInfo.columns).join(',\n\t');

			let q = client.query(`CREATE TABLE IF NOT EXISTS ${tableName} (\n\t${params}\n);`);

			_.each(tableInfo.indicies, (idx, name) => {
				q = q.then(client.query(`CREATE INDEX IF NOT EXISTS ${name} ON ${tableName} ${idx}`));
			});
			if(tableInfo.cluster) {
				q = q.then(client.query(`CLUSTER ${tableName} USING ${tableInfo.cluster}`));
			}
			return q;
		});
		return Promise.all(queries).then(() => {
			return client;
		});
	};
	private cluster():Promise<any> {
		return this.clientPromise.then((client) => {
			return client.query(`CLUSTER`);
		});
	};

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
	private clusterCheck:Promise<any> = null;
	private clusterIfEmptyForAWhile() {
		if(!this.clusterCheck) {
			this.clusterCheck = this.nobodyThere().then((isEmpty:boolean) => {
				if(isEmpty) {
					return this.wait(5);
				} else {
					return -1;
				}
			}).then((res) => {
				if(res >= 0) {
					return this.nobodyThere();
				}
				return false
			}).then((stillEmpty:boolean) => {
				if(stillEmpty) {
					return this.cluster();
				}
			}).then(() => {
				this.clusterCheck = null;
			});
		}
	};
	private wait(ms:number):Promise<number> {
		return new Promise((resolve, reject) => {
			setTimeout(() => {
				resolve(ms);
			}, ms);
		});
	}

	private dropTables():Promise<pg.Client> {
		const tables = this.tables;
		const queries = _.map(_.keys(tables), (tableName:string) => {
			return `DROP TABLE IF EXISTS ${tableName} CASCADE;`;
		});
		return this.clientPromise.then((client) => {
			return Promise.all(_.map(queries, (q) => client.query(q) )).then(function() {
				return client;
			});
		});
	};
	private getChannelState(channelID:number):Promise<any> {
		return this.clientPromise.then((client) => {
			const queries = [
				client.query('SELECT * FROM channels WHERE id=$1::integer LIMIT 1', [channelID]),
				client.query('SELECT * FROM users WHERE channel_id=$1::integer', [channelID]),
				client.query('SELECT * FROM user_connections WHERE channel_id=$1::integer', [channelID]),
				client.query('SELECT * FROM channel_data WHERE channel_id=$1::integer', [channelID])
			];
			return Promise.all(queries);
		}).then((result) => {
			const [channelResult, userResult, connections_result, data_result] = result;
			const channelData = channelResult.rows[0];
			const userMap = {};
			_.each(userResult.rows, (userRow) => {
				userMap[userRow.id] = {
					row: userRow,
					connections: []
				};
			});
			_.each(connections_result.rows, (connectionRow) => {
				const {user_id} = connectionRow;
				const u = userMap[user_id];
				if(u) {
					u.connections.push(connectionRow);
				}
			});

			return {
				data:  _.map(data_result.rows, (dataRow) => {
					return {
						eventName: dataRow.event_name,
						payload: JSON.parse(dataRow.data)
					}
				}),
				users: _.map(_.keys(userMap), (id) => {
					const {row, connections} = userMap[id];
					let joined:number = -1;
					let left:number = -1;
					let active:boolean = true;
					_.each(connections, (c:any) => {
						const {action, time} = c;
						if(action === 'disconnect') {
							active = false;
							left = time.getTime();
						} else {
							joined = time.getTime();
						}
					});
					return {
						id: row.uid,
						name: row.name,
						joined: joined,
						left: left,
						active: active
					};
				})
			};
		});
	}
	destroy():void {
		this.clientPromise.then((client) => {
			client.end();
		});
		this.io.close();
	}
	private tables:{[table:string]:any} = {
		'channels': {
			columns: [
				'id SERIAL PRIMARY KEY',
				'created TIMESTAMP',
				'destroyed TIMESTAMP',
				'name TEXT NOT NULL'
			],
			indicies: {
			},
			cluster: false
		},
		'users': {
			columns: [
				'id SERIAL PRIMARY KEY',
				'uid TEXT NOT NULL',
				'channel_id INTEGER REFERENCES channels(id)',
				'name TEXT NOT NULL'
			],
			indicies: {
				'user_channel': '(channel_id)'
			},
			cluster: 'user_channel'
		},
		'user_connections': {
			columns: [
				'user_id INTEGER REFERENCES users(id)',
				'channel_id INTEGER REFERENCES channels(id)',
				'time TIMESTAMP',
				'action TEXT'
			],
			indicies: {
				'channel_conn': '(channel_id)'
			},
			cluster: 'channel_conn'
		},
		'channel_data': {
			columns: [
				'user_id INTEGER REFERENCES users(id)',
				'channel_id INTEGER REFERENCES channels(id)',
				'time TIMESTAMP',
				'event_name TEXT',
				'data TEXT'
			],
			indicies: {
				'channel_dat': '(channel_id)'
			},
			cluster: 'channel_dat'
		}
	};
}

const optionDefinitions = [
	{ name: 'port', alias: 'p', type: Number, defaultOption: true, defaultValue: process.env['PORT'] || 3000},
	{ name: 'dburl', alias: 'd', type: String, defaultValue: process.env['DATABASE_URL']||false }
];
const options = commandLineArgs(optionDefinitions);

const server = new ChatCodesSocketIOServer(options.port, options.dburl);
