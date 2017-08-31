/**
 * This file provides a communication layer that is built on the [Pusher](https://pusher.com) service. This code implements throttling,
 * automatically splits long messages into multiple messages, and automatically combines larger messages.
 */

import * as Pusher from 'pusher-js';
import * as _ from 'underscore';
import {format} from 'url';
import { CommunicationLayer } from './communication-layer-interface';


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

/**
 * Creates an authorization URL for the Pusher services (form: http://chat.codes/auth.php?name={userName})
 * @param  {string} userName The desired userName
 * @return {string}          A Pusher authorization URL
 */
function getAuthURL(userName:string) {
	return format({
		hostname: 'chat.codes',
		protocol: 'http',
		pathname: 'auth.php',
		query: { name: userName }
	});
}

/**
 * Divide a string into an array of strings with a maximum size.
 * Solution from https://stackoverflow.com/questions/7033639/split-large-string-in-n-size-chunks-in-javascript
 * @param  {string}        str          The string to split up
 * @param  {number}        maxChunkSize The maximum size of every string in the returned array.
 * @return {Array<string>}              An array of strings from str with the maximum size of maxChunkSize
 */
function chunkString(str: string, maxChunkSize: number): Array<string> {
	return str.match(new RegExp('.{1,' + maxChunkSize + '}', 'g'));
}

/**
 * Returns true if the argument is a boolean and false otherwise
 * @param  {any}  s The object to check if is a string
 * @return {boolean}   Whether s is a string or not
 */
function isString(s):boolean { return _.isString(s); }

/**
 * Returns true if EVERY item in arr is a string and false otherwise.
 * @param  {Array<any>} arr The array to check if every item is a string
 * @return {boolean}        Whether every item is a string or not
 */
function allStrings(arr:Array<any>):boolean { return _.every(arr, isString); }

/**
 * Create an array of the same object `times` times
 * @param  {any}        x     The object to replicate
 * @param  {number}     times The number of times to repeat
 * @return {Array<any>}       [x,x,...x]
 */
function repeat(x:any, times:number):Array<any> {
	const rv:Array<any> = [];
	for(let i = 0; i<times; i++) { rv.push(x); }
	return rv;
}

/*
 * A class that manages client-to-client communication through the [Pusher](https://pusher.com) service
 */
export class PusherCommunicationLayer implements CommunicationLayer {
	/**
	 * constructor
	 * @param  {any} authInfo An object with a key for `username` (containing the user's desired username)
	 * @param  {string} key      The pusher API key
	 * @param  {string} cluster  The pusher cluster name (example: 'us2')
	 */
	constructor(authInfo) {
		this.pusher = new Pusher(authInfo.key, {
			cluster: authInfo.cluster,
			encrypted: true,
			authEndpoint: getAuthURL(authInfo.username)
		});
	}
	private awaitingMessage:{[uid:string]:Array<any>} = {}; // A queue to help manage messages that are split into multiple messages
	private pusher: Pusher; // Pusher client object
	private messageQueues: {[channelName:string]: Array<any>} = {}; // A backlog of messages to send
	private channels: { [channelName: string]: any } = {} // Pusher clients for every channel
	private emitTimeout:any = false; // The ID of the next send timeout
	private channelQueue: Array<string>=[]; // A queue of channel names to send messages on
	private combinedEventMessageName:string = 'm'; // The type of message to use internally
	private SIZE_THRESHOLD:number = 1000; // The maximum number of characters to contain in a message
	private EMIT_RATE:number = 200; // The minimum amount of time (in ms) to wait between messages

	/**
	 * Listen for new members joining a channel
	 * @param  {string} channelName The channel name to listen for
	 * @param  {function} callback    The callback to call when a new member is added
	 */
	public onMemberAdded(channelName:string, callback:(event)=>any):void {
		const {presencePromise} = this.getChannel(channelName);
		presencePromise.then(function(channel) {
			channel.bind('pusher:member_added', callback);
		});
	}

	/**
	 * Listen for members leaving a channel
	 * @param  {string} channelName The channel name
	 * @param  {function} callback    The callback to call when a member leaves
	 */
	public onMemberRemoved(channelName:string, callback:(event)=>any):void {
		const {presencePromise} = this.getChannel(channelName);
		presencePromise.then(function(channel) {
			channel.bind('pusher:member_removed', callback);
		});
	}

	/**
	 * Returns a promise whose value resolves when the given channel is ready.
	 * @param  {string}       channelName The name of the channel
	 * @return {Promise<any>}             A promise that resolves when the channel is ready
	 */
	public channelReady(channelName:string):Promise<any> {
		const {privatePromise, presencePromise} = this.getChannel(channelName);
		return Promise.all([privatePromise, presencePromise]);
	}

	/**
	 * Send a message to every remote clients (but that will not be received by the current client)
	 * @param {string} channelName   The name of the channel to send the message on
	 * @param {string} eventName     Event type
	 * @param {any} eventContents The contents of the event
	 */
	public trigger(channelName:string, eventName:string, eventContents):void {
		const {privatePromise} = this.getChannel(channelName);
		privatePromise.then((channel) => {
			this.pushToMessageQueue(channelName, eventName, eventContents);
		});
	}

	/**
	 * Removes the first `count` instances of `channelName` from the channel queue
	 * @param  {string} channelName The name of the channel
	 * @param  {number} count       The number of times to remove
	 * @return {boolean}            true if everything went as expected (were able to remove that many instances)
	 */
	private removeFromChannelQueue(channelName:string, count:number):boolean {
		for(let i = 0; i<count; i++) {
			let index = this.channelQueue.indexOf(channelName);
			if(index >= 0) {
				this.channelQueue.splice(index, 1);
			} else {
				return false;
			}
		}
		return true;
	}

	/**
	 * Send all of the messages from the message queue that we can.
	 */
	private shiftMessageFromQueue():void {
		//Only run if we haven't schedule a time to communicate already
		if(this.emitTimeout===false) {
			//Make sure we actually have something to send
			if(this.channelQueue.length > 0) {
				const channelName:string = this.channelQueue[0];
				const messageQueue = this.messageQueues[channelName];

				let nextItem = messageQueue.shift();
				const arrayToSend:Array<any> = [nextItem]; // the list of payloads we're going to send

				//Loop over the set of items and see if we can add more messages from the queue to this message
				for(let i = 0; i<messageQueue.length; i++) {
					nextItem = messageQueue[0];

					// Check if adding one more item to our list of things to send would it above the
					// size threshold
					if(JSON.stringify(arrayToSend.concat(nextItem)).length > this.SIZE_THRESHOLD) {
						//If it does, don't add it to the message queue. Just stop trying to add items.
						break;
					} else {
						//We can add another message.
						messageQueue.splice(i, 1);  // cut nextItem item out of the list
						i--; // reduce i by 1 (because we cut an item out)
						arrayToSend.push(nextItem);
					}
				}

				const {privatePromise} = this.getChannel(channelName);
				privatePromise.then((channel) => {
					//send the messsage
		            const triggered = channel.trigger('client-'+this.combinedEventMessageName, arrayToSend);
					// If we couldn't send the message, re-add all of the messages we wanted to send to
					// the message queue
	                if(triggered) {
						this.removeFromChannelQueue(channelName, arrayToSend.length);
					} else {
	                    messageQueue.unshift.apply(messageQueue, arrayToSend);
	                }

					//Regardless of if there's another message right away, set a timeout to check
					this.emitTimeout = setTimeout(() => {
						this.emitTimeout = false;
						this.shiftMessageFromQueue();
					}, this.EMIT_RATE);
				});
			}
		}
	}

	/**
	 * Add a new message to send to the queue
	 * @param {string} channelName   The channel to send the message on
	 * @param {string} eventName     The name of the event
	 * @param {any} eventContents The actual event contents
	 */
	private pushToMessageQueue(channelName:string, eventName:string, eventContents):void {
		const stringifiedContents = JSON.stringify(eventContents);
		// Split the message into chunks if it's too long
		const stringChunks = chunkString(stringifiedContents, this.SIZE_THRESHOLD);
		// We only need a unique id if we are splitting across multiple messages
		const id = stringChunks.length > 1 ? guid() : '';
		const messageChunks = _.map(stringChunks, (s, i) => {
			/*
			 * e: the name of the event
			 * s: the string chunkString
			 * i: the index of this message
			 * n: the number of chunks to expected
			 * m: the id of this message group
			 */
			return {
				e: eventName,
				s: s,
				i: i,
				n: stringChunks.length,
				m: id
			};
		});
		let messageQueue = this.messageQueues[channelName];
		if(!_.has(this.messageQueues, channelName)) {
			messageQueue = this.messageQueues[channelName] = [];
		}
		messageQueue.push.apply(messageQueue, messageChunks);
		//Add the channel name to the queue
		this.channelQueue.push.apply(this.channelQueue, repeat(channelName, messageChunks.length));
		// Check if we can send the message
		this.shiftMessageFromQueue();
	}

	/**
	 * Add an event listener for a given event type
	 * @param  {string} channelName The name of the channel we are listening on
	 * @param  {string} eventName   The name of the event
	 * @param  {function}   callback    The function to call when the event occurs
	 */
	public bind(channelName:string, eventName:string, callback:(any)=>any):void {
		const {privatePromise} = this.getChannel(channelName);
		privatePromise.then((channel) => {
			// In pusher, only subscribe to one event type and then distribute messages individually
			channel.bind('client-'+this.combinedEventMessageName, (messageArray) => {
				// Go over all of the messages that have been sent and filter out the ones that have this event type
				_.each(messageArray, (packagedData:any) => {
					const {s,i,n,m,e} = packagedData;
					const eventN = e;
					if(eventN === eventName) {
						const str = s;
						const num = i;
						const numTotal = n;

						// If the message wasn't split, just do the callback
						if(numTotal === 1) {
							const data = JSON.parse(str);
							callback(data);
						} else {
							// If the message was split, wait for every part to arrive
							const messageID = m;
							if(!_.has(this.awaitingMessage, messageID)) {
								this.awaitingMessage[messageID] = [];
							}
							this.awaitingMessage[messageID][num] = str;

							// We've gotten every mesage in this group
							if(this.awaitingMessage[messageID].length === numTotal && allStrings(this.awaitingMessage[messageID])) {
								const data = JSON.parse(this.awaitingMessage[messageID].join(''));
								delete this.awaitingMessage[messageID];

								callback(data);
							}
						}
					}
				});
			});
		});
	}

	/**
	 * Returns a list of the members of a given channel
	 * @param  {string}  channelName The name of othe channel
	 * @return {Promise}             A promise whose value will resolve to a list of members
	 */
	public getMembers(channelName:string):Promise<Array<any>> {
		const {presencePromise} = this.getChannel(channelName);
		return presencePromise.then(function(channel) {
			return channel.members;
		});
	}


	/**
	 * Wraps the pusher API around a promise
	 * @param  {string}       channelName The full name of the channel for which we are getting a promise
	 * @return {Promise<any>}             A promise that resolves to a pusher object for that channel
	 */
	private getChannelSubscriptionPromise(channelName:string):Promise<any> {
		return new Promise((resolve, reject) => {
			let channel = this.pusher.subscribe(channelName);
			if (channel.subscribed) {
				resolve(channel);
			} else {
				channel.bind('pusher:subscription_succeeded', () => {
					resolve(channel);
				});
				channel.bind('pusher:subscription_error', (err) => {
					reject(err);
				});
			}
		});
	}

	/**
	 * Checks if anyone is in the given channel
	 * @param  {string}           channelName The channel name to check against
	 * @return {Promise<boolean>}             A promise whose value will resolve to whether that channel is empty or not
	 */
	public channelNameAvailable(channelName:string):Promise<boolean> {
		var presenceChannel = this.pusher.subscribe('presence-' + channelName);
		return this.getChannelSubscriptionPromise('presence-' + channelName).then((channel) => {
			const members = channel.members;
			var myID = members.myID;
			var anyOtherPeople = _.some(members.members, (memberInfo, id) => {
				return id !== myID;
			});
			// channel.disconnect();
			this.pusher.unsubscribe('presence-' + channelName);
			return (!anyOtherPeople);
		});
	}

	/**
	 * Returns two promies for a given channel. privatePromise is the actual communication channel.
	 * presenceChannel contains information about users who enter and leave
	 * @param  {string} channelName [description]
	 * @return {any}                An object with privatePromise and presencePromise keys
	 */
	private getChannel(channelName:string) {
		if (!this.channels[channelName]) {
			this.channels[channelName] = {
				privatePromise: this.getChannelSubscriptionPromise('private-' + channelName),
				presencePromise: this.getChannelSubscriptionPromise('presence-' + channelName)
			};
		}
		return this.channels[channelName];
	}
	/**
	 * Unsubscribe from a channel
	 * @param  {string} channelName The name of the channel we are unsubscribing from
	 */
	private doUnsubscribe(channelName:string):void {
		// this.channels[channelName].private.unsubscribe();
		// this.channels[channelName].presence.unsubscribe();
		this.pusher.unsubscribe('private-' + channelName);
		this.pusher.unsubscribe('presence-' + channelName);
		delete this.channels[channelName];
	}
	/**
	 * Deallocate the resources used when we are done
	 */
	public destroy():void {
		this.pusher.disconnect();
	}
}
