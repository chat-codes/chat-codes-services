export interface CommunicationLayer {
	trigger(channelName:string, eventName:string, eventContents:any):void;
	bind(channelName:string, eventName:string, callback:(any)=>any):void;
	getMembers(channelName:string):Promise<any>;
	channelNameAvailable(channelName:string):Promise<boolean>;
	// onMemberAdded(channelName:string, callback:(event)=>any):void;
	// onMemberRemoved(channelName:string, callback:(event)=>any);
	channelReady(channelName:string):Promise<any>;
	destroy():void;
}