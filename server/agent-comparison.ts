/** 第二部分只提供后端数据；没有提供用量的智能体保留未知，不把未知记为零。 */
import fs from 'node:fs';
import path from 'node:path';
import {AGENT_CONNECTION_IDS,connectionDefinition,type AgentConnectionId} from '../shared/agent-connections.ts';
import {agentSettingsFile} from './agent-settings.ts';

type Usage={total?:number;input:number;cached:number;output:number;reasoning:number};
type Comparison={agent:AgentConnectionId;name:string;calls:number;completed:number;failed:number;durationMs:number;usage:Usage|null;usageComplete:boolean;transports:string[]};
const usageKeys=['input','cached','output','reasoning'] as const;
export function compareProjectAgentRuns(projectId:string,folder=path.join(path.dirname(agentSettingsFile()),'agent-runs')):Comparison[]{
 const groups=new Map<AgentConnectionId,Comparison>();
 if(!fs.existsSync(folder))return [];
 for(const name of fs.readdirSync(folder).filter(name=>name.endsWith('.json'))){
  const file=path.join(folder,name);
  if(!fs.lstatSync(file).isFile()||fs.statSync(file).size>1024*1024)continue;
  let row:Record<string,unknown>;try{row=JSON.parse(fs.readFileSync(file,'utf8'));}catch{continue;}
  if(!row||row.projectId!==projectId||row.module!=='generalEditing')continue;
  const agent=(row.agent||'codex') as AgentConnectionId;if(!(AGENT_CONNECTION_IDS as readonly string[]).includes(agent))continue;
  let group=groups.get(agent);if(!group){group={agent,name:connectionDefinition(agent).name,calls:0,completed:0,failed:0,durationMs:0,usage:null,usageComplete:true,transports:[]};groups.set(agent,group);}
  group.calls++;if(row.status==='completed')group.completed++;if(row.status==='failed')group.failed++;
  if(typeof row.durationMs==='number'&&Number.isFinite(row.durationMs)&&row.durationMs>=0)group.durationMs+=row.durationMs;
  const method=row.transport==='acp'?'acp':row.method==='api'?'api':'cli';if(!group.transports.includes(method))group.transports.push(method);
  const usage=row.usage as Partial<Usage>|undefined;
  if(usage&&usageKeys.every(key=>typeof usage[key]==='number'&&Number.isFinite(usage[key])&&usage[key]!>=0)){
   group.usage??={input:0,cached:0,output:0,reasoning:0};for(const key of usageKeys)group.usage[key]+=usage[key]!;
  }else group.usageComplete=false;
 }
 return [...groups.values()];
}

/** 出片按工程去重，不把计划/写代码/检查等多轮调用当成多条片子。 */
export type RecentAgentFilms={agent:AgentConnectionId;name:string;films:number;averageDurationMs:number|null;averageTokens:number|null;successRate:number|null};
const runsFolder=()=>path.join(path.dirname(agentSettingsFile()),'agent-runs');
const outcomesFolder=()=>process.env.LINK_READER_PROJECTS_DIR&&!process.env.LINKREADER_AGENT_SETTINGS_FILE
 ?path.join(process.env.LINK_READER_PROJECTS_DIR,'.opentake-agent-outcomes')
 :path.join(path.dirname(agentSettingsFile()),'agent-film-outcomes');
export function recordFilmOutcome(projectId:string,runId:string,agent:AgentConnectionId,state:'done'|'failed'|'stopped',endedAt:string,folder=outcomesFolder()){
 // IDs are opaque data, never paths. Only outcome metadata is stored, no prompts/accounts.
 const filename=Buffer.from(`${projectId}\0${runId}\0${agent}`).toString('base64url');
 if(filename.length>240)return;
 fs.mkdirSync(folder,{recursive:true});const file=path.join(folder,`${filename}.json`),tmp=`${file}.tmp`;
 fs.writeFileSync(tmp,JSON.stringify({projectId,runId,agent,state,endedAt}));fs.renameSync(tmp,file);
}
function readRows(folder:string):Record<string,unknown>[]{
 if(!fs.existsSync(folder))return [];
 return fs.readdirSync(folder).filter(name=>name.endsWith('.json')).flatMap(name=>{try{const file=path.join(folder,name),stat=fs.lstatSync(file);if(!stat.isFile()||stat.size>1024*1024)return [];const row=JSON.parse(fs.readFileSync(file,'utf8'));return row&&typeof row==='object'&&!Array.isArray(row)?[row]:[]}catch{return []}});
}
export function compareRecentAgentFilms(folder=runsFolder(),now=Date.now(),outcomes=outcomesFolder()):{days:30;rows:RecentAgentFilms[]}{
 const cutoff=now-30*86400000;
 type Film={duration:number;durationKnown:boolean;tokens:number;tokensKnown:boolean;latestStarted:number;latestRun?:string;outcome?:{state:string;at:number}};
 const groups=new Map<AgentConnectionId,Map<string,Film>>();
 for(const row of readRows(folder)){
  const started=Date.parse(String(row.startedAt)),agent=(row.agent||'codex') as AgentConnectionId;
  if(row.module!=='generalEditing'||typeof row.projectId!=='string'||!row.projectId||!Number.isFinite(started)||started<cutoff||started>now||!['completed','failed'].includes(String(row.status))||!(AGENT_CONNECTION_IDS as readonly string[]).includes(agent))continue;
  let group=groups.get(agent);if(!group){group=new Map();groups.set(agent,group)}
  let film=group.get(row.projectId);if(!film){film={duration:0,durationKnown:true,tokens:0,tokensKnown:true,latestStarted:-Infinity};group.set(row.projectId,film)}
  if(started>=film.latestStarted){film.latestStarted=started;film.latestRun=typeof row.filmRunId==='string'?row.filmRunId:undefined;}
  if(typeof row.durationMs==='number'&&Number.isFinite(row.durationMs)&&row.durationMs>=0)film.duration+=row.durationMs;else film.durationKnown=false;
  const usage=row.usage as Partial<Usage>|undefined;
  // Codex/ACP cached and reasoning are subsets. Claude reports separate cached input; new records carry an explicit total.
  if(usage&&['input','output'].every(key=>typeof usage[key as keyof Usage]==='number'&&Number.isFinite(usage[key as keyof Usage])&&usage[key as keyof Usage]!>=0)){if(typeof usage.total==='number'&&Number.isFinite(usage.total)&&usage.total>=0)film.tokens+=usage.total;else if(agent!=='claude')film.tokens+=usage.input!+usage.output!;else film.tokensKnown=false;}else film.tokensKnown=false;
 }
 for(const row of readRows(outcomes)){
  const film=groups.get(row.agent as AgentConnectionId)?.get(String(row.projectId)),at=Date.parse(String(row.endedAt));
  if(!film||!film.latestRun||row.runId!==film.latestRun||!Number.isFinite(at)||at<cutoff||at>now||!['done','failed','stopped'].includes(String(row.state)))continue;
  if(!film.outcome||at>=film.outcome.at)film.outcome={state:String(row.state),at};
 }
 return {days:30,rows:[...groups].map(([agent,films])=>{const values=[...films.values()],count=values.length;return {agent,name:connectionDefinition(agent).name,films:count,
  averageDurationMs:values.every(f=>f.durationKnown)?values.reduce((n,f)=>n+f.duration,0)/count:null,
  averageTokens:values.every(f=>f.tokensKnown)?values.reduce((n,f)=>n+f.tokens,0)/count:null,
  successRate:values.every(f=>f.outcome)?values.filter(f=>f.outcome!.state==='done').length/count*100:null};})};
}
