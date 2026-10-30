import type {GeneralAgentChoice} from '../src/general/general-contract.ts';
import {filmAgentId} from './general/agent-adapter.ts';
import {getConnectionConfig,resolveAgentConnectionLaunch,assertAgentExecutionAllowed} from './agent-connections.ts';
import {readAgentSettings,resolveCliPath} from './agent-settings.ts';
import {standardEdition} from './general/edition.ts';
import {createRequire} from 'node:module';
import type {CreationTools,EnvironmentCheck} from '../shared/creation-tools.ts';
const checker = createRequire(import.meta.url)('../desktop/creation-tools.cjs') as {doctor:(options:{codexPath?:()=>string;onlyCodex:boolean;agentLabel?:string;agentCheck?:()=>Promise<{id:string;executable:string}>})=>Promise<EnvironmentCheck>};
/** Settings uses the default agent; generation passes the project's own choice. No agent task is run here. */
export async function checkCreationEnvironment(choice?:GeneralAgentChoice):Promise<EnvironmentCheck> {
 const selected=choice ?? readAgentSettings().modules.generalEditing;
 const id=filmAgentId(selected);
 const api=id==='codex' && getConnectionConfig(id).mode==='api';
 if(id==='codex' && !api)return checker.doctor({codexPath:()=>resolveCliPath(getConnectionConfig('codex').cliPath||undefined),onlyCodex:!standardEdition});
 const result=await checker.doctor({onlyCodex:!standardEdition,agentLabel:id==='claude'?'Claude Code 接入':'Codex API 接入',agentCheck:async()=>{
  assertAgentExecutionAllowed(id);const launch=await resolveAgentConnectionLaunch(id);return {id,executable:launch.executable};
 }});
 // Legacy tools consumers retain their Codex field; Claude never borrows that executable.
 if(result.tools && !result.tools.codex)result.tools.codex=id==='codex'?result.tools.agent?.executable||'':'';
 return result;
}
export async function requireCreationTools(choice?:GeneralAgentChoice):Promise<CreationTools> {
 const result = await checkCreationEnvironment(choice);
 if(!result.ok || !result.tools) throw Object.assign(Error(result.items.filter(i=>!i.ok).map(i=>`${i.label}：${i.message}\n${i.install||'请到设置检查智能体接入后重试。'}`).join('\n\n')),{status:412,environment:result});
 return result.tools;
}
