import * as _ from 'underscore';
import { EventEmitter } from 'events';
import { ChannelCommunicationService } from './communication-service';

/*
 * Represents a single chat user
 */
export class ChatUser extends EventEmitter {
    /**
     * constructor
     * @param  {boolean} isMe       Whether the user is me or not
     * @param  {string}  id         The unique id
     * @param  {string}  name       The display name
     * @param  {boolean} active     Whether this user is currently in the channel
     * @param  {number}  colorIndex The user's color
     */
    constructor(private isMe:boolean, private id:string, private name:string, private active:boolean, private joined:number, private left:number, private colorIndex:number) {
        super();
    }
    private typingStatus:string='IDLE';
    public getIsMe():boolean { return this.isMe; };
    public isActive():boolean { return this.active; };
    public getID():string { return this.id; }
    public getName():string { return this.name; }
    public getColorIndex():number { return this.colorIndex; };
    public setIsActive(active:boolean):void { this.active = active; };
    public getTypingStatus():string { return this.typingStatus; };

    public setLeft(ts:number) { this.left = ts; };
    public getLeft():number { return this.left; };
    public getJoined():number { return this.joined; };

    public setTypingStatus(status:string) {
        this.typingStatus = status;
        (this as any).emit('typingStatus', {
            status: status
        });
    }
    public serialize() {
        return {
            id: this.id,
            name: this.name,
            typingStatus: this.typingStatus,
            active: this.active
        };
    }
}

export class ChatUserList extends EventEmitter {
    public activeUsers:Array<ChatUser>=[];
    public allUsers:Array<ChatUser>=[];
    private current_user_color:number = 2;
    private numColors:number = 4;
    private chatDocPromise:Promise<any>;
    constructor(private myIDPromise:Promise<string>, private channelService:ChannelCommunicationService) {
        super();
        this.chatDocPromise = this.channelService.getShareDBChat();
        Promise.all([this.chatDocPromise, this.myIDPromise]).then((info) => {
            const [doc, myID] = info;
            _.each(doc.data.allUsers, (userInfo:any) => {
                const {id, joined, left, info} = userInfo;
                const {name} = info;

                this.add(id === myID, id, name, joined, left, _.has(doc.data.activeUsers, id))
            });
            doc.on('op', (ops, source) => {
                ops.forEach((op) => {
                    const {p} = op;
                    const [field] = p;
                    console.log(op);
                    if(field === 'activeUsers') {
                        if(_.has(op, 'od')) {
                            const {od} = op;
                            const user = this.getUser(od.id);
                            user.setLeft(od.left);
                            this.remove(od.id);
                        }

                        if(_.has(op, 'oi')) {
                            const {oi} = op;

                            const {id, joined, left, info} = oi;
                            const {name} = info;

                            this.add(id === myID, id, name, joined, left, _.has(doc.data.activeUsers, id))
                        }
                    }
                });
            });
        });
    }
    public getUsers():Array<ChatUser> {
        return this.activeUsers;
    }
    // public addAll(memberInfo):void {
    //     const myID = memberInfo.myID;
    //     _.each(memberInfo.members, (memberInfo:any, id:string) => {
    //         this.add(id===myID, id, memberInfo.name);
    //     });
    // }
    public add(isMe:boolean, id:string, name:string, joined:number, left:number, active:boolean=true):ChatUser {
        let user:ChatUser = this.getUser(id);
        if(user === null) {
            const colorIndex = isMe ? 1 : this.current_user_color;
            this.current_user_color = 2+((this.current_user_color+1)%this.numColors);

            user = new ChatUser(isMe, id, name, active, joined, left, colorIndex);
            if(active) {
                this.activeUsers.push(user);
            }
            this.allUsers.push(user);
            (this as any).emit('userAdded', {
                user: user
            });
        }
        return user;
    }
    public hasUser(id:string):boolean {
        return this.getUser(id) !== null;
    }

    /**
     * Remove a user from the list of users
     * @param {string} id The user's ID
     */
    public remove(id:string):ChatUser {
        for(var i = 0; i<this.activeUsers.length; i++) {
            const user:ChatUser = this.activeUsers[i];
            var id_i = user.getID();
            if(id_i === id) {
                user.setIsActive(false);

                this.activeUsers.splice(i, 1);
                (this as any).emit('userRemoved', {
                    id: id
                });
                return user;
            }
        }
        return null;
    }

    public getUser(id:string):ChatUser {
        for(var i = 0; i<this.allUsers.length; i++) {
            var id_i = this.allUsers[i].getID();
            if(id_i === id) {
                return this.allUsers[i];
            }
        }
        return null;
    }

    public getMe():ChatUser {
        for(var i = 0; i<this.allUsers.length; i++) {
            if(this.allUsers[i].getIsMe()) {
                return this.allUsers[i];
            }
        }
        return null;
    }
    serialize() {
        return _.map(this.allUsers, (u) => { return u.serialize() } );
    }
}
