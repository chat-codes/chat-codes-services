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
export class ChatCodesChannelServer {
	private members:Set<WebSocket> = new Set<WebSocket>();
	constructor(private sharedb, private wss, private channelName:string) {

	}
	public initialize():Promise<boolean> {
		return Promise.all([this.getShareDBChat(), this.getShareDBUsers()]).then((result) => {
			const [chat,users] = result;
			console.log(chat);
			return true;
		});
	}
	public addMember(member:WebSocket) {
		this.members.add(member);
	}
	public getChannelName():string { return this.channelName; };
	private getShareDBChat():Promise<any> {
		return new Promise((resolve, reject) => {
			const connection = this.sharedb.connect();
			const doc = connection.get(this.getChannelName(), 'chat');
			const contents = {'key1': 'value1', 'key2': 'value2'};
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

	private getShareDBDoc(id:string, contents:string):Promise<any> {
		return new Promise((resolve, reject) => {
			const connection = this.sharedb.connect();
			const doc = connection.get(this.getChannelName(), id);
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

	private getShareDBUsers():Promise<any> {
		return new Promise((resolve, reject) => {
			const connection = this.sharedb.connect();
			const doc = connection.get(this.getChannelName(), 'users');
			const contents = [];
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
}

export class ChatCodesShareDBServer {
	private db;
	private sharedb;
	private channels:Map<string, ChatCodesChannelServer> = new Map();
	private app = express();
	private server = http.createServer(this.app);
	private wss = new WebSocket.Server( { server: this.server } );
	constructor(private port:number, dbURL:string) {
		this.db = ShareDBMongo('mongodb://localhost:27017/test');
		// this.sharedb = new ShareDB({ db: this.db });
		this.sharedb = new ShareDB({});

		this.wss.on('connection', (socket) => {
			this.handleConnection(socket);
		});

		this.server.listen(port);
		console.log(`Created server on port ${port}`)
	};

	private handleConnection(socket) {
		const stream =  new WebSocketJSONStream(socket);
		this.sharedb.listen(stream);

		this.addSocketEventListener(socket, 'join-channel', (data, respond) => {
			const {target, channel} = data;
			let channelPromise;

			if(!this.channels.has(channel)) {
				const channelServer = new ChatCodesChannelServer(this.sharedb, this.wss, channel);
				this.channels.set(channel, channelServer);
				channelPromise = channelServer.initialize();
			} else {
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
	};

	private addSocketEventListener(socket, eventType, callback) {
		socket.addEventListener('message', (event) => {
			const data = JSON.parse(event.data);
			if(data.type === eventType) {
				const {responseID} = data;
				if(responseID) {
					callback(data, (responseData) => {
						socket.send(JSON.stringify(_.extend({
							responseID
						}, responseData)));
					});
				} else {
					callback(data);
				}
			}
		});
	};

	private getShareDBChannelList():Promise<any> {
		return new Promise((resolve, reject) => {
			const connection = this.sharedb.connect();
			const doc = connection.get('', 'members');
			const contents = [];
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

	destroy():void {
		this.server.close();
	};
}

const optionDefinitions = [
	{ name: 'port', alias: 'p', type: Number, defaultOption: true, defaultValue: process.env['PORT'] || 8080},
	{ name: 'dburl', alias: 'd', type: String, defaultValue: process.env['DATABASE_URL']||'mongodb://localhost:27017/test'}
];
const options = commandLineArgs(optionDefinitions);

const server = new ChatCodesShareDBServer(options.port, options.dburl);
