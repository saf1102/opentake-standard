import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import type {IncomingMessage,ServerResponse} from 'node:http';import {bodyJson,sendJson} from '../http.ts';
import upgradeConfig from '../../upgrade.json' with {type:'json'};
export const UPGRADE_URL=upgradeConfig.endpoint;
// Public owner confirmed by S先生; an unpublished raw file fails closed to beta.
export const UPGRADE_FALLBACK_URL='https://raw.githubusercontent.com/saf1102/opentake-standard/main/upgrade.json';
const fallback=process.env.OPENTAKE_UPGRADE_FALLBACK_URL||UPGRADE_FALLBACK_URL;
const local=process.env.OPENTAKE_UPGRADE_TEST_URL;
if(local && !/^http:\/\/127\.0\.0\.1:\d+$/.test(local))throw Error('测试授权服务必须是本机地址');
const origin=local||new URL(UPGRADE_URL).origin;
const root=process.env.OPENTAKE_STANDARD_USER_DATA||path.join(os.homedir(),'Library','Application Support','OpenTake Standard');
const file=path.join(root,'upgrade-session.json');
type Saved={token?:string;daily?:boolean;checkedDay?:string};let saved:Saved={};try{saved=JSON.parse(fs.readFileSync(file,'utf8'))}catch{/* fresh profile */}
function save(){fs.mkdirSync(root,{recursive:true,mode:0o700});fs.writeFileSync(file+'.tmp',JSON.stringify(saved),{mode:0o600});fs.chmodSync(file+'.tmp',0o600);fs.renameSync(file+'.tmp',file)}
async function remote(route:string,method='GET',body?:unknown){const r=await fetch(origin+route,{method,headers:{'Content-Type':'application/json',...(saved.token?{Authorization:`Bearer ${saved.token}`}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(10000)});const value=await r.json();if(!r.ok){if(r.status===401){delete saved.token;save()}throw Object.assign(Error(value.error||'操作失败'),{status:r.status})}return value}
async function config(){for(const url of [local?local+'/standard/upgrade.json':UPGRADE_URL,fallback]){if(!url)continue;try{const r=await fetch(url,{credentials:'omit',referrerPolicy:'no-referrer',signal:AbortSignal.timeout(5000)});if(!r.ok)continue;const v=await r.json();if(v.mode==='beta'||v.mode==='paid'&&Array.isArray(v.plans)&&v.plans.length===3)return v}catch{/* offline default */}}return {mode:'beta',notice:''}}
function publicView(value:Record<string,unknown>){const {token:_token,...rest}=value;return rest}
export async function upgradeApi(req:IncomingMessage,res:ServerResponse){const route=new URL(req.url||'/','http://localhost').pathname.replace('/api/upgrade','');try{
 if(req.method==='GET'&&route==='/preferences')return sendJson(res,200,{daily:saved.daily!==false});
 if(req.method==='PUT'&&route==='/preferences'){const b=await bodyJson(req) as {daily?:boolean};saved.daily=b.daily!==false;save();return sendJson(res,200,{daily:saved.daily})}
 if(req.method==='GET'&&(route==='/state'||route==='/daily')){const day=new Date().toLocaleDateString('en-CA');if(route==='/daily'&&(saved.daily===false||saved.checkedDay===day))return sendJson(res,200,{skipped:true});const upgrade=await config();let account=null,error='';if(saved.token)try{account=publicView(await remote('/api/me'))}catch(e){error=e instanceof Error?e.message:'状态检查失败'}saved.checkedDay=day;save();return sendJson(res,200,{upgrade,account,error})}
 if(req.method==='POST'&&(route==='/apply'||route==='/login')){const input=await bodyJson(req);const result=await remote(route==='/apply'?'/api/standard/apply':'/api/login','POST',{...input,...(route==='/login'?{scope:'standard'}:{}),device:'电脑 · '+(process.platform==='darwin'?'macOS':process.platform)});saved.token=result.token;save();return sendJson(res,200,publicView(result))}
 if(req.method==='PUT'&&route==='/intent')return sendJson(res,200,await remote('/api/pro/intent','PUT',await bodyJson(req)));
 if(req.method==='POST'&&route==='/logout'){try{await remote('/api/logout','POST')}finally{delete saved.token;save()}return sendJson(res,200,{ok:true})}
 if(req.method==='GET'&&route==='/download'){const value=await remote('/api/me');if(!value.downloadUrl)throw Error(value.downloadMessage||'当前账号没有可用下载');const u=new URL(value.downloadUrl,origin);if(u.origin!==origin||!u.pathname.startsWith('/releases/'))throw Error('下载地址无效');res.writeHead(302,{Location:u.href,'Referrer-Policy':'no-referrer','Cache-Control':'no-store'});return res.end()}
 return sendJson(res,404,{error:'接口不存在'});
 }catch(e){return sendJson(res,(e as {status?:number}).status||503,{error:e instanceof Error?e.message:'服务暂时不可用'})}}
