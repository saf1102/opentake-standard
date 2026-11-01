import {useSyncExternalStore} from 'react';
import {connectionRequest,notifyConnectionsChanged,type ConnectionId,type ConnectionView} from './connections';
import {CONNECTION_IDS} from '../../shared/agent-connections';

type Snapshot={connections:ConnectionView[];loading:boolean;error:string;waiting:Partial<Record<ConnectionId,boolean>>;busy:Partial<Record<ConnectionId,boolean>>;errors:Partial<Record<ConnectionId,string>>};
let snapshot:Snapshot={connections:[],loading:false,error:'',waiting:{},busy:{},errors:{}};
const listeners=new Set<()=>void>();
const publish=(patch:Partial<Snapshot>)=>{snapshot={...snapshot,...patch};listeners.forEach(fn=>fn())};
const timers=new Map<ConnectionId,ReturnType<typeof setTimeout>>();
const generations=new Map<ConnectionId,number>();
let current:Promise<void>|undefined;
export function acceptConnection(connection:ConnectionView){const old=snapshot.connections.find(item=>item.id===connection.id);if(old&&(connection.revision||0)<(old.revision||0))return;publish({connections:[...snapshot.connections.filter(item=>item.id!==connection.id),connection].sort((a,b)=>order.indexOf(a.id)-order.indexOf(b.id))});}
const order=['codex','claude','kimi','deepseek','minimax','codebuddy','dreamina','minimax-speech','hailuo'];
export function refreshConnections(){
 if(current)return current;
 const before=new Map(snapshot.connections.map(connection=>[connection.id,connection]));
 publish({loading:true,error:''});
 current=connectionRequest<{connections:ConnectionView[]}>().then(result=>publish({connections:result.connections.map(connection=>{const current=snapshot.connections.find(item=>item.id===connection.id);return current&&(current!==before.get(connection.id)||(current.revision||0)>(connection.revision||0))?current:connection})})).catch(error=>publish({error:error instanceof Error?error.message:'没查到，请重新检查'})).finally(()=>{current=undefined;publish({loading:false})});
 return current;
}
function stopPolling(id:ConnectionId){const timer=timers.get(id);if(timer)clearTimeout(timer);timers.delete(id);generations.set(id,(generations.get(id)||0)+1);publish({waiting:{...snapshot.waiting,[id]:false}});}
type LoginResult={waiting:boolean;connection:ConnectionView};
function applyLogin(id:ConnectionId,result:LoginResult){acceptConnection(result.connection);publish({waiting:{...snapshot.waiting,[id]:result.waiting&&!result.connection.connected}});notifyConnectionsChanged(result.connection);}
function scheduleLogin(id:ConnectionId,generation:number){
 if(!snapshot.waiting[id]||generations.get(id)!==generation)return;
 timers.set(id,setTimeout(async()=>{
  timers.delete(id);
  try{const result=await connectionRequest<LoginResult>(`${id}/login`);if(generations.get(id)!==generation)return;applyLogin(id,result);publish({errors:{...snapshot.errors,[id]:''}});}
  catch(error){if(generations.get(id)!==generation)return;publish({errors:{...snapshot.errors,[id]:error instanceof Error?error.message:'没查到，请重新检查'}});}
  scheduleLogin(id,generation);
 },4000));
}
async function action(id:ConnectionId,work:()=>Promise<void>){
 if(snapshot.busy[id])return;
 publish({busy:{...snapshot.busy,[id]:true},errors:{...snapshot.errors,[id]:''}});
 try{await work()}catch(error){publish({errors:{...snapshot.errors,[id]:error instanceof Error?error.message:'操作失败，请重试'}})}finally{publish({busy:{...snapshot.busy,[id]:false}})};
}
export function startConnectionLogin(id:ConnectionId){return action(id,async()=>{stopPolling(id);const generation=generations.get(id)!;const result=await connectionRequest<LoginResult>(`${id}/login`,'POST',{});if(generations.get(id)!==generation)return;applyLogin(id,result);scheduleLogin(id,generation)});}
export async function cancelConnectionLogin(id:ConnectionId){stopPolling(id);const generation=generations.get(id);publish({busy:{...snapshot.busy,[id]:true}});try{const result=await connectionRequest<LoginResult>(`${id}/login`,'DELETE');if(generations.get(id)===generation)applyLogin(id,result);}catch(error){publish({errors:{...snapshot.errors,[id]:error instanceof Error?error.message:'取消失败，请重试'}})}finally{publish({busy:{...snapshot.busy,[id]:false}})}}
export function recheckConnection(id:ConnectionId){return action(id,async()=>{const generation=generations.get(id);const connection=await connectionRequest<ConnectionView>(`${id}/recheck`,'POST',{});if(generations.get(id)!==generation)return;acceptConnection(connection);notifyConnectionsChanged(connection)});}
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
