import * as sio from 'socket.io';
import * as _ from 'underscore';
import * as commandLineArgs from 'command-line-args';
import * as fs from 'fs';
import * as path from 'path';
import * as pg from 'pg';

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
	private io:SocketIO.Server;
	private namespaces:{[ns:string]: SocketIO.Namespace} = {};
	private members:{[id:string]:any} = {};
	private clientPromise:Promise<pg.Client>;
	constructor(private port:number, dbURL:string) {
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
	}
	private createNamespace(name:string):SocketIO.Namespace {
		const ns = this.io.of(`/${name}`);

		const dbChannelID:Promise<number> = this.clientPromise.then((client) => {
			console.log(`DB: Insert ${name} into channels`);
			return client.query(`INSERT INTO channels (name, created) VALUES ($1::text, now()) RETURNING id`, [name]);
		}).then((res) => {
			return res.rows[0].id;
		});

		ns.on('connection', (s) => {
			const {id} = s;
			let dbid:number;
			const member = {
				id: id,
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
					return client.query(`INSERT INTO user_connections(user_id, channel_id, time, action) VALUES ($1::integer, $2::integer, now(), $3::text)`, [
							dbid, channelID, 'connect'
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
				console.log(`Client (${id} in ${name}) set username to ${username}`);
			});

			s.on('data', (eventName:string, payload:any) => {
				if(this.shouldLogData(eventName, payload)) {
					Promise.all([dbChannelID, this.clientPromise]).then((result) => {
						const channelID:number = result[0];
						const client:pg.Client = result[1];

						return client.query(`INSERT INTO channel_data (user_id, channel_id, time, data, event_name) VALUES ($1::integer, $2::integer, now(), $3::text, $4::text)`, [dbid, channelID, JSON.stringify(payload), eventName]);
					});
				}
				s.broadcast.emit(`data-${eventName}`, payload);
			});
			s.on('disconnect', () => {
				Promise.all([dbChannelID, this.clientPromise, this.getMembers(name)]).then((result) => {
					const channelID:number = result[0];
					const client:pg.Client = result[1];
					const members = result[2];
					console.log(`DB: ${member.info.name} disconnected`);
					const queries = [
						client.query(`INSERT INTO user_connections(user_id, channel_id, time, action) VALUES ($1::integer, $2::integer, now(), $3::text)`, [
							dbid, channelID, 'disconnect'
						])
					];
					if(members.length === 0) {
						delete this.namespaces[name];
						ns.removeAllListeners();

						console.log(`DB: Channel ${name} destroyed`);
						queries.push(client.query(`UPDATE channels SET destroyed=now() WHERE id=$1::integer`, [channelID]));
					}
					return Promise.all(queries);
				});

				s.broadcast.emit('member-removed', member);
				console.log(`Client (${id} in ${name}) disconnected`);
				s.removeAllListeners();
			});

			s.on('get-members', (callback) => {
				this.getMembers(name).then((clients) => {
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
				console.log(`Client (${id} in ${name}) requested members`);
			});
			console.log(`Client connected to namespace ${name} (${id})`);
		});
		return ns;
	}
	private getMembers(name:string):Promise<Array<any>> {
		return new Promise<Array<any>>((resolve, reject) => {
			const ns = this.io.of(`/${name}`);
			ns.clients((err, clients) => {
				if(err) { reject(err); }
				else { resolve(clients); }
			});
		});
	}
	private createTables(client):Promise<pg.Client> {
		const tables = this.tables;
		const queries = _.map(_.keys(tables), (tableName:string) => {
			const params = (tables[tableName]).join(',\n\t');
			return `CREATE TABLE IF NOT EXISTS ${tableName} (\n\t${params}\n);`;
		});
		return Promise.all(_.map(queries, (q) => client.query(q) )).then(function() {
			return client;
		});
	};
	private dropTables():Promise<pg.Client> {
		const tables = this.tables;
		const queries = _.map(_.keys(tables), (tableName:string) => {
			const params = (tables[tableName]).join(',\n\t');
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
					return {
						id: row.uid,
						name: row.name,
						active: !_.some(connections, (c) => c['action']==='disconnect')
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
	private tables:{[table:string]:Array<string>} = {
		'channels': [
			'id SERIAL PRIMARY KEY',
			'created TIMESTAMP',
			'destroyed TIMESTAMP',
			'name TEXT NOT NULL'
		],
		'users': [
			'id SERIAL PRIMARY KEY',
			'uid TEXT NOT NULL',
			'channel_id INTEGER REFERENCES channels(id)',
			'name TEXT NOT NULL'
		],
		'user_connections': [
			'user_id INTEGER REFERENCES users(id)',
			'channel_id INTEGER REFERENCES channels(id)',
			'time TIMESTAMP',
			'action TEXT'
		],
		'channel_data': [
			'user_id INTEGER REFERENCES users(id)',
			'channel_id INTEGER REFERENCES channels(id)',
			'time TIMESTAMP',
			'event_name TEXT',
			'data TEXT'
		]
	};
}

const optionDefinitions = [
	{ name: 'port', alias: 'p', type: Number, defaultOption: true, defaultValue: process.env['PORT'] || 3000},
	{ name: 'dburl', alias: 'd', type: String, defaultValue: process.env['DATABASE_URL']||false }
];
const options = commandLineArgs(optionDefinitions);

const server = new ChatCodesSocketIOServer(options.port, options.dburl);
