import type {IncomingMessage,ServerResponse} from 'node:http';
import {activeGeneralRuns} from '../general/runner.ts';
import {activeGeneralExports} from '../general/export.ts';
import {activeOpenScreenExports} from './openscreen-export.ts';
let activeRequests=0;
/** Keep uploads and document writes visible to the shared storage idle guard. */
export function trackStorageRequest(req:IncomingMessage,res:ServerResponse){
 if(process.platform!=='darwin'||['GET','HEAD','OPTIONS'].includes(req.method||'GET'))return;
 activeRequests++;let released=false;const release=()=>{if(!released){released=true;activeRequests--;}};res.once('finish',release);res.once('close',release);
}
export const activeDesktopJobs=()=>activeGeneralRuns()+activeGeneralExports()+activeOpenScreenExports();
export const desktopHost=()=>({activeRequests,activeJobs:activeDesktopJobs});
