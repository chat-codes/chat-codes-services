"use strict";
var __extends = (this && this.__extends) || (function () {
    var extendStatics = Object.setPrototypeOf ||
        ({ __proto__: [] } instanceof Array && function (d, b) { d.__proto__ = b; }) ||
        function (d, b) { for (var p in b) if (b.hasOwnProperty(p)) d[p] = b[p]; };
    return function (d, b) {
        extendStatics(d, b);
        function __() { this.constructor = d; }
        d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
var _ = require("underscore");
var chat_user_1 = require("./chat-user");
var socket_communication_layer_1 = require("./socket-communication-layer");
var chat_messages_1 = require("./chat-messages");
var event_1 = require("./event");
var editor_state_tracker_1 = require("./editor-state-tracker");
var ChannelCommunicationService = (function (_super) {
    __extends(ChannelCommunicationService, _super);
    /**
     * [constructor description]
     * @param  {CommunicationService} privatecommService The CommunicationService object that created this instance
     * @param  {string}               channelName The name of the channel we're communicating on
     * @param  {class}               EditorWrapperClass A class whose instances satisfy the EditorWrapper interface
     */
    function ChannelCommunicationService(commService, channelName, channelID, isObserver, EditorWrapperClass) {
        var _this = _super.call(this) || this;
        _this.commService = commService;
        _this.channelName = channelName;
        _this.channelID = channelID;
        _this.isObserver = isObserver;
        _this._isRoot = false;
        _this.cachedEditorVersions = new Map();
        _this.commLayer = commService.commLayer;
        _this.channelCommLayer = _this.commLayer.getNamespace(_this.getChannelName(), _this.channelID);
        _this.chatDoc = _this.createDocSubscription('chat');
        _this.editorsDoc = _this.createDocSubscription('editors');
        _this.cursorsDoc = _this.createDocSubscription('cursors');
        _this.userList = new chat_user_1.ChatUserList(_this.getMyID(), _this);
        _this.editorStateTracker = new editor_state_tracker_1.EditorStateTracker(EditorWrapperClass, _this, _this.userList, _this.isObserver);
        _this.messageGroups = new chat_messages_1.MessageGroups(_this, _this.userList, _this.editorStateTracker);
        return _this;
    }
    ChannelCommunicationService.prototype.getUserList = function () { return this.userList; };
    ;
    ChannelCommunicationService.prototype.getEditorStateTracker = function () { return this.editorStateTracker; };
    ;
    ChannelCommunicationService.prototype.getMessageGroups = function () { return this.messageGroups; };
    ;
    ChannelCommunicationService.prototype.createDocSubscription = function (docName) {
        return this.channelCommLayer.then(function (ccomm) {
            return ccomm.getShareDBObject(docName);
        }).then(function (doc) {
            return new Promise(function (resolve, reject) {
                doc.subscribe(function (err) {
                    if (err) {
                        reject(err);
                    }
                    else {
                        resolve(doc);
                    }
                });
            });
        });
    };
    ChannelCommunicationService.prototype.getMyID = function () {
        return this.channelCommLayer.then(function (ccomm) {
            return ccomm.getID();
        });
    };
    ChannelCommunicationService.prototype.getShareDBChat = function () { return this.chatDoc; };
    ChannelCommunicationService.prototype.getShareDBEditors = function () { return this.editorsDoc; };
    ChannelCommunicationService.prototype.getShareDBCursors = function () { return this.cursorsDoc; };
    ChannelCommunicationService.prototype.getEditorVersion = function (version) {
        if (this.cachedEditorVersions.has(version)) {
            return this.cachedEditorVersions.get(version);
        }
        else {
            var prv = this.channelCommLayer.then(function (ccomm) {
                return ccomm.pemit('get-editors-values', version);
            }).then(function (data) {
                var rv = new Map();
                _.each(data, function (x) {
                    rv.set(x.id, x);
                });
                return rv;
            });
            this.cachedEditorVersions.set(version, prv);
            return prv;
        }
    };
    /**
     * A promise that resolves when the communication channel is ready
     * @return {Promise<any>} [description]
     */
    ChannelCommunicationService.prototype.ready = function () {
        return Promise.all([this.channelCommLayer, this.editorStateTracker.ready, this.userList.ready, this.messageGroups.ready]);
    };
    /**
     * Request that the user saves a particular file
      * @param {[type]} data Information about which file to save
     */
    ChannelCommunicationService.prototype.emitSave = function (data) {
        this.emit('save', _.extend({
            sender: this.userList.getMe(),
            timestamp: this.getTimestamp()
        }, data));
    };
    /**
     * Called when the user opens a new editor window
     * @param {[type]} data Information about the editor
     */
    ChannelCommunicationService.prototype.emitEditorOpened = function (data) {
        var editorState = this.editorStateTracker.onEditorOpened(data, true);
        this.emit('editor-opened', data);
    };
    /**
     * Send chat message
     * @param {string} message The text of the message to send
     */
    ChannelCommunicationService.prototype.sendTextMessage = function (message) {
        var _this = this;
        if (!this.isObserver) {
            Promise.all([this.getMyID(), this.getShareDBChat(), this.getShareDBEditors()]).then(function (info) {
                var myID = info[0];
                var chatDoc = info[1];
                var editorsDoc = info[2];
                var data = {
                    uid: myID,
                    type: 'text',
                    message: message,
                    timestamp: _this.getTimestamp(),
                    editorsVersion: editorsDoc.version
                };
                chatDoc.submitOp([{ p: ['messages', chatDoc.data.messages.length], li: data }]);
            });
        }
    };
    /**
     * Update typing status to either:
     * - 'IDLE' - The user is not typing anything
     * - 'ACTIVE_TYPING' - The user is actively typing
     * - 'IDLE_TYPED' - The user typed something but hasn't sent it or updated for a while
     * @param {string} status IDLE, ACTIVE_TYPING, or IDLE_TYPED
     */
    ChannelCommunicationService.prototype.sendTypingStatus = function (status) {
        if (!this.isObserver) {
            Promise.all([this.getMyID(), this.getShareDBChat()]).then(function (info) {
                var myID = info[0];
                var doc = info[1];
                var oldValue = doc.data['activeUsers'][myID]['info']['typingStatus'];
                doc.submitOp([{ p: ['activeUsers', myID, 'info', 'typingStatus'], od: oldValue, oi: status }]);
            });
        }
    };
    /**
     * The user modified something in the editor
     * @param {[type]} serializedDelta       The change
     * @param {[type]} remote=true whether the change was made by a remote client or on the editor
     */
    ChannelCommunicationService.prototype.emitEditorChanged = function (serializedDelta, remote) {
        var _this = this;
        if (remote === void 0) { remote = true; }
        this.channelCommLayer.then(function (ccomm) {
            var myID = ccomm.getID();
            _.extend(serializedDelta, {
                timestamp: _this.getTimestamp(),
                uid: myID,
                remote: remote
            });
            return ccomm.pemit('editor-event', serializedDelta);
        });
    };
    /**
     * The cursor position for the user changed
     * @param {[type]} delta       Information about the cursor position
     * @param {[type]} remote=true Whether this was from a remote user
     */
    ChannelCommunicationService.prototype.onCursorPositionChanged = function (delta) {
        if (!this.isObserver) {
            Promise.all([this.getMyID(), this.getShareDBCursors()]).then(function (info) {
                var myID = info[0];
                var doc = info[1];
                var editorID = delta.editorID;
                if (_.has(doc.data, editorID)) {
                    doc.submitOp({ p: [editorID, 'userCursors', myID], oi: delta, od: doc.data[editorID]['userCursors'][myID] });
                }
                else {
                    var oi = { 'userCursors': {}, 'userSelections': {} };
                    oi['userCursors'][myID] = delta;
                    doc.submitOp({ p: [editorID], oi: oi });
                }
            });
        }
    };
    /**
     * The selected content for the user has changed
     * @param {[type]} delta       Information about the selection
     * @param {[type]} remote=true Whether this was from a remote user
     */
    ChannelCommunicationService.prototype.onCursorSelectionChanged = function (delta) {
        if (!this.isObserver) {
            Promise.all([this.getMyID(), this.getShareDBCursors()]).then(function (info) {
                var myID = info[0];
                var doc = info[1];
                var editorID = delta.editorID;
                if (_.has(doc.data, editorID)) {
                    doc.submitOp({ p: [editorID, 'userSelections', myID], oi: delta, od: doc.data[editorID]['userSelections'][myID] });
                }
                else {
                    var oi = { 'userCursors': {}, 'userSelections': {} };
                    oi['userSelections'][myID] = delta;
                    doc.submitOp({ p: [editorID], oi: oi });
                }
            });
        }
    };
    /**
     * Called when the terminal outputs something
     * @param {[type]} data         Information about what the terminal outputted
     * @param {[type]} remote=false Whether this was outputted by a remote client
     */
    ChannelCommunicationService.prototype.emitTerminalData = function (data, remote) {
        var _this = this;
        if (remote === void 0) { remote = false; }
        this.channelCommLayer.then(function (ccomm) {
            return ccomm.pemit('terminal-data', {
                timestamp: _this.getTimestamp(),
                data: data,
                remote: remote
            });
        });
    };
    ;
    ChannelCommunicationService.prototype.writeToTerminal = function (data) {
        var _this = this;
        this.channelCommLayer.then(function (ccomm) {
            return ccomm.pemit('write-to-terminal', {
                timestamp: _this.getTimestamp(),
                uid: _this.myID,
                remote: true,
                contents: data
            });
        });
    };
    ChannelCommunicationService.prototype.getURL = function () { return "https://chat.codes/" + this.getChannelName(); };
    ChannelCommunicationService.prototype.destroy = function () {
        this.channelCommLayer.then(function (ccomm) {
            ccomm.destroy();
        });
    };
    ChannelCommunicationService.prototype.getActiveEditors = function () {
        return this.editorStateTracker.getActiveEditors();
    };
    /**
     * Get the current timestamp (as milliseconds since Jan 1 1970)
     * @return {number} The timestamp
     */
    ChannelCommunicationService.prototype.getTimestamp = function () {
        return new Date().getTime();
    };
    ;
    ChannelCommunicationService.prototype.getChannelName = function () {
        return this.channelName;
    };
    ChannelCommunicationService.prototype.getIsObserver = function () {
        return this.isObserver;
    };
    return ChannelCommunicationService;
}(event_1.EventEmitter));
exports.ChannelCommunicationService = ChannelCommunicationService;
/* A class to create and manage ChannelCommunicationService instances */
var CommunicationService = (function () {
    function CommunicationService(authInfo, EditorWrapperClass) {
        this.EditorWrapperClass = EditorWrapperClass;
        this.clients = {}; // Maps channel names to channel comms
        this.commLayer = new socket_communication_layer_1.WebSocketCommunicationLayer(authInfo);
        // // if(USE_PUSHER) {
        // //     this.commLayer = new PusherCommunicationLayer(authInfo);
        // // } else {
        //     // this.commLayer = new WebSocketCommunicationLayer(authInfo);
        // }
    }
    /**
     * Create a new channel and supply the name
     * @param  {string}                      channelName The name of the channel
     * @return {ChannelCommunicationService}             The communication channel
     */
    CommunicationService.prototype.createChannelWithName = function (channelName, channelID, isObserver) {
        if (channelID === void 0) { channelID = null; }
        if (isObserver === void 0) { isObserver = false; }
        var channel = new ChannelCommunicationService(this, channelName, channelID, isObserver, this.EditorWrapperClass);
        this.clients[channelName] = channel;
        return channel;
    };
    /**
     * Clean up the resources for a specific channel client
     * @param {string} name The name of the channel
     */
    CommunicationService.prototype.destroyChannel = function (name) {
        if (this.clients[name]) {
            var client = this.clients[name];
            client.destroy();
            delete this.clients[name];
        }
    };
    /**
     * Clean up resources from every client
     */
    CommunicationService.prototype.destroy = function () {
        var _this = this;
        this.commLayer.destroy();
        _.each(this.clients, function (client, name) {
            _this.destroyChannel(name);
        });
    };
    return CommunicationService;
}());
exports.CommunicationService = CommunicationService;
//# sourceMappingURL=communication-service.js.map