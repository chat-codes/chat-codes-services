"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var EventEmitter = (function () {
    function EventEmitter() {
        this.eventListeners = new Map();
    }
    EventEmitter.prototype.on = function (event, listener) {
        if (!this.eventListeners.has(event)) {
            this.eventListeners.set(event, [listener]);
        }
        else {
            this.eventListeners.get(event).push(listener);
        }
        return new Listener(this, event, listener);
    };
    EventEmitter.prototype.addListener = function (event, listener) {
        return this.on(event, listener);
    };
    EventEmitter.prototype.removeListener = function () {
        var args = [];
        for (var _i = 0; _i < arguments.length; _i++) {
            args[_i] = arguments[_i];
        }
        if (args.length == 0) {
            this.eventListeners.clear();
        }
        else if (args.length == 1 && typeof args[0] == 'object') {
            var id = args[0].id;
            this.removeListener(id.event, id.listener);
        }
        else if (arguments.length >= 1) {
            var event_1 = args[0], listener = args[1];
            if (this.eventListeners.has(event_1)) {
                var listeners = this.eventListeners.get(event_1);
                var idx = void 0;
                while (!listener || (idx = listeners.indexOf(listener)) != -1) {
                    listeners.splice(idx, 1);
                }
            }
        }
    };
    /**
     * Emit event. Calls all bound listeners with args.
     */
    EventEmitter.prototype.emit = function (event) {
        var args = [];
        for (var _i = 1; _i < arguments.length; _i++) {
            args[_i - 1] = arguments[_i];
        }
        if (this.eventListeners.has(event)) {
            for (var _a = 0, _b = this.eventListeners.get(event); _a < _b.length; _a++) {
                var listener = _b[_a];
                listener.apply(void 0, args);
            }
        }
    };
    /**
     * @typeparam T The event handler signature.
     */
    EventEmitter.prototype.registerEvent = function () {
        var _this = this;
        var eventBinder = function (handler) {
            return _this.addListener(eventBinder, handler);
        };
        return eventBinder;
    };
    return EventEmitter;
}());
exports.EventEmitter = EventEmitter;
var Listener = (function () {
    function Listener(owner, event, listener) {
        this.owner = owner;
        this.event = event;
        this.listener = listener;
    }
    Listener.prototype.unbind = function () {
        this.owner.removeListener(this);
    };
    return Listener;
}());
//# sourceMappingURL=event.js.map