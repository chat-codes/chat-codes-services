/**
 * This file provides a communication layer that is built on SocketIO. 
 */

import * as SocketClient from 'socket.io-client';
import * as _ from 'underscore';

/*
 * A class that manages client communication through SocketIO
 */

 /**
 * Generates a random UID (such as '267fdf4e-2784-1815-cd8f-fd34921cbb65')
 * @return {string} A random UID (example: )
 */
function guid(): string {
  function s4() {
    return Math.floor((1 + Math.random()) * 0x10000)
      .toString(16)
      .substring(1);
  }
  return s4() + s4() + '-' + s4() + '-' + s4() + '-' +
    s4() + '-' + s4() + s4() + s4();
}

export class SocketCommunicationLayer {
  constructor(authInfo) {
    this.socket = SocketClient('http://localhost:3030');
    this.socket.myID = guid();
    this.socket.info = {};
    this.socket.info.name = authInfo.username
  }
  private channels: { [channelName: string]: any } = {}
  private socket: SocketClient;
  
  /**
   * Listen for new members joining a channel
   * @param  {string} channelName The channel name to listen for
   * @param  {function} callback    The callback to call when a new member is added
   */
  public onMemberAdded(channelName:string, callback:(event)=>any):void {
    const {channelPromise} = this.getChannel(channelName);
    channelPromise.then(function(channel) {
      channel.emit('socket:member_added', channelName);
      return channel;
    });
  }

  /**
   * Listen for members leaving a channel
   * @param  {string} channelName The channel name
   * @param  {function} callback    The callback to call when a member leaves
   */
  public onMemberRemoved(channelName:string, callback:(event)=>any):void {
    const {channelPromise} = this.getChannel(channelName);
    channelPromise.then(function(channel) {
      channel.emit('socket:member_removed', channelName);
      return channel;
    });
  }

  /**
   * Returns a promise whose value resolves when the given channel is ready.
   * @param  {string}       channelName The name of the channel
   * @return {Promise<any>}             A promise that resolves when the channel is ready
   */
  public channelReady(channelName:string):Promise<any> {
    const {channelPromise} = this.getChannel(channelName);
    return Promise.all([channelPromise]);
  }

  /**
   * Send a message to every remote clients (but that will not be received by the current client)
   * @param {string} channelName   The name of the channel to send the message on
   * @param {string} eventName     Event type
   * @param {any} eventContents The contents of the event
   */
  public trigger(channelName:string, eventName:string, eventContents):void {
    const {channelPromise} = this.getChannel(channelName);
    channelPromise.then((channel) => {
      let socketEventName = 'socket:' + eventName;
      channel.emit(socketEventName, eventContents);
    });
  }

  /**
   * Add an event listener for a given event type
   * @param  {string} channelName The name of the channel we are listening on
   * @param  {string} eventName   The name of the event
   * @param  {function}   callback    The function to call when the event occurs
   */
  public bind(channelName:string, eventName:string, callback:(any)=>any):void {
    const {channelPromise} = this.getChannel(channelName);
    channelPromise.then((channel) => {
      let socketEventName = 'socket:' + eventName;
      channel.emit('socket:channel_event', socketEventName, callback);
    });
  }

  /**
   * Returns a list of the members of a given channel
   * @param  {string}  channelName The name of othe channel
   * @return {Promise}             A promise whose value will resolve to a list of members
   */
  public getMembers(channelName:string):any {
    const {channelPromise} = this.getChannel(channelName);
    return channelPromise.then(function(channel) {
      return channel;
    });
  }

  /**
   * Checks if anyone is in the given channel
   * @param  {string}           channelName The channel name to check against
   * @return {Promise<boolean>}             A promise whose value will resolve to whether that channel is empty or not
   */
  public channelNameAvailable(channelName:string):Promise<boolean> {
    let channelAvailable = this.socket.emit('socket:channel_available', channelName);
    return channelAvailable;
  }

  /**
   * @param  {string}       channelName The full name of the channel for which we are getting a promise
   * @return {Promise<any>}             A promise that resolves to a socket
   */
  private getChannelSubscriptionPromise(channelName:string):Promise<any> {
    return new Promise((resolve, reject) => {
      let channel = this.socket;
      if (channel.emit('socket:subscribed_already', channelName)) {
        let members = []
        let results = channel.emit('socket:all_members', channelName).io.connecting;
        _.each(results, (data) => {
          members.push({
            id: data.myID,
            info: data.info
          })
        });
        channel.members = members;
        channel.count = members.length;
        resolve(channel);
      }
    });
  }

  /**
   * Returns two promises for a given channel. channelPromise is the actual communication channel.
   * presenceChannel contains information about users who enter and leave
   * @param  {string} channelName [description]
   * @return {any}                An object with a channelPromise
   */
  private getChannel(channelName:string) {
    if (!this.channels[channelName]) {
      this.channels[channelName] = {
        channelPromise: this.getChannelSubscriptionPromise(channelName)
      };
    }
    return this.channels[channelName];
  }

  /**
   * Deallocate the resources used when we are done
   */
  public destroy():void {
    this.socket.disconnect();
  }
}
