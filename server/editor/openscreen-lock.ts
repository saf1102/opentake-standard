import fs from 'node:fs';
import path from 'node:path';
import {atomicJson,readLock as legacyReadLock} from './store.ts';

type ScreenLock={clientId:string;clientName:string;acquiredAt:number;heartbeatAt:number;expiresAt:number};
export const screenLockFile=(dir:string)=>path.join(dir,'analysis','openscreen','editor-lock.json');
/** Screen windows only. The speech editor continues using its revision checks. */
export function readScreenLock(dir:string):ScreenLock|undefined {
 if(process.platform!=='darwin')return legacyReadLock(dir);
 const file=screenLockFile(dir);
 if(!fs.existsSync(file))return undefined;
 const lock=JSON.parse(fs.readFileSync(file,'utf8')) as ScreenLock;
 if(typeof lock.clientId!=='string'||!Number.isFinite(lock.expiresAt))throw Error('录屏窗口锁损坏，请重新打开工程');
 return lock.expiresAt>Date.now()?lock:undefined;
}
export function acquireScreenLock(dir:string,body:Record<string,unknown>) {
 const clientId=String(body.clientId||'');
 if(!clientId||clientId.length>200)throw Error('编辑器编号无效');
 const current=readScreenLock(dir);
 if(current&&current.clientId!==clientId&&body.takeover!==true)return {acquired:false,lock:current};
 const now=Date.now(),lock:ScreenLock={clientId,clientName:String(body.clientName||'另一个录屏窗口').slice(0,120),acquiredAt:current?.clientId===clientId?current.acquiredAt:now,heartbeatAt:now,expiresAt:now+30000};
 atomicJson(screenLockFile(dir),lock);return {acquired:true,lock};
}
