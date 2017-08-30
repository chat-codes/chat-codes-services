import * as sio from 'socket.io';
import * as _ from 'underscore';

export class ChatCodesSocketIOServer {
	private io:SocketIO.Server;
	private namespaces:{[ns:string]: SocketIO.Namespace} = {};
	constructor(private port:number) {
		this.io = sio(this.port);
	}
	public getNamespace(name:string):SocketIO.Namespace {
		if(_.has(this.namespaces, name)) {
			return this.namespaces[name];
		} else {
			this.namespaces[name] = this.io.of(`/${name}`);
			return this.namespaces[name];
		}
	}
	destroy():void {
		this.io.close();
	}
}

const server = new ChatCodesSocketIOServer(8888);
server.getNamespace('example');