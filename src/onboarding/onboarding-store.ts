import {useSyncExternalStore} from 'react';

/** 一键部署：the rows of the check, the order they are shown and checked in, and which ones must pass before work starts. */
export type CheckState='ok'|'warn'|'act'|'opt';
export type CheckAction={kind:'codex-login'|'reader-login'|'settings'|'route'|'link'|'system';label:string;target?:string};
export type AgentTile={id:string;name:string;line:string;state:'on'|'found'|'off';status:string};
export type CheckResult={id:string;state:CheckState;text:string;chips?:string[];agents?:AgentTile[];action?:CheckAction};
export type RowState='wait'|'checking'|CheckState;
import {DEPLOY_ITEMS as editionItems} from './edition-config';
export type DeployItem={id:DeployItemId;title:string;optional?:true};
export const DEPLOY_ITEMS:readonly DeployItem[]=editionItems;
export type DeployItemId='perf'|'parts'|'agent'|'account'|'disk'|'reader'|'stats'|'seedance'|'voice'|'openscreen';
type Snapshot={rows:Partial<Record<DeployItemId,{state:RowState;result?:CheckResult}>>;running:boolean;checked:boolean};

let snapshot:Snapshot={rows:{},running:false,checked:false};
const listeners=new Set<()=>void>();
const publish=(next:Partial<Snapshot>)=>{snapshot={...snapshot,...next};listeners.forEach(fn=>fn())};
const setRow=(id:DeployItemId,state:RowState,result?:CheckResult)=>publish({rows:{...snapshot.rows,[id]:{state,result}}});

/** The account is the desktop shell's sign-in, not a server check; the page hands it in. */
let accountResult:()=>CheckResult=()=>({id:'account',state:'ok',text:'网页预览，不需要账号'});
export function setAccountSource(source:()=>CheckResult){accountResult=source;if(snapshot.rows.account&&snapshot.rows.account.state!=='wait'&&snapshot.rows.account.state!=='checking')setRow('account',source().state,source())}

async function fetchCheck(id:DeployItemId):Promise<CheckResult>{
 if(id==='account')return accountResult();
 const response=await fetch(`/api/editor/onboarding/${id}`,{cache:'no-store'});
 const body=await response.json() as {ok:boolean;result?:CheckResult;error?:string};
 if(!body.ok||!body.result)throw Error(body.error||'这一项没查成');
 return body.result;
}
export async function recheck(id:DeployItemId){
 setRow(id,'checking',snapshot.rows[id]?.result);
 try{const result=await fetchCheck(id);setRow(id,result.state,result);return result}
 catch(error){const result:CheckResult={id,state:'warn',text:`这一项没查成：${error instanceof Error?error.message:String(error)}`};setRow(id,'warn',result);return result}
}
let current:Promise<void>|null=null;
/** One row at a time, each result written into its own row: the list never redraws or jumps. */
export function runAll(){
 if(current)return current;
 // a re-check keeps every earlier result on screen while its row is checked again
 publish({running:true,rows:snapshot.checked?snapshot.rows:Object.fromEntries(DEPLOY_ITEMS.map(item=>[item.id,{state:'wait'}]))});
 current=(async()=>{for(const item of DEPLOY_ITEMS)await recheck(item.id)})().finally(()=>{current=null;publish({running:false,checked:true})});
 return current;
}

export function summary(s:Snapshot){
 const required=DEPLOY_ITEMS.filter(item=>!('optional' in item));
 const isDone=(state?:RowState)=>state==='ok'||state==='warn';
 const okRequired=required.filter(item=>isDone(s.rows[item.id]?.state)).length;
 const done=DEPLOY_ITEMS.filter(item=>{const state=s.rows[item.id]?.state;return state&&state!=='wait'&&state!=='checking'}).length;
 return {okRequired,required:required.length,ready:s.checked&&okRequired===required.length,done,total:DEPLOY_ITEMS.length,allOk:DEPLOY_ITEMS.every(item=>isDone(s.rows[item.id]?.state))};
}
export function useDeploy(){return useSyncExternalStore(fn=>{listeners.add(fn);return()=>{listeners.delete(fn)}},()=>snapshot)}

/** Open and close the window from anywhere (the nav button, the home strip, the first sign-in). */
let openState=false;const openListeners=new Set<()=>void>();
export function setDeployOpen(value:boolean){openState=value;openListeners.forEach(fn=>fn())}
export function useDeployOpen(){return useSyncExternalStore(fn=>{openListeners.add(fn);return()=>{openListeners.delete(fn)}},()=>openState)}

export async function onboardingSeen(){try{const r=await fetch('/api/editor/onboarding/seen',{cache:'no-store'});const b=await r.json() as {result?:{seenAt?:string}};return b.result?.seenAt}catch{return undefined}}
export async function markOnboardingSeen(){try{await fetch('/api/editor/onboarding/seen',{method:'POST'})}catch{/* shown again next time */}}

/** Opens a settings group from outside the settings dialog. */
export const openSettings=(group:string)=>window.dispatchEvent(new CustomEvent('opentake:open-settings',{detail:{group}}));
