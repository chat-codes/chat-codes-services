import * as _ from 'underscore';
import { EventEmitter } from 'events';

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
    constructor(public isMe:boolean, public id:string, public name:string, public active:boolean, public colorIndex:number) {
        super();
    }
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

export class ChatUserList extends EventEmitter {
    public activeUsers:Array<ChatUser>=[];
    public allUsers:Array<ChatUser>=[];
    private current_user_color:number = 2;
    private numColors:number = 4;
    constructor() {
        super();
    }
    public getUsers():Array<ChatUser> {
        return this.activeUsers;
    }
    public addAll(memberInfo):void {
        const myID = memberInfo.myID;
        _.each(memberInfo.members, (memberInfo, id) => {
            this.add(id===myID, id, memberInfo.name);
        });
    }
    public add(isMe:boolean, id:string, name:string, active:boolean=true):ChatUser {
        let user:ChatUser = this.getUser(id);
        if(user === null) {
            const colorIndex = isMe ? 1 : this.current_user_color;
            this.current_user_color = 2+((this.current_user_color+1)%this.numColors);

            user = new ChatUser(isMe, id, name, active, colorIndex);
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
