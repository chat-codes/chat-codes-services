import * as sio from 'socket.io';
import * as _ from 'underscore';
import * as commandLineArgs from 'command-line-args';
import * as fs from 'fs';
import * as path from 'path';
import * as warehouse from 'warehousejs';
import * as SqlBackend from 'warehousejs/backend/sql';

function getCredentials(filename:string=path.join(__dirname, 'db_creds.json')):Promise<any> {
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
	private backendPromise:Promise<any>;
	constructor(private port:number) {
		this.backendPromise = getCredentials().then((creds) => {
			const warehouseOptions = {
				driver: 'pg',
				host: creds.host,
				port: creds.port,
				database: creds.database,
				user: creds.user,
				password: creds.password
			};
			const backend = new SqlBackend(warehouseOptions);
			return backend;
		});

		this.io = sio(this.port);
		this.io.on('connection', (socket:SocketIO.Socket) => {
			const {id} = socket;
			socket.on('request-join-room', (roomName:string, callback) => {
				const ns = this.getNamespace(roomName);
				callback();
				console.log(`Client (${id}) requested to join ${roomName}`);
			});
			socket.on('channel-available', (roomName:string, callback) => {
				const ns = this.getNamespace(roomName);
				ns.clients((err, clients) => {
					if(err) { console.error(err); }
					callback(clients.length === 0);
					console.log(`Telling (${id}) that ${roomName} is${clients.length===0?" ":" not "}available`);
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
	public getNamespace(name:string):SocketIO.Namespace {
		if(_.has(this.namespaces, name)) {
			return this.namespaces[name];
		} else {
			const ns = this.io.of(`/${name}`);
			ns.on('connection', (s) => {
				const {id} = s;
				const member = {
					id: id,
					info: {
						name: null
					}
				};
				this.members[id] = member;

				s.on('set-username', (username:string, callback) => {
					member.info.name = username;

					this.backendPromise.then((backend) => {
						const memberStore = backend.objectStore('users');
						memberStore.add({id: id, channel: name,  name: username});

						const connectionStore = backend.objectStore('connections');
						connectionStore.add({id: id, channel: name, event: 'connect', timestamp: (new Date()).getTime() });

						const channelsStore = backend.objectStore('channels');
						connectionStore.add({ channel: name, timestamp: (new Date()).getTime() });
					});

					callback();
					s.broadcast.emit('member-added', member);
					console.log(`Client (${id} in ${name}) set username to ${username}`);
				});

				s.on('data', (eventName:string, payload:any) => {
					this.backendPromise.then((backend) => {
						const dataStore = backend.objectStore('data');
						console.log(dataStore);
						dataStore.add({user_id: id, event: eventName, data: JSON.stringify(payload)}).then(function(result) { console.log(result); })
     .fail(function(error) { console.log(error); });;
					});
					s.broadcast.emit(`data-${eventName}`, payload);
				});
				s.on('disconnect', () => {
					Promise.all([this.backendPromise, this.getMembers(name)]).then((result) => {
						const backend = result[0];
						const members = result[1];

						const connectionStore = backend.objectStore('connections');
						connectionStore.add({id: id, event: 'disconnect', timestamp: (new Date()).getTime() });
					});

					s.broadcast.emit('member-removed', member);
					console.log(`Client (${id} in ${name}) disconnected`);
				});

				s.on('get-members', (callback) => {
					this.getMembers(name).then((members) => {
						const ids = _.keys(members);
						callback({
							me: member,
							myID: s.id,
							members: members,
							count: ids.length
						});
					});
					console.log(`Client (${id} in ${name}) requested members`);
				});
				console.log(`Client connected to namespace ${name} (${id})`);
			});
			this.namespaces[name] = ns;
			return this.namespaces[name];
		}
	}
	private getMembers(channelName:string):Promise<any> {
		const ns = this.getNamespace(channelName);
		return new Promise<any>((resolve, reject) => {
			ns.clients((err, clients) => {
				if(err) { console.error(err); }
				const result = {};
				_.each(clients, (id:string) => {
					result[id] = this.members[id].info;
				});
				resolve(result);
			});
		});
	}
	destroy():void {
		this.io.close();
	}
}

const optionDefinitions = [
	{ name: 'port', alias: 'p', type: Number, defaultOption: true, defaultValue: process.env['PORT'] || 3000}
];
const options = commandLineArgs(optionDefinitions);

const server = new ChatCodesSocketIOServer(options.port);
