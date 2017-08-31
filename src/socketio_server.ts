import * as sio from 'socket.io';
import * as _ from 'underscore';

export class ChatCodesSocketIOServer {
	private io:SocketIO.Server;
	private namespaces:{[ns:string]: SocketIO.Namespace} = {};
	private members:{[id:string]:any} = {};;
	constructor(private port:number) {
		this.io = sio(this.port);
		this.io.on('connection', (socket:SocketIO.Socket) => {
			socket.on('request-join-room', (roomName:string, callback) => {
				const ns = this.getNamespace(roomName);
				callback();
			});
			socket.on('channel-available', (roomName:string, callback) => {
				const ns = this.getNamespace(roomName);
				ns.clients((err, clients) => {
					if(err) { console.error(err); }
					callback(clients.length === 0);
				});
			});
		});
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
				});

				s.on('data', (eventName:string, payload:any) => {
					s.broadcast.emit(`data-${eventName}`, payload);
				});
				s.on('disconnect', () => {
					s.broadcast.emit('member-removed', member);
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
				});
			});
			this.namespaces[name] = ns;
			return this.namespaces[name];
		}
	}
	destroy():void {
		this.io.close();
	}
}

const server = new ChatCodesSocketIOServer(8888);
