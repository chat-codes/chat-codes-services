export class EventEmitter {
    private eventListeners:Map<string, any > = new Map();
    constructor() { }
    public on(event:string, listener:any):Listener {
        if (!this.eventListeners.has(event)) {
            this.eventListeners.set(event, [listener]);
        }
        else {
            this.eventListeners.get(event).push(listener);
        }
        return new Listener(this, event, listener);
    }
    public addListener(event, listener):Listener {
        return this.on(event, listener);
    }
    public removeListener(...args):void {
        if (args.length == 0) {
            this.eventListeners.clear();
        }
        else if (args.length == 1 && typeof args[0] == 'object') {
            const {id} = args[0];
            this.removeListener(id.event, id.listener);
        }
        else if (arguments.length >= 1) {
            const [event, listener] = args;
            if (this.eventListeners.has(event)) {
                let listeners = this.eventListeners.get(event);
                let idx;
                while (!listener || (idx = listeners.indexOf(listener)) != -1) {
                    listeners.splice(idx, 1);
                }
            }
        }
    }
    /**
     * Emit event. Calls all bound listeners with args.
     */
    public emit(event, ...args) {
        if (this.eventListeners.has(event)) {
            for (let listener of this.eventListeners.get(event)) {
                listener(...args);
            }
        }
    }
    /**
     * @typeparam T The event handler signature.
     */
    public registerEvent() {
        let eventBinder = (handler) => {
            return this.addListener(eventBinder, handler);
        };
        return eventBinder;
    }
}

class Listener {
    constructor(private owner:EventEmitter, private event:string, private listener:() => any) {
    }
    public unbind() {
        this.owner.removeListener(this);
    }
}
