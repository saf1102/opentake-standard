export {CONNECTION_DEFINITIONS,connectionDefinition,connectionReadyForFilm,isRelay} from '../../shared/agent-connections';
export type {ConnectionId,ConnectionView,ConnectionConfig,ConnectionModel,ConnectionMode} from '../../shared/agent-connections';
export async function connectionRequest<T>(suffix='',method='GET',body?:unknown):Promise<T>{
 const response=await fetch(`/api/editor/agent-connections${suffix?`/${suffix}`:''}`,{method,headers:body===undefined?undefined:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
 const data=await response.json();if(!response.ok||!data.ok)throw Error(data.error||'接入请求失败');return data.result as T;
}
export function notifyConnectionsChanged(){window.dispatchEvent(new Event('opentake-connections-changed'));}
