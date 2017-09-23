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

export class ChatCodesShareDBServer {
	private db;
	private sharedb;
	private app = express();
	private server = http.createServer(this.app);
	private wss = new WebSocket.Server( { server: this.server } );
	constructor(private port:number, dbURL:string) {
		this.db = ShareDBMongo('mongodb://localhost:27017/test');
		this.sharedb = new ShareDB({ db: this.db });

		this.wss.on('connection', (socket) => {
			this.handleConnection(socket);
		});

		this.server.listen(port);
		console.log(`Created server on port ${port}`)
	};

	private handleConnection(socket) {

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

	private getShareDBUserList(channelName:string):Promise<any> {
		return new Promise((resolve, reject) => {
			const connection = this.sharedb.connect();
			const doc = connection.get(channelName, 'members');
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

	private getShareDBDoc(channelName:string, id:string, contents:string):Promise<any> {
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
