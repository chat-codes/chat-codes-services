/// <reference types="node" />
import * as _ from 'underscore';
import * as express from 'express';
import * as http from 'http';
import * as socketIOLib from 'socket.io';

const app = express();
const appServer = http.createServer(app);
const io = socketIOLib(appServer);
const port = process.env.PORT || 3030;

export class SocketIOServer {

  static Start() {
    io.on('connection', function(socket) {

      socket.on('socket:member_added', function(channelName){
        socket.join(channelName);
      });

      socket.on('socket:member_removed', function(channelName){
        socket.leave(channelName);
      });

      socket.on('socket:channel_available', function(channelName){
        let channelEmpty = true;
        let channelExists = socket.rooms.indexOf(channelName) >= 0;

        if (channelExists) {
          channelEmpty = io.sockets.clients(channelName).length == 0;
        };

        return (channelExists && channelEmpty);
      });

      socket.on('socket:channel_event', function(channelName, eventName, callback){
        socket.on(eventName, function(callback){
          socket.to(channelName).emit(eventName);
          callback();
        });
      });

      socket.on('socket:all_members', function(channelName){
        io.sockets.clients(channelName);
      });

    });

    appServer.listen(port, function () {
      console.log('Server listening at port %d', port);
    });
  
  }

}

SocketIOServer.Start();
