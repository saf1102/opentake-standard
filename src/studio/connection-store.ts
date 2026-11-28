import {useSyncExternalStore} from 'react';
import {connectionRequest,notifyConnectionsChanged,type ConnectionId,type ConnectionManagement,type ConnectionView} from './connections';
import {CONNECTION_IDS} from '../../shared/agent-connections';

type Snapshot={workBuddySetup?:ConnectionManagement;connections:ConnectionView[];loading:boolean;error:string;waiting:Partial<Record<ConnectionId,boolean>>;busy:Partial<Record<ConnectionId,boolean>>;errors:Partial<Record<ConnectionId,string>>};
let snapshot:Snapshot={connections:[],loading:false,error:'',waiting:{},busy:{},errors:{}};
const listeners=new Set<()=>void>();
const publish=(patch:Partial<Snapshot>)=>{snapshot={...snapshot,...patch};listeners.forEach(fn=>fn())};
const timers=new Map<ConnectionId,ReturnType<typeof setTimeout>>();
const generations=new Map<ConnectionId,number>();
let current:Promise<void>|undefined;
export function acceptConnection(connection:ConnectionView){const old=snapshot.connections.find(item=>item.id===connection.id);if(old&&(connection.revision||0)<(old.revision||0))return;publish({connections:[...snapshot.connections.filter(item=>item.id!==connection.id),connection].sort((a,b)=>order.indexOf(a.id)-order.indexOf(b.id))});}
const order=['codex','claude','kimi','deepseek','minimax','codebuddy','dreamina','minimax-speech','hailuo'];
let currentIsRecheck=false;
export function refreshConnections(force=false):Promise<void>{
 if(current)return force&&!currentIsRecheck?current.then(()=>refreshConnections(true)):current;
 currentIsRecheck=force;
 const before=new Map(snapshot.connections.map(connection=>[connection.id,connection]));
 publish({loading:true,error:''});
 current=connectionRequest<{connections:ConnectionView[]}>(force?'recheck':'',force?'POST':'GET').then(result=>publish({connections:result.connections.map(connection=>{const current=snapshot.connections.find(item=>item.id===connection.id);return current&&(current!==before.get(connection.id)||(current.revision||0)>(connection.revision||0))?current:connection})})).catch(error=>publish({error:error instanceof Error?error.message:'没查到，请重新检查'})).finally(()=>{current=undefined;publish({loading:false})});
 return current;
}
function stopPolling(id:ConnectionId){const timer=timers.get(id);if(timer)clearTimeout(timer);timers.delete(id);generations.set(id,(generations.get(id)||0)+1);publish({waiting:{...snapshot.waiting,[id]:false}});}
type LoginResult={waiting:boolean;connection:ConnectionView};
function applyLogin(id:ConnectionId,result:LoginResult,cancelled=false){
 acceptConnection(result.connection);
 const failed=!cancelled&&!result.waiting&&!result.connection.connected;
 publish({waiting:{...snapshot.waiting,[id]:result.waiting&&!result.connection.connected},errors:{...snapshot.errors,[id]:failed?(result.connection.blockedReason||'登录未完成，请重试'):''}});
 notifyConnectionsChanged(result.connection);
}
function scheduleLogin(id:ConnectionId,generation:number){
 if(!snapshot.waiting[id]||generations.get(id)!==generation)return;
 timers.set(id,setTimeout(async()=>{
  timers.delete(id);
  try{const result=await connectionRequest<LoginResult>(`${id}/login`);if(generations.get(id)!==generation)return;applyLogin(id,result);}
  catch(error){if(generations.get(id)!==generation)return;publish({errors:{...snapshot.errors,[id]:error instanceof Error?error.message:'没查到，请重新检查'}});}
  scheduleLogin(id,generation);
 },4000));
}
async function action(id:ConnectionId,work:()=>Promise<void>,errorPrefix=''){
 if(snapshot.busy[id])return;
 publish({busy:{...snapshot.busy,[id]:true},errors:{...snapshot.errors,[id]:''}});
 try{await work()}catch(error){publish({errors:{...snapshot.errors,[id]:errorPrefix+(error instanceof Error?error.message:'操作失败，请重试')}})}finally{publish({busy:{...snapshot.busy,[id]:false}})};
}
export function startConnectionLogin(id:ConnectionId){return action(id,async()=>{stopPolling(id);const generation=generations.get(id)!;const result=await connectionRequest<LoginResult>(`${id}/login`,'POST',{});if(generations.get(id)!==generation)return;applyLogin(id,result);scheduleLogin(id,generation)},'登录失败：');}
export async function cancelConnectionLogin(id:ConnectionId){stopPolling(id);const generation=generations.get(id);publish({busy:{...snapshot.busy,[id]:true}});try{const result=await connectionRequest<LoginResult>(`${id}/login`,'DELETE');if(generations.get(id)===generation)applyLogin(id,result,true);}catch(error){publish({errors:{...snapshot.errors,[id]:error instanceof Error?error.message:'取消失败，请重试'}})}finally{publish({busy:{...snapshot.busy,[id]:false}})}}
export function recheckConnection(id:ConnectionId){return action(id,async()=>{const generation=generations.get(id);const connection=id==='deepseek'&&snapshot.connections.find(item=>item.id===id)?.mode==='cli'
 ?(await connectionRequest<{connection:ConnectionView}>(`${id}/test`,'POST',{})).connection
 :await connectionRequest<ConnectionView>(`${id}/recheck`,'POST',{});if(generations.get(id)!==generation)return;acceptConnection(connection);notifyConnectionsChanged(connection)});}
// The server owns installation and the login terminal. All cards observe the same operation.
let setupGeneration=0;
let setupTimer:ReturnType<typeof setTimeout>|undefined;
let restoringSetup=false;
function clearSetupTimer(){
 if(setupTimer)clearTimeout(setupTimer);
 setupTimer=undefined;
}
function pollSetup(stamp:number){
 clearSetupTimer();
 setupTimer=setTimeout(()=>void readSetup(stamp,true),3000);
}
async function readSetup(stamp:number,retry:boolean){
 try{
  const result=await connectionRequest<ConnectionManagement|null>('codebuddy/install-and-login');
  if(stamp===setupGeneration&&(retry||result?.state==='waiting'))applySetup(result,stamp);
 }catch(error){
  if(retry&&stamp===setupGeneration){
   publish({errors:{...snapshot.errors,codebuddy:error instanceof Error?error.message:'暂时读不到登录状态，正在重试'}});
   pollSetup(stamp);
  }
 }
}
function applySetup(result:ConnectionManagement|null,stamp:number){
 if(stamp!==setupGeneration)return;
 clearSetupTimer();
 if(result?.action!=='install-and-login'){publish({workBuddySetup:undefined,errors:{...snapshot.errors,codebuddy:''}});return}
 publish({workBuddySetup:result,errors:{...snapshot.errors,codebuddy:''}});
 if(result.connection&&(result.connection.revision||0)>=(snapshot.connections.find(item=>item.id==='codebuddy')?.revision||0)){acceptConnection(result.connection);notifyConnectionsChanged(result.connection)}
 if(result.state==='waiting')pollSetup(stamp);
}
export async function restoreWorkBuddySetup(){
 if(restoringSetup||snapshot.busy.codebuddy||snapshot.workBuddySetup?.state==='waiting')return;
 restoringSetup=true;
 try{await readSetup(setupGeneration,false)}finally{restoringSetup=false}
}
export function startWorkBuddySetup(command:string){
 return action('codebuddy',async()=>{
  const stamp=++setupGeneration;
  clearSetupTimer();
  const result=await connectionRequest<ConnectionManagement>('codebuddy/install-and-login','POST',{command});
  applySetup(result,stamp);
 });
}
export function cancelWorkBuddySetup(){
 return action('codebuddy',async()=>{
  const stamp=++setupGeneration;
  clearSetupTimer();
  try{applySetup(await connectionRequest<ConnectionManagement>('codebuddy/install-and-login','DELETE'),stamp)}
  catch(error){pollSetup(stamp);throw error}
 });
}
let statusEvents:EventSource|undefined;
const statusRequests=new Map<ConnectionId,number>();
function subscribe(listener:()=>void){
 listeners.add(listener);
 if(!statusEvents&&typeof window!=='undefined'&&typeof window.EventSource==='function'){
  const source=new window.EventSource('/api/editor/agent-connections/events');statusEvents=source;
  // Reconnection can have missed a rejection; refresh before trusting the previous window snapshot.
  source.addEventListener('open',()=>{void refreshConnections()});
  const changed=(event:Event)=>{
   let id:ConnectionId,revision:number;try{({id,revision}=JSON.parse((event as MessageEvent).data));if(!CONNECTION_IDS.includes(id)||!Number.isSafeInteger(revision)||revision<0)return}catch{return}
   const before=snapshot.connections.find(item=>item.id===id);if(before&&(before.revision||0)>revision)return;
   const generation=(statusRequests.get(id)||0)+1;statusRequests.set(id,generation);
   if(event.type==='credentials-rejected'){
    // Discard cached success immediately; the server revision also rejects late recheck/save responses.
    stopPolling(id);
    if(before)acceptConnection({...before,revision,connected:false,state:'unconfigured',cliAuthState:before.mode==='cli'?'needs-login':before.cliAuthState,cliAuthMessage:'还没登录',message:'还没登录'});
   }
   void connectionRequest<ConnectionView>(id).then(connection=>{
    if(statusEvents===source&&statusRequests.get(id)===generation&&(connection.revision||0)>=revision){
     acceptConnection(connection);if(connection.connected)stopPolling(id);notifyConnectionsChanged(connection);
    }
   }).catch(()=>{/* Keep the runtime rejection visible if the status request cannot reach the server. */});
  };
  source.addEventListener('credentials-rejected',changed);
  source.addEventListener('connection-changed',changed);
 }
 return()=>{listeners.delete(listener);if(!listeners.size){statusEvents?.close();statusEvents=undefined;statusRequests.clear()}};
}
export function useConnections(){return useSyncExternalStore(subscribe,()=>snapshot);}
// Same-window updates carry one result; they never fan out a login poll to all agents.
if(typeof window!=='undefined')window.addEventListener('opentake-connections-changed',event=>{
 const connection=(event as CustomEvent<{connection?:ConnectionView}>).detail?.connection;
 if(connection)acceptConnection(connection);else void refreshConnections();
});
