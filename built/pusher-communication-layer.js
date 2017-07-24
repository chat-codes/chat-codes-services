"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const Pusher = require("pusher-js");
const _ = require("underscore");
const url_1 = require("url");
const SIZE_THRESHOLD = 1000;
const EMIT_RATE = 200;
function guid() {
    function s4() {
        return Math.floor((1 + Math.random()) * 0x10000)
            .toString(16)
            .substring(1);
    }
    return s4() + s4() + '-' + s4() + '-' + s4() + '-' +
        s4() + '-' + s4() + s4() + s4();
}
function getAuthURL(userName) {
    return url_1.format({
        hostname: 'chat.codes',
        protocol: 'http',
        pathname: 'auth.php',
        query: { name: userName }
    });
}
function chunkString(str, maxChunkSize) {
    return str.match(new RegExp('.{1,' + maxChunkSize + '}', 'g'));
}
function isString(s) {
    return _.isString(s);
}
function allStrings(arr) {
    return _.every(arr, isString);
}
class PusherCommunicationLayer {
    constructor(authInfo, key, cluster) {
        this.awaitingMessage = {};
        this.messageQueue = [];
        this.channels = {};
        this.emitTimeout = false;
        this.pusher = new Pusher(key, {
            cluster: cluster,
            encrypted: true,
            authEndpoint: getAuthURL(authInfo.username)
        });
    }
    getChannelSubscriptionPromise(channelName) {
        return new Promise((resolve, reject) => {
            let channel = this.pusher.subscribe(channelName);
            if (channel.subscribed) {
                resolve(channel);
            }
            else {
                channel.bind('pusher:subscription_succeeded', () => {
                    resolve(channel);
                });
                channel.bind('pusher:subscription_error', (err) => {
                    reject(err);
                });
            }
        });
    }
    onMemberAdded(channelName, callback) {
        const { presencePromise } = this.getChannel(channelName);
        presencePromise.then(function (channel) {
            channel.bind('pusher:member_added', callback);
        });
    }
    onMemberRemoved(channelName, callback) {
        const { presencePromise } = this.getChannel(channelName);
        presencePromise.then(function (channel) {
            channel.bind('pusher:member_removed', callback);
        });
    }
    channelReady(channelName) {
        const { privatePromise, presencePromise } = this.getChannel(channelName);
        return Promise.all([privatePromise, presencePromise]);
    }
    trigger(channelName, eventName, eventContents) {
        const { privatePromise } = this.getChannel(channelName);
        privatePromise.then((channel) => {
            this.pushToMessageQueue(channelName, 'client-' + eventName, eventContents);
        });
    }
    shiftMessageFromQueue() {
        if (this.emitTimeout === false) {
            if (this.messageQueue.length > 0) {
                const lastItem = this.messageQueue.shift();
                const { channelName, eventName, payload } = lastItem;
                const { privatePromise } = this.getChannel(channelName);
                privatePromise.then((channel) => {
                    const triggered = channel.trigger(eventName, payload);
                    if (!triggered) {
                        this.messageQueue.unshift(lastItem);
                    }
                    this.emitTimeout = window.setTimeout(() => {
                        this.emitTimeout = false;
                        this.shiftMessageFromQueue();
                    }, EMIT_RATE);
                });
            }
        }
    }
    pushToMessageQueue(channelName, eventName, eventContents) {
        const stringifiedContents = JSON.stringify(eventContents);
        const stringChunks = chunkString(stringifiedContents, SIZE_THRESHOLD);
        const id = stringChunks.length > 1 ? guid() : '';
        const messageChunks = _.map(stringChunks, (s, i) => {
            return {
                channelName: channelName,
                eventName: eventName,
                payload: {
                    s: s,
                    i: i,
                    n: stringChunks.length,
                    m: id
                }
            };
        });
        this.messageQueue.push.apply(this.messageQueue, messageChunks);
        this.shiftMessageFromQueue();
    }
    bind(channelName, eventName, callback) {
        const { privatePromise } = this.getChannel(channelName);
        privatePromise.then((channel) => {
            channel.bind('client-' + eventName, (packagedData) => {
                const { s, i, n, m } = packagedData;
                const str = s;
                const num = i;
                const numTotal = n;
                if (numTotal === 1) {
                    const data = JSON.parse(str);
                    callback(data);
                }
                else {
                    const messageID = m;
                    if (!_.has(this.awaitingMessage, messageID)) {
                        this.awaitingMessage[messageID] = [];
                    }
                    this.awaitingMessage[messageID][num] = str;
                    if (this.awaitingMessage[messageID].length === numTotal && allStrings(this.awaitingMessage[messageID])) {
                        const data = JSON.parse(this.awaitingMessage[messageID].join(''));
                        delete this.awaitingMessage[messageID];
                        callback(data);
                    }
                }
            });
        });
    }
    getMembers(channelName) {
        const { presencePromise } = this.getChannel(channelName);
        return presencePromise.then(function (channel) {
            return channel.members;
        });
    }
    channelNameAvailable(name) {
        var presenceChannel = this.pusher.subscribe('presence-' + name);
        return this.getChannelSubscriptionPromise('presence-' + name).then(function (channel) {
            const members = channel.members;
            var myID = members.myID;
            var anyOtherPeople = _.some(members.members, (memberInfo, id) => {
                return id !== myID;
            });
            // channel.disconnect();
            return (!anyOtherPeople);
        });
    }
    getChannel(channelName) {
        if (!this.isSubscribed(channelName)) {
            this.doSubscribe(channelName);
        }
        return this.channels[channelName];
    }
    isSubscribed(channelName) {
        return _.has(this.channels, channelName);
    }
    doSubscribe(channelName) {
        this.channels[channelName] = {
            privatePromise: this.getChannelSubscriptionPromise('private-' + channelName),
            presencePromise: this.getChannelSubscriptionPromise('presence-' + channelName)
        };
    }
    doUnsubscribe(channelName) {
        // this.channels[channelName].private.unsubscribe();
        // this.channels[channelName].presence.unsubscribe();
        this.pusher.unsubscribe('private-' + channelName);
        this.pusher.unsubscribe('presence-' + channelName);
        delete this.channels[channelName];
    }
    destroy() {
        this.pusher.disconnect();
    }
}
exports.PusherCommunicationLayer = PusherCommunicationLayer;
//# sourceMappingURL=pusher-communication-layer.js.map