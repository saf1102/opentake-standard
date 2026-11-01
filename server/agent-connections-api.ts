import {compareRecentAgentFilms} from './agent-comparison.ts';
import {getAgentDiagnostics,setAgentProgramPath,agentManagement} from './agent-management.ts';
import type {IncomingMessage,ServerResponse} from 'node:http';
import {z} from 'zod';
import {bodyJson,sendJson} from './http.ts';
import {CONNECTION_IDS,connectionDefinition} from '../shared/agent-connections.ts';
import {listAgentConnections,getConnectionStatus,saveAgentConnection,testUnifiedConnection,testTransientConnection,refreshConnectionModels,deleteConnectionKey,refreshAgentConnection,onAgentConnectionStatusChanged,getConnectionConfig} from './agent-connections.ts';
import {agentLoginManager} from './agent-login.ts';
/** 只有本机同源页面可写密钥、测试网络或启用命令行。两个版本只在可见范围上不同。 */
export async function handleAgentConnectionsApi(req:IncomingMessage,res:ServerResponse,parts:string[],includeServices=true){
 if(parts[0]!=='agent-connections')return false;
 const reply=(status:number,value:unknown)=>{sendJson(res,status,value);return true;};
 if(!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress||''))return reply(403,{ok:false,error:'统一接入只允许在本机操作'});
 if(req.headers.origin){let host='';try{host=new URL(req.headers.origin).host}catch{}if(host!==req.headers.host)return reply(403,{ok:false,error:'不允许跨站修改接入'});}
 try{
  if(parts.length===2&&parts[1]==='events'&&req.method==='GET'){
   res.statusCode=200;res.setHeader('Content-Type','text/event-stream; charset=utf-8');res.setHeader('Cache-Control','no-cache');res.setHeader('X-Accel-Buffering','no');res.flushHeaders();
   res.write(': connected\n\n');
   // Only the provider ID and revision cross the stream; no provider output or account data.
   const unsubscribe=onAgentConnectionStatusChanged(({id,revision})=>{if(includeServices||connectionDefinition(id).kind==='agent'){const event=getConnectionConfig(id).authRejectedAt?'credentials-rejected':'connection-changed';res.write(`event: ${event}\ndata: ${JSON.stringify({id,revision})}\n\n`)}});
   const heartbeat=setInterval(()=>res.write(': keepalive\n\n'),25000);heartbeat.unref();
   res.once('close',()=>{clearInterval(heartbeat);unsubscribe()});
   return true;
  }
  if(parts.length===2&&parts[1]==='usage'&&req.method==='GET')return reply(200,{ok:true,result:compareRecentAgentFilms()});
  if(parts.length===1&&req.method==='GET')return reply(200,{ok:true,result:await listAgentConnections(includeServices)});
  const id=z.enum(CONNECTION_IDS).parse(parts[1]);if(!includeServices&&connectionDefinition(id).kind==='service')return reply(404,{ok:false,error:'标准版不提供此服务'});
  let result:unknown;
  if(parts.length===3&&parts[2]==='diagnostics'&&req.method==='GET')result=getAgentDiagnostics(id);
  else if(parts.length===3&&parts[2]==='program'&&req.method==='PUT'){const body=z.object({cliPath:z.string().max(4096)}).strict().parse(await bodyJson(req));result=await setAgentProgramPath(id,body.cliPath);}
  else if(parts.length===3&&['install','logout','switch-account','upgrade'].includes(parts[2])&&req.method==='POST'){const body=z.object({command:z.string().optional()}).strict().parse(await bodyJson(req));result=await agentManagement.start(id,parts[2] as 'install'|'logout'|'switch-account'|'upgrade',body);}
  else if(parts.length===3&&parts[2]==='management'&&req.method==='GET')result=await agentManagement.check(id);
  else if(parts.length===3&&parts[2]==='management'&&req.method==='DELETE')result=await agentManagement.cancel(id);
  else if(parts.length===2&&req.method==='GET')result=await getConnectionStatus(id);
  else if(parts.length===2&&req.method==='PUT')result=await saveAgentConnection(id,await bodyJson(req));
  else if(parts.length===3&&parts[2]==='recheck'&&req.method==='POST')result=await refreshAgentConnection(id);
  else if(parts.length===3&&parts[2]==='login'&&req.method==='POST')result=await agentLoginManager.start(id);
  else if(parts.length===3&&parts[2]==='login'&&req.method==='GET')result=await agentLoginManager.check(id);
  else if(parts.length===3&&parts[2]==='login'&&req.method==='DELETE')result=await agentLoginManager.cancel(id);
  else if(parts.length===3&&parts[2]==='test'&&req.method==='POST'){const body=await bodyJson(req,16384);result=body.transient===true?await testTransientConnection(id,body):await testUnifiedConnection(id);}
  else if(parts.length===3&&parts[2]==='models'&&req.method==='POST')result=await refreshConnectionModels(id);
  else if(parts.length===3&&parts[2]==='key'&&req.method==='DELETE')result=await deleteConnectionKey(id);
  else return reply(405,{ok:false,error:'接入操作不存在'});
  return reply(200,{ok:true,result});
 }catch(error){return reply(400,{ok:false,error:error instanceof z.ZodError?'接入参数不正确':error instanceof Error?error.message:'接入操作失败'});}
}
