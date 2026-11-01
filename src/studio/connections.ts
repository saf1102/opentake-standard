export {CONNECTION_DEFINITIONS,connectionDefinition,connectionReadyForFilm,isRelay} from '../../shared/agent-connections';
export type {ConnectionId,ConnectionView,ConnectionConfig,ConnectionModel,ConnectionMode} from '../../shared/agent-connections';
export async function connectionRequest<T>(suffix='',method='GET',body?:unknown):Promise<T>{
 const response=await fetch(`/api/editor/agent-connections${suffix?`/${suffix}`:''}`,{method,headers:body===undefined?undefined:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
 const data=await response.json();if(!response.ok||!data.ok)throw Error(data.error||'接入请求失败');return data.result as T;
}
export function notifyConnectionsChanged(connection?:import('../../shared/agent-connections').ConnectionView){window.dispatchEvent(new window.CustomEvent('opentake-connections-changed',{detail:{connection}}));}

export type ConnectionManagement={id:import('../../shared/agent-connections').ConnectionId;action:'install'|'logout'|'switch-account'|'upgrade';state:'waiting'|'complete'|'failed'|'cancelled';phase?:'logout'|'login';message:string;connection?:import('../../shared/agent-connections').ConnectionView};
export type AgentUsageComparison={days:30;rows:{agent:import('../../shared/agent-connections').AgentConnectionId;name:string;films:number;averageDurationMs:number|null;averageTokens:number|null;successRate:number|null}[]};
