import {assertNoMigration} from '../migration-state.ts';
import fs from 'node:fs';import path from 'node:path';
import {rootDir} from '../store.ts';
import type {IncomingMessage,ServerResponse} from 'node:http';
import {bodyJson,sendJson} from '../../http.ts';
import {desktopHost,activeDesktopJobs} from '../storage-activity.ts';
import {cleanStorage,storageOverview,storagePolicy,setStoragePolicy} from '../storage.ts';

export function assertStorageIdle(){
 assertNoMigration();
 const host=desktopHost();
 if((host?.activeJobs?.()||0)>0||(host?.activeRequests||0)>1||activeDesktopJobs()>0)throw Error('请等待生成、识别或导出任务结束，再管理缓存');
}
export async function handleStorageApi(req:IncomingMessage,res:ServerResponse,parts:string[]){
 if(parts[0]!=='storage')return false;
 if(req.method==='GET')sendJson(res,200,{ok:true,result:parts[1]==='policy'?storagePolicy():await storageOverview(new URL(req.url||'/', 'http://local').searchParams.get('projectId')||undefined)});
 else if(req.method==='PUT'&&parts[1]==='policy')sendJson(res,200,{ok:true,result:setStoragePolicy(await bodyJson(req) as ReturnType<typeof storagePolicy>)});
 else if(req.method==='POST'&&['clean','plan'].includes(parts[1])){
  let cancelled=false;res.once('close',()=>{if(!res.writableEnded)cancelled=true});
  const body=await bodyJson(req);if(body.mode!=='all'&&body.mode!=='policy')throw Error('清理模式无效');
  const reviewedFiles=body.reviewedFiles;
  if(reviewedFiles!==undefined&&(!Array.isArray(reviewedFiles)||reviewedFiles.some(f=>!f||typeof f.path!=='string'||!Number.isFinite(f.mtime)||!Number.isFinite(f.ino))))throw Error('清理清单无效，请重新检查');
  sendJson(res,200,{ok:true,result:await cleanStorage({reviewedFiles,mode:body.mode,dryRun:parts[1]==='plan',projectId:typeof body.projectId==='string'?body.projectId:undefined,assertIdle:()=>{if(cancelled)throw Error('清理已取消');assertStorageIdle()}})});
 }else sendJson(res,404,{ok:false,error:'存储接口不存在'});
 return true;
}

let scheduled=false;let lastAttempt=0;
export function scheduleStorageMaintenance(){
 if(scheduled)return;scheduled=true;
 const timer=setInterval(()=>{
  const host=desktopHost();if(!host||host.activeRequests||host.activeJobs?.()||!storagePolicy().automatic||Date.now()-lastAttempt<86400000)return;
  try{if(Date.now()-JSON.parse(fs.readFileSync(path.join(rootDir(),'.storage-last-clean.json'),'utf8')).completedAt<86400000)return}catch{/* No prior maintenance timestamp: allow the first scheduled attempt. */}
  lastAttempt=Date.now();
  void cleanStorage({mode:'policy',assertIdle:()=>{if(host.activeRequests)throw Error('工作台正在处理请求');assertStorageIdle()}}).catch(error=>console.warn('[storage] maintenance deferred:',String(error)));
 },300_000);timer.unref();
}
