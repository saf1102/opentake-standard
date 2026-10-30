import fs from 'node:fs';
import path from 'node:path';
import type {IncomingMessage,ServerResponse} from 'node:http';
import {AGENT_MODULES,AGENT_ROWS,type AgentChoice,type AgentModule} from '../../src/studio/agent-settings.ts';
import {parseAgentChoice,validateModuleAgentChoice} from '../agent-settings.ts';
import {withAgentChoiceScope} from '../agent-runtime.ts';
import {bodyJson,sendJson} from '../http.ts';
import {atomicJson,readLock} from './store.ts';
import {readScreenLock} from './openscreen-lock.ts';
export type ProjectAgentWorkspace='spoken'|'screen';
export type ProjectAgentChoices=Partial<Record<AgentModule,AgentChoice>>;
type Document={version:1;revision:number;spoken:Record<string,AgentChoice>;screen:Record<string,AgentChoice>};
// Keep foreign-edition choices intact on disk, but only expose and execute this edition's modules.
const STORED_MODULES:Record<ProjectAgentWorkspace,readonly string[]>={spoken:['roughcut','chapters','cardPlanning','smallCard','halfDiagram','fullDiagram','captionTranslation'],screen:['screenEditing','captionTranslation']};
const visibleModules=(ids:readonly string[]):AgentModule[]=>ids.filter((id):id is AgentModule=>AGENT_MODULES.some(module=>module.id===id));
export const PROJECT_AGENT_MODULES:Record<ProjectAgentWorkspace,readonly AgentModule[]>={spoken:AGENT_ROWS.some(row=>row.group==='口播剪辑')?visibleModules(STORED_MODULES.spoken):[],screen:visibleModules(STORED_MODULES.screen)};
const visibleChoices=(document:Document,workspace:ProjectAgentWorkspace):ProjectAgentChoices=>Object.fromEntries(Object.entries(document[workspace]).filter(([id])=>PROJECT_AGENT_MODULES[workspace].includes(id as AgentModule)));
const defaultDocument=():Document=>({version:1,revision:0,spoken:{},screen:{}});
function choicesFile(dir:string){
 const folder=path.join(dir,'.opentake'),file=path.join(folder,'agent-choices.json');
 for(const target of [folder,file]){try{if(fs.lstatSync(target).isSymbolicLink())throw Error('工程智能体设置不能使用符号链接')}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error}}
 return file;
}
export function readProjectAgentDocument(dir:string):Document{
 try{if(!fs.statSync(dir).isDirectory())throw Error('不是文件夹')}catch{throw Error('工程目录不可用，请重新连接工程所在位置')}
 let value:unknown;try{value=JSON.parse(fs.readFileSync(choicesFile(dir),'utf8'))}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return defaultDocument();throw Error('工程智能体设置读不到或已损坏，原文件已保留')}
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('工程智能体设置格式不正确');
 const raw=value as Record<string,unknown>;if(raw.version!==1||!Number.isSafeInteger(raw.revision)||(raw.revision as number)<0)throw Error('工程智能体设置版本无效');
 const result:Document={version:1,revision:raw.revision as number,spoken:{},screen:{}};
 for(const workspace of ['spoken','screen'] as const){const entries=raw[workspace];if(!entries||typeof entries!=='object'||Array.isArray(entries))throw Error('工程智能体设置格式不正确');for(const [module,choice]of Object.entries(entries)){if(!STORED_MODULES[workspace].includes(module))throw Error('工程智能体设置包含未知工作项');result[workspace][module]=parseAgentChoice(choice)}}
 return result;
}
/** The choice is captured before dispatch; background promises/timers inherit this immutable request scope. */
export function withProjectAgentChoices<T>(dir:string,workspace:ProjectAgentWorkspace,work:()=>Promise<T>):Promise<T>{
 return withAgentChoiceScope(visibleChoices(readProjectAgentDocument(dir),workspace),work);
}
function assertEditable(dir:string,workspace:ProjectAgentWorkspace,clientId:unknown){
 if(typeof clientId!=='string'||!clientId.trim()||clientId.length>200)throw Error('缺少工程编辑身份，请重新打开工程');
 const lock=workspace==='screen'?readScreenLock(dir):readLock(dir);
 if(lock&&lock.clientId!==clientId)throw Error('工程正由另一个窗口编辑，不能修改智能体选择');
}
export async function writeProjectAgentChoice(dir:string,workspace:ProjectAgentWorkspace,input:Record<string,unknown>){
 if(!PROJECT_AGENT_MODULES[workspace].includes(input.module as AgentModule))throw Error('这个工作区没有该智能体工作项');
 assertEditable(dir,workspace,input.clientId);
 const original=readProjectAgentDocument(dir);if(input.revision!==original.revision)throw Error('工程智能体设置已被修改，请重新读取');
 const module=input.module as AgentModule;
 const choice=input.choice===null?undefined:await validateModuleAgentChoice(module,input.choice);
 assertEditable(dir,workspace,input.clientId);
 const current=readProjectAgentDocument(dir);if(current.revision!==original.revision)throw Error('工程智能体设置已被修改，请重新读取');
 const modules=visibleModules(workspace==='spoken'&&String(module)==='roughcut'?['roughcut','chapters']:workspace==='spoken'&&String(module)==='halfDiagram'?['halfDiagram','fullDiagram']:[module]);
 for(const key of modules){if(choice)current[workspace][key]={...choice};else delete current[workspace][key]}
 current.revision++;
 const file=choicesFile(dir);fs.mkdirSync(path.dirname(file),{recursive:true});atomicJson(file,current);return {revision:current.revision,choices:visibleChoices(current,workspace)};
}
export async function handleProjectAgentChoices(req:IncomingMessage,res:ServerResponse,parts:string[],dir:string,screenOnly=false){
 if(parts[2]!=='agent-choices')return false;
 const workspace=parts[3];if(parts.length!==4||!['spoken','screen'].includes(workspace)||screenOnly&&workspace!=='screen')throw Error('没有这个工程智能体设置');
 const scope=workspace as ProjectAgentWorkspace;
 if(req.method==='GET'){const value=readProjectAgentDocument(dir);sendJson(res,200,{ok:true,result:{revision:value.revision,choices:visibleChoices(value,scope)}});return true}
 if(req.method==='PUT'){sendJson(res,200,{ok:true,result:await writeProjectAgentChoice(dir,scope,await bodyJson(req))});return true}
 sendJson(res,405,{ok:false,error:'不支持此设置操作'});return true;
}
