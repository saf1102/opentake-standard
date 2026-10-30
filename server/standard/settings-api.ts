import {handleAgentConnectionsApi} from '../agent-connections-api.ts';
/** Standard 路由装配；组件、检测、保存和连接测试均使用共有实现。 */
import type {IncomingMessage,ServerResponse} from 'node:http';
import {bodyJson,sendJson} from '../http.ts';
import {handleSystemSettingsApi} from '../editor/api/system-settings.ts';
import {agentSettingsView,saveAgentSettings,saveModuleAgentChoice,getAgentCatalog,chooseAgentCli} from '../agent-settings.ts';
import {testAgentConnection} from '../agent-connectivity.ts';
import {agentInstallationStatus,saveAgentInstallation,openCodexTerminal} from '../agent-installations.ts';
import {generalAgentOnboardingSeen,markGeneralAgentOnboardingSeen,markOnboardingSeen,onboardingSeen,openSystemPane,runOnboardingCheck} from '../onboarding.ts';
export async function handleSharedSettings(req:IncomingMessage,res:ServerResponse,parts:string[]){
 if(await handleAgentConnectionsApi(req,res,parts,false))return true;
 if(await handleSystemSettingsApi(req,res,parts))return true;
 const reply=(result:unknown)=>{sendJson(res,200,{ok:true,result});return true;};
 if(parts[0]==='onboarding'){
  if(parts[1]==='general-choice'&&req.method==='GET')return reply(generalAgentOnboardingSeen());
  if(parts[1]==='general-choice'&&req.method==='POST')return reply(markGeneralAgentOnboardingSeen());
  if(parts[1]==='seen'&&req.method==='GET')return reply(onboardingSeen());
  if(parts[1]==='seen'&&req.method==='POST')return reply(markOnboardingSeen());
  if(parts[1]==='system'&&parts[2]==='screen-recording'&&req.method==='POST')return reply(await openSystemPane(parts[2]));
  if(parts.length===2&&['agent','disk','openscreen'].includes(parts[1])&&req.method==='GET')return reply(await runOnboardingCheck(parts[1]));
  sendJson(res,404,{ok:false,error:'标准版不提供这一部署项'});return true;
 }
 if(parts[0]!=='agent-settings')return false;
 if(parts[1]==='module'&&parts[2]&&req.method==='PUT')return reply(await saveModuleAgentChoice(parts[2] as Parameters<typeof saveModuleAgentChoice>[0],await bodyJson(req)));
 if(parts.length===1&&req.method==='GET')return reply(await agentSettingsView());
 if(parts.length===1&&req.method==='PUT')return reply(await saveAgentSettings(await bodyJson(req)));
 if(parts[1]==='catalog'&&req.method==='POST'){const b=await bodyJson(req);if(typeof b.cliPath!=='string')throw Error('CLI 路径必须为文本');return reply(await getAgentCatalog(b.cliPath,true));}
 if(parts[1]==='choose-cli'&&req.method==='POST')return reply(await chooseAgentCli());
 if(parts[1]==='test'&&req.method==='POST')return reply(await testAgentConnection(await bodyJson(req)));
 if(parts[1]==='installation'&&parts[2]==='codex'){
  if(parts.length===3&&req.method==='GET')return reply(await agentInstallationStatus('codex'));
  if(parts.length===3&&['PUT','POST'].includes(req.method||'')){const b=await bodyJson(req);if(typeof b.cliPath!=='string')throw Error('CLI 路径必须为文本');return reply(await (req.method==='PUT'?saveAgentInstallation('codex',b.cliPath):agentInstallationStatus('codex',b.cliPath)));}
  if(req.method==='POST'&&['login','install'].includes(parts[3]))return reply(await openCodexTerminal(parts[3] as 'login'|'install',await bodyJson(req)));
 }
 sendJson(res,404,{ok:false,error:'标准版仅提供 Codex 设置'});return true;
}
