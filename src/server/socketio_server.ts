import * as sio from 'socket.io';
import * as _ from 'underscore';
import * as commandLineArgs from 'command-line-args';

export class ChatCodesSocketIOServer {
	private io:SocketIO.Server;
	private namespaces:{[ns:string]: SocketIO.Namespace} = {};
	private members:{[id:string]:any} = {};;
	constructor(private port:number) {
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
					callback();

					s.broadcast.emit('member-added', member);
					console.log(`Client (${id} in ${name}) set username to ${username}`);
				});

				s.on('data', (eventName:string, payload:any) => {
					s.broadcast.emit(`data-${eventName}`, payload);
				});
				s.on('disconnect', () => {
					s.broadcast.emit('member-removed', member);
					console.log(`Client (${id} in ${name}) disconnected`);
				});

				s.on('get-members', (callback) => {
					ns.clients((err, clients) => {
						if(err) { console.error(err); }
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
			this.namespaces[name] = ns;
			return this.namespaces[name];
		}
	}
	destroy():void {
		this.io.close();
	}
}

const optionDefinitions = [
	{ name: 'port', alias: 'p', type: Number, defaultOption: true, defaultValue: 3000}
];
const options = commandLineArgs(optionDefinitions);

const server = new ChatCodesSocketIOServer(options.port);
