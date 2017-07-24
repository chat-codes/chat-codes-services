System.register("chat-user", [], function (exports_1, context_1) {
    "use strict";
    var __moduleName = context_1 && context_1.id;
    var ChatUserList, current_user_color, ChatUser;
    return {
        setters: [],
        execute: function () {
            ChatUserList = class ChatUserList {
                constructor() {
                    this.activeUsers = [];
                    this.allUsers = [];
                }
                addAll(memberInfo) {
                    const myID = memberInfo.myID;
                    memberInfo.members.forEach((memberInfo, id) => {
                        this.add(id === myID, id, memberInfo.name);
                    });
                }
                add(isMe, id, name, active = true) {
                    var user = this.hasUser(id);
                    if (!user) {
                        user = new ChatUser(isMe, id, name, active);
                        if (active) {
                            this.activeUsers.push(user);
                        }
                        this.allUsers.push(user);
                    }
                    return user;
                }
                hasUser(id) {
                    for (var i = 0; i < this.allUsers.length; i++) {
                        var id_i = this.allUsers[i].id;
                        if (id_i === id) {
                            return this.allUsers[i];
                        }
                    }
                    return false;
                }
                remove(id) {
                    for (var i = 0; i < this.activeUsers.length; i++) {
                        var id_i = this.activeUsers[i].id;
                        if (id_i === id) {
                            this.activeUsers[i].active = false;
                            this.activeUsers.splice(i, 1);
                            break;
                        }
                    }
                }
                getUser(id) {
                    for (var i = 0; i < this.allUsers.length; i++) {
                        var id_i = this.allUsers[i].id;
                        if (id_i === id) {
                            return this.allUsers[i];
                        }
                    }
                    return false;
                }
                getMe() {
                    for (var i = 0; i < this.allUsers.length; i++) {
                        if (this.allUsers[i].isMe) {
                            return this.allUsers[i];
                        }
                    }
                    return false;
                }
            };
            exports_1("ChatUserList", ChatUserList);
            current_user_color = 2;
            ChatUser = class ChatUser {
                constructor(isMe, id, name, active) {
                    this.isMe = isMe;
                    this.id = id;
                    this.name = name;
                    this.active = active;
                    this.numColors = 4;
                    this.typingStatus = 'IDLE';
                    this.colorIndex = isMe ? 1 : current_user_color;
                    current_user_color = 2 + ((current_user_color + 1) % this.numColors);
                }
                setTypingStatus(status) {
                    this.typingStatus = status;
                }
            };
            exports_1("ChatUser", ChatUser);
        }
    };
});
System.register("chat", ["underscore"], function (exports_2, context_2) {
    "use strict";
    var __moduleName = context_2 && context_2.id;
    var _, Chat;
    return {
        setters: [
            function (_1) {
                _ = _1;
            }
        ],
        execute: function () {
            Chat = class Chat {
                constructor() {
                    this.messageGroupingTimeThreshold = 5 * 60 * 1000; // 5 minutes
                    this.messages = [];
                    this.messageGroups = [];
                }
                ;
                addToMessageGroups(data) {
                    let lastMessageGroup = _.last(this.messageGroups);
                    let groupToAddTo = lastMessageGroup;
                    if (!lastMessageGroup || (lastMessageGroup.timestamp < data.timestamp - this.messageGroupingTimeThreshold) || (lastMessageGroup.sender.id !== data.sender.id)) {
                        groupToAddTo = {
                            sender: data.sender,
                            timestamp: data.timestamp,
                            messages: []
                        };
                        this.messageGroups.push(groupToAddTo);
                    }
                    groupToAddTo.messages.push(data);
                }
            };
            exports_2("Chat", Chat);
        }
    };
});
// import {RemoteCursorMarker} from './remote_cursor_marker';
System.register("editor-state-tracker", [], function (exports_3, context_3) {
    "use strict";
    var __moduleName = context_3 && context_3.id;
    var TitleDelta, GrammarDelta, EditChange, EditDelta, OpenDelta, DestroyDelta, ModifiedDelta, EditorState, EditorStateTracker;
    return {
        setters: [],
        execute: function () {// import {RemoteCursorMarker} from './remote_cursor_marker';
            TitleDelta = class TitleDelta {
                constructor(serializedState) {
                    this.oldTitle = serializedState.oldTitle;
                    this.newTitle = serializedState.newTitle;
                    this.timestamp = serializedState.timestamp;
                }
                getTimestamp() { return this.timestamp; }
                ;
                doAction(editorState) {
                    editorState.setTitle(this.newTitle);
                }
                undoAction(editorState) {
                    editorState.setTitle(this.oldTitle);
                }
            };
            GrammarDelta = class GrammarDelta {
                constructor(serializedState) {
                    this.oldGrammarName = serializedState.oldGrammarName;
                    this.newGrammarName = serializedState.newGrammarName;
                    this.timestamp = serializedState.timestamp;
                }
                getTimestamp() { return this.timestamp; }
                ;
                doAction(editorState) {
                    const editorWrapper = editorState.getEditorWrapper();
                    editorWrapper.setGrammar(this.newGrammarName);
                }
                undoAction(editorState) {
                    const editorWrapper = editorState.getEditorWrapper();
                    editorWrapper.setGrammar(this.oldGrammarName);
                }
            };
            EditChange = class EditChange {
                getTimestamp() { return this.timestamp; }
                ;
                constructor(serializedState) {
                    this.oldRange = serializedState.oldRange;
                    this.newRange = serializedState.newRange;
                    this.oldText = serializedState.oldText;
                    this.newText = serializedState.newText;
                }
                doAction(editorState) {
                    const editorWrapper = editorState.getEditorWrapper();
                    this.updateRanges(editorState);
                    editorWrapper.replaceText(this.oldRange, this.newText);
                }
                undoAction(editorState) {
                    const editorWrapper = editorState.getEditorWrapper();
                    editorWrapper.replaceText(this.newRange, this.oldText);
                }
                addAnchor(editorState) {
                    const editorWrapper = editorState.getEditorWrapper();
                    this.oldRangeAnchor = editorWrapper.getAnchor(this.oldRange);
                    this.newRangeAnchor = editorWrapper.getAnchor(this.newRange);
                }
                updateRanges(editorState) {
                    const editorWrapper = editorState.getEditorWrapper();
                    this.oldRange = editorWrapper.getCurrentAnchorPosition(this.oldRangeAnchor);
                    this.newRange = editorWrapper.getCurrentAnchorPosition(this.oldRangeAnchor);
                }
            };
            EditDelta = class EditDelta {
                constructor(serializedState) {
                    this.timestamp = serializedState.timestamp;
                    this.changes = serializedState.changes.map((ss) => {
                        return new EditChange(ss);
                    });
                }
                getTimestamp() { return this.timestamp; }
                ;
                doAction(editorState) {
                    this.changes.forEach((c) => {
                        c.doAction(editorState);
                    });
                }
                undoAction(editorState) {
                    this.changes.forEach((c) => {
                        c.undoAction(editorState);
                    });
                }
                addAnchors(editorState) {
                    this.changes.forEach((c) => {
                        c.addAnchor(editorState);
                    });
                }
            };
            OpenDelta = class OpenDelta {
                constructor(serializedState) {
                    this.grammarName = serializedState.grammarName;
                    this.title = serializedState.title;
                    this.timestamp = serializedState.timestamp;
                    this.contents = serializedState.contents;
                }
                getTimestamp() { return this.timestamp; }
                ;
                doAction(editorState) {
                    const editorWrapper = editorState.getEditorWrapper();
                    editorState.title = this.title;
                    editorState.isOpen = true;
                    editorState.grammarName = this.grammarName;
                    editorWrapper.setGrammar(this.grammarName);
                    editorWrapper.setText(this.contents);
                }
                undoAction(editorState) {
                    const editorWrapper = editorState.getEditorWrapper();
                    editorState.title = '';
                    editorState.isOpen = false;
                    editorState.grammarName = false;
                    editorWrapper.setText('');
                }
            };
            DestroyDelta = class DestroyDelta {
                constructor(serializedState) {
                    this.timestamp = serializedState.timestamp;
                }
                getTimestamp() { return this.timestamp; }
                ;
                doAction(editorState) {
                }
                undoAction(editorState) {
                }
            };
            ModifiedDelta = class ModifiedDelta {
                constructor(serializedState) {
                    this.timestamp = serializedState.timestamp;
                    this.modified = serializedState.modified;
                    this.oldModified = serializedState.oldModified;
                }
                getTimestamp() { return this.timestamp; }
                ;
                doAction(editorState) {
                    editorState.modified = this.modified;
                }
                undoAction(editorState) {
                    editorState.modified = this.oldModified;
                }
            };
            EditorState = class EditorState {
                constructor(state, editorWrapper) {
                    this.deltas = [];
                    this.cursors = {};
                    this.selections = {};
                    this.editorID = state.id;
                    state.deltas.forEach((d) => {
                        this.addDelta(d);
                    });
                    state.cursors.forEach((c) => {
                    });
                    this.editorWrapper = editorWrapper;
                }
                ngOnDestroy() {
                }
                getEditorWrapper() { return this.editorWrapper; }
                ;
                setTitle(newTitle) { this.title = newTitle; }
                ;
                setIsOpen(val) { this.isOpen = val; }
                ;
                getIsOpen(val) { return this.isOpen; }
                ;
                // public getRemoteCursors():RemoteCursorMarker { return this.remoteCursors; };
                getEditorID() { return this.editorID; }
                ;
                addDelta(serializedDelta, mustPerformChange = true) {
                    const { type } = serializedDelta;
                    let delta;
                    if (type === 'open') {
                        delta = new OpenDelta(serializedDelta);
                    }
                    else if (type === 'edit') {
                        delta = new EditDelta(serializedDelta);
                    }
                    else if (type === 'modified') {
                        delta = new ModifiedDelta(serializedDelta);
                    }
                    else if (type === 'grammar') {
                        delta = new GrammarDelta(serializedDelta);
                    }
                    else if (type === 'title') {
                        delta = new TitleDelta(serializedDelta);
                    }
                    else if (type === 'destroy') {
                        delta = new ModifiedDelta(serializedDelta);
                    }
                    else {
                        console.log(serializedDelta);
                    }
                    if (delta) {
                        this.handleDelta(delta, mustPerformChange);
                    }
                }
                handleDelta(delta, mustPerformChange) {
                    if (delta instanceof EditDelta) {
                        delta.addAnchors(this);
                    }
                    let i = this.deltas.length - 1;
                    let d;
                    for (; i >= 0; i--) {
                        d = this.deltas[i];
                        if (d.getTimestamp() > delta.getTimestamp()) {
                            this.undoDelta(d);
                        }
                        else {
                            break;
                        }
                    }
                    const insertAt = i + 1;
                    this.deltas.splice(insertAt, 0, delta);
                    if (mustPerformChange) {
                        i = insertAt;
                    }
                    else {
                        i = insertAt + 1;
                    }
                    for (; i < this.deltas.length; i++) {
                        d = this.deltas[i];
                        this.doDelta(d);
                    }
                }
                doDelta(d) {
                    d.doAction(this);
                }
                undoDelta(d) {
                    d.undoAction(this);
                }
            };
            exports_3("EditorState", EditorState);
            EditorStateTracker = class EditorStateTracker {
                constructor(editorStateWrapperFactory) {
                    this.editorStates = {};
                    this.editorStateWrapperFactory = editorStateWrapperFactory();
                }
                handleEvent(event) {
                    const editorState = this.getEditorState(event.id);
                    if (editorState) {
                        editorState.addDelta(event);
                    }
                }
                ;
                getEditorState(editorID) {
                    if (this.editorStates[editorID]) {
                        return this.editorStates[editorID];
                    }
                    else {
                        return null;
                    }
                }
                getActiveEditors() {
                    return Object.keys(this.editorStates).map((key) => {
                        const s = this.editorStates[key];
                        return s.getIsOpen();
                    });
                }
                onEditorOpened(state) {
                    const editorState = new EditorState(state, this.editorStateWrapperFactory(state));
                    this.editorStates[state.id] = editorState;
                    return editorState;
                }
            };
            exports_3("EditorStateTracker", EditorStateTracker);
        }
    };
});
System.register("pusher-communication-layer", ["pusher-js", "underscore", "url"], function (exports_4, context_4) {
    "use strict";
    var __moduleName = context_4 && context_4.id;
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
    var Pusher, _, url_1, SIZE_THRESHOLD, EMIT_RATE, PusherCommunicationLayer;
    return {
        setters: [
            function (Pusher_1) {
                Pusher = Pusher_1;
            },
            function (_2) {
                _ = _2;
            },
            function (url_1_1) {
                url_1 = url_1_1;
            }
        ],
        execute: function () {
            SIZE_THRESHOLD = 1000;
            EMIT_RATE = 200;
            PusherCommunicationLayer = class PusherCommunicationLayer {
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
            };
            exports_4("PusherCommunicationLayer", PusherCommunicationLayer);
        }
    };
});
System.register("pusher.service", ["underscore", "chat-user", "pusher-communication-layer", "events"], function (exports_5, context_5) {
    "use strict";
    var __moduleName = context_5 && context_5.id;
    var _, chat_user_1, pusher_communication_layer_1, events_1, PusherService;
    return {
        setters: [
            function (_3) {
                _ = _3;
            },
            function (chat_user_1_1) {
                chat_user_1 = chat_user_1_1;
            },
            function (pusher_communication_layer_1_1) {
                pusher_communication_layer_1 = pusher_communication_layer_1_1;
            },
            function (events_1_1) {
                events_1 = events_1_1;
            }
        ],
        execute: function () {
            PusherService = class PusherService extends events_1.EventEmitter {
                constructor(userName, channelName, key, cluster) {
                    super();
                    this.userName = userName;
                    this.channelName = channelName;
                    this.userList = new chat_user_1.ChatUserList();
                    this.commLayer = new pusher_communication_layer_1.PusherCommunicationLayer({
                        username: userName
                    }, key, cluster);
                    this.channelName = channelName;
                    this.commLayer.bind(this.channelName, 'terminal-data', (event) => {
                        this.emit('terminal-data', event);
                    });
                    this.commLayer.bind(this.channelName, 'message', (data) => {
                        this.emit('message', _.extend({
                            sender: this.userList.getUser(data.uid)
                        }, data));
                    });
                    this.commLayer.bind(this.channelName, 'message-history', (data) => {
                        if (data.forUser === this.myID) {
                            data.allUsers.forEach((u) => {
                                this.userList.add(false, u.id, u.name, u.active);
                            });
                            _.each(data.history, (m) => {
                                this.emit('message', _.extend({
                                    sender: this.userList.getUser(m.uid)
                                }, m));
                            });
                        }
                    });
                    this.commLayer.bind(this.channelName, 'typing', (data) => {
                        const { uid, status } = data;
                        const user = this.userList.getUser(uid);
                        if (user) {
                            user.setTypingStatus(status);
                        }
                    });
                    this.commLayer.bind(this.channelName, 'editor-event', (data) => {
                        this.emit('editor-event', data);
                    });
                    this.commLayer.bind(this.channelName, 'cursor-event', (data) => {
                        this.emit('cursor-event', data);
                    });
                    this.commLayer.bind(this.channelName, 'editor-state', (data) => {
                        this.emit('editor-state', data);
                    });
                    this.commLayer.bind(this.channelName, 'editor-opened', (data) => {
                        this.emit('editor-opened', data);
                    });
                    this.commLayer.getMembers(this.channelName).then((memberInfo) => {
                        this.myID = memberInfo.myID;
                        this.userList.addAll(memberInfo);
                    });
                    this.commLayer.onMemberAdded(this.channelName, (member) => {
                        this.userList.add(false, member.id, member.info.name);
                    });
                    this.commLayer.onMemberRemoved(this.channelName, (member) => {
                        this.userList.remove(member.id);
                    });
                }
                ready() {
                    return this.commLayer.channelReady(this.channelName);
                }
                emitSave(data) {
                    this.emit('message', _.extend({
                        sender: this.userList.getMe(),
                        timestamp: this.getTimestamp()
                    }, data));
                }
                sendTextMessage(message) {
                    const data = {
                        uid: this.myID,
                        type: 'text',
                        message: message,
                        timestamp: this.getTimestamp()
                    };
                    this.commLayer.trigger(this.channelName, 'message', data);
                    this.emit('message', _.extend({
                        sender: this.userList.getMe()
                    }, data));
                }
                sendTypingStatus(status) {
                    const data = {
                        uid: this.myID,
                        type: 'status',
                        status: status,
                        timestamp: this.getTimestamp()
                    };
                    const meUser = this.userList.getMe();
                    this.commLayer.trigger(this.channelName, 'typing', data);
                    this.emit('typing', _.extend({
                        sender: this.userList.getMe()
                    }, data));
                    if (meUser) {
                        meUser.setTypingStatus(status);
                    }
                }
                emitEditorChanged(delta) {
                    this.commLayer.trigger(this.channelName, 'editor-event', _.extend({
                        timestamp: this.getTimestamp(),
                        uid: this.myID,
                        remote: true
                    }, delta));
                }
                emitCursorPositionChanged(delta) {
                    this.commLayer.trigger(this.channelName, 'cursor-event', _.extend({
                        timestamp: this.getTimestamp(),
                        uid: this.myID,
                        remote: true
                    }, delta));
                }
                emitCursorSelectionChanged(delta) {
                    this.commLayer.trigger(this.channelName, 'cursor-event', _.extend({
                        timestamp: this.getTimestamp(),
                        uid: this.myID,
                        remote: true
                    }, delta));
                }
                writeToTerminal(data) {
                    this.commLayer.trigger(this.channelName, 'write-to-terminal', {
                        timestamp: this.getTimestamp(),
                        uid: this.myID,
                        remote: true,
                        contents: data
                    });
                }
                ngOnDestroy() {
                    this.commLayer.destroy();
                }
                getTimestamp() {
                    return new Date().getTime();
                }
            };
            exports_5("PusherService", PusherService);
        }
    };
});
//# sourceMappingURL=chat-codes-services.js.map