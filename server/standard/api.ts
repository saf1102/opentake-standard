import {upgradeApi} from './upgrade.ts';
import type {IncomingMessage,ServerResponse} from 'node:http';import {handleGeneralApi} from '../general/api.ts';import {bodyJson,sendJson} from '../http.ts';import {agentSettingsView,saveAgentSettings} from '../agent-settings.ts';import {handleEditorApi} from './openscreen-api.ts';
export async function standardApi(req:IncomingMessage,res:ServerResponse,next:()=>void){
 const url=new URL(req.url||'/','http://localhost');
 // The upstream editor addresses bundled assets at the origin root. Keep
 // those same-origin routes working in both dev and the packaged App.
 if (/^\/(wallpapers|cursors|wasm)(?:\/|$)/.test(url.pathname)) {res.writeHead(307,{Location:'/openscreen'+url.pathname+url.search});return res.end()}
 if(!url.pathname.startsWith('/api/'))return next();
 // Vite only binds loopback. Reject cross-site writes to the local filesystem service.
 const origin=req.headers.origin;if(origin&&origin!==`http://${req.headers.host}`&&origin!==`https://${req.headers.host}`)return sendJson(res,403,{ok:false,error:'不接受跨站请求'});
 try{if(url.pathname.startsWith('/api/upgrade/'))return await upgradeApi(req,res);if(url.pathname.startsWith('/api/general/')){req.url=req.url!.slice('/api/general'.length);return await handleGeneralApi(req,res)}
 if(url.pathname.startsWith('/api/editor/'))return await handleEditorApi(req,res);
 if(url.pathname==='/api/agent-settings'){const result=req.method==='PUT'?await saveAgentSettings(await bodyJson(req)):req.method==='GET'?await agentSettingsView():undefined;if(result)return sendJson(res,200,{ok:true,result});}
 return sendJson(res,404,{ok:false,error:'Standard 没有这个接口'});
 }catch(e){if(!res.headersSent)sendJson(res,500,{ok:false,error:e instanceof Error?e.message:String(e)});else res.destroy()}
}
