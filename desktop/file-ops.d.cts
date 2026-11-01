export function retrySync<T>(operation:()=>T):T;
export function renameWithRetrySync(from:string,to:string):void;
export function atomicWriteFileSync(file:string,data:string|NodeJS.ArrayBufferView,options?:{mode?:number;encoding?:BufferEncoding}):void;
export function atomicJsonSync(file:string,value:unknown,options?:{mode?:number;indent?:number}):void;
export function removeWithRetrySync(target:string,options?:{recursive?:boolean;force?:boolean}):void;
export function cleanupPathSync(target:string,options?:{recursive?:boolean;force?:boolean}):Error|undefined;
