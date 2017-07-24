import * as _ from 'underscore';
import { EventEmitter } from 'events';

export class ChatUserList extends EventEmitter {
    public activeUsers:Array<ChatUser>=[];
    public allUsers:Array<ChatUser>=[];
    constructor() {
        super();
    }
    public getUsers():Array<ChatUser> {
        return this.activeUsers;
    }
    public addAll(memberInfo) {
        const myID = memberInfo.myID;
        _.each(memberInfo.members, (memberInfo, id) => {
            this.add(id===myID, id, memberInfo.name);
        });
    }
    public add(isMe:boolean, id:string, name:string, active:boolean=true):ChatUser {
        var user = this.hasUser(id);
        if(!user) {
            user = new ChatUser(isMe, id, name, active);
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
    public hasUser(id:string) {
        for(var i = 0; i<this.allUsers.length; i++) {
            var id_i = this.allUsers[i].id;
            if(id_i === id) {
                return this.allUsers[i];
            }
        }
        return false;
    }

    public remove(id:string):void {
        for(var i = 0; i<this.activeUsers.length; i++) {
            var id_i = this.activeUsers[i].id;
            if(id_i === id) {
                this.activeUsers[i].active = false;
                this.activeUsers.splice(i, 1);
                (this as any).emit('userRemoved', {
                    id: id
                });
                break;
            }
        }
    }

    public getUser(id:string):ChatUser {
        for(var i = 0; i<this.allUsers.length; i++) {
            var id_i = this.allUsers[i].id;
            if(id_i === id) {
                return this.allUsers[i];
            }
        }
        return null;
    }
    public getMe():ChatUser {
        for(var i = 0; i<this.allUsers.length; i++) {
            if(this.allUsers[i].isMe) {
                return this.allUsers[i];
            }
        }
        return null;
    }
    serialize() {
        return _.map(this.allUsers, (u) => { return u.serialize() } );
    }
}

let current_user_color:number = 2;
export class ChatUser extends EventEmitter {
    constructor(public isMe:boolean, public id:string, public name:string, public active:boolean) {
        super();
        this.colorIndex = isMe ? 1 : current_user_color;
        current_user_color = 2+((current_user_color+1)%this.numColors);
    }
    private numColors:number = 4;
    public colorIndex:number;
    public typingStatus:string='IDLE';
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