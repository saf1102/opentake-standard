import {useEffect,useRef,useState} from 'react';
import {connectionDefinition,connectionRequest,notifyConnectionsChanged,type AgentUsageComparison,type ConnectionManagement,type ConnectionView} from '../connections';
import {AgentMark} from './AgentMark';

/** Terminal work is owned by the server. This view never executes a command or reads account files. */
export function AgentConnectionDetails({connection,disabled=false,showRecheck=true,onChanged,onBusyChange}:{connection:ConnectionView;disabled?:boolean;showRecheck?:boolean;onChanged:(connection:ConnectionView)=>void;onBusyChange:(busy:boolean)=>void}){
 const [management,setManagement]=useState<ConnectionManagement>(),[requesting,setRequesting]=useState(false),[error,setError]=useState(''),[appHint,setAppHint]=useState(false);
 const mounted=useRef(false),generation=useRef(0),timer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined),changed=useRef(onChanged);
 changed.current=onChanged;
 const blocked=!connection.enabled||!connection.cliInstalled,waiting=management?.state==='waiting',definition=connectionDefinition(connection.id);
 useEffect(()=>{onBusyChange(requesting||waiting);return()=>onBusyChange(false)},[requesting,waiting,onBusyChange]);
 const stop=()=>{generation.current++;if(timer.current)clearTimeout(timer.current);timer.current=undefined};
 const apply=(result:ConnectionManagement)=>{setManagement(result);if(result.connection){changed.current(result.connection);notifyConnectionsChanged(result.connection)}};
 const poll=(stamp:number)=>{
  if(!mounted.current||generation.current!==stamp)return;
  timer.current=setTimeout(async()=>{
   timer.current=undefined;
   try{const result=await connectionRequest<ConnectionManagement>(`${connection.id}/management`);if(!mounted.current||generation.current!==stamp)return;apply(result);setError('');if(result.state==='waiting')poll(stamp)}
   catch(e){if(!mounted.current||generation.current!==stamp)return;setError(e instanceof Error?e.message:'没查到终端状态，请重试');poll(stamp)}
  },3000);
 };
 useEffect(()=>{
  mounted.current=true;const stamp=generation.current;
  // Restore only this provider's server-owned wait after returning to settings.
  if(!blocked)void connectionRequest<ConnectionManagement>(`${connection.id}/management`).then(result=>{if(mounted.current&&generation.current===stamp){apply(result);if(result.state==='waiting')poll(stamp)}}).catch(()=>{});
  return()=>{mounted.current=false;stop()};
  // The connection result changes while polling; it must not restart the wait.
  // eslint-disable-next-line react-hooks/exhaustive-deps
 },[connection.id,blocked]);
 const run=async(action:'switch-account'|'upgrade')=>{
  if(blocked||disabled||requesting||waiting)return;
  if(action==='switch-account'&&!definition.logoutArgs){setAppHint(true);return;}
  stop();const stamp=generation.current;setRequesting(true);setError('');setAppHint(false);
  try{const result=await connectionRequest<ConnectionManagement>(`${connection.id}/${action}`,'POST',action==='upgrade'?{command:connection.upgradeCommand}:{});if(!mounted.current||generation.current!==stamp)return;apply(result);if(result.state==='waiting')poll(stamp)}
  catch(e){if(mounted.current&&generation.current===stamp)setError(e instanceof Error?e.message:'操作失败，请重试')}
  finally{if(mounted.current&&generation.current===stamp)setRequesting(false)}
 };
 const cancel=async()=>{
  stop();const stamp=generation.current;setRequesting(true);setError('');
  try{const result=await connectionRequest<ConnectionManagement>(`${connection.id}/management`,'DELETE');if(mounted.current&&generation.current===stamp)apply(result)}catch(e){if(mounted.current&&generation.current===stamp){setError(e instanceof Error?e.message:'取消等待失败，请重试');poll(stamp)}}finally{if(mounted.current&&generation.current===stamp)setRequesting(false)}
 };
 const recheck=async()=>{
  if(blocked||disabled||requesting||waiting)return;
  const stamp=generation.current;setRequesting(true);setError('');
  try{const next=await connectionRequest<ConnectionView>(`${connection.id}/recheck`,'POST',{});if(mounted.current&&generation.current===stamp){changed.current(next);notifyConnectionsChanged(next)}}catch(e){if(mounted.current&&generation.current===stamp)setError(e instanceof Error?e.message:'重新检查失败，请重试')}finally{if(mounted.current&&generation.current===stamp)setRequesting(false)}
 };
 const account=blocked?(connection.enabled?'尚未找到命令行':'默认不调用'):connection.cliAuthState==='connected'?'已登录':connection.cliAuthState==='needs-login'?'还没登录':connection.cliAuthState==='pending'?'登录检查待适配':'尚未确认登录';
 return <div className="connection-account" aria-busy={requesting||waiting}>
  <span className="connection-detail-label">账号</span><div><span className={connection.cliAuthState==='connected'?'connection-ok':''}>{connection.cliAuthState==='connected'?'● ':''}{account}</span><span className="connection-detail-muted"> · {connection.name} 账号</span></div><button type="button" disabled={blocked||disabled||requesting||waiting} onClick={()=>void run('switch-account')}>换账号…</button>
  <span className="connection-detail-label">命令行</span><div className="connection-program">{connection.executable||connection.cliPath||'尚未找到'}{connection.cliVersion&&<span className="connection-detail-muted"> · {connection.cliVersion}</span>}</div><span/>
  {connection.filmOutdated&&connection.cliVersion&&connection.filmMinimumVersion&&<div className="connection-upgrade" role="note"><span>{connection.cliVersion} 太旧，需要 {connection.filmMinimumVersion} 以上才能出片</span>{connection.upgradeCommand&&<><code>{connection.upgradeCommand}</code><button type="button" disabled={blocked||disabled||requesting||waiting} onClick={()=>void run('upgrade')}>在终端里升级</button></>}</div>}
  {appHint&&<div className="connection-management-note" role="status"><span>请到 {connection.name} 自己的 App 里换账号；换好后点「重新检查」。</span>{showRecheck&&<button type="button" disabled={blocked||disabled||requesting||waiting} onClick={()=>void recheck()}>{requesting?'检查中…':'重新检查'}</button>}</div>}
  {management&&<div className={`connection-management-note${management.state==='complete'?' connection-management-complete':''}`} role="status"><span>{waiting&&<i className="connection-spinner" aria-hidden="true"/>}{management.message}</span>{waiting&&<button type="button" disabled={requesting} onClick={()=>void cancel()}>取消等待</button>}</div>}
  {error&&<p role="alert" className="connection-management-note">{error}</p>}
 </div>;
}

export function AgentUsageTable(){
 const [result,setResult]=useState<AgentUsageComparison>(),[error,setError]=useState(''),[loading,setLoading]=useState(true),[attempt,setAttempt]=useState(0);
 useEffect(()=>{let active=true;setLoading(true);setError('');void connectionRequest<AgentUsageComparison>('usage').then(value=>{if(active)setResult(value)}).catch(e=>{if(active)setError(e instanceof Error?e.message:'用量记录暂时读不到')}).finally(()=>{if(active)setLoading(false)});return()=>{active=false}},[attempt]);
 const known=(value:number|null)=>value!==null&&Number.isFinite(value)&&value>=0;
 const duration=(value:number|null)=>{if(!known(value))return '—';const seconds=Math.round(value!/1000);return seconds<60?`${seconds} 秒`:`${Math.floor(seconds/60)} 分 ${seconds%60} 秒`};
 const tokens=(value:number|null)=>known(value)?`${value!>=10000?(value!/10000).toFixed(1)+' 万':Math.round(value!).toLocaleString('zh-CN')} token`:'—';
 const maxDuration=Math.max(1,...(result?.rows??[]).map(row=>row.averageDurationMs??0));
 return <div className="connection-usage" role="tabpanel" id="agent-usage-panel" aria-labelledby="agent-usage-tab">
  {loading?<p role="status" className="connection-note">正在读取本机出片记录…</p>:error?<div className="connection-warning" role="alert">{error} <button type="button" onClick={()=>setAttempt(value=>value+1)}>重试</button></div>:<div className="connection-usage-scroll"><table><thead><tr><th scope="col">智能体</th><th scope="col">出片</th><th scope="col">平均用时</th><th scope="col">平均用量</th><th scope="col">成功率</th></tr></thead><tbody>{result?.rows.length?result.rows.map(row=><tr key={row.agent}><th scope="row"><span className="connection-usage-who"><AgentMark id={row.agent}/>{row.name}</span></th><td>{row.films} 条</td><td>{known(row.averageDurationMs)&&<i className="connection-duration-bar" style={{width:`${Math.max(4,row.averageDurationMs!/maxDuration*90)}px`}} aria-hidden="true"/>}{duration(row.averageDurationMs)}</td><td>{tokens(row.averageTokens)}</td><td>{known(row.successRate)?`${Math.round(row.successRate!)}%`:'—'}</td></tr>):<tr><td colSpan={5} className="connection-usage-empty">最近 30 天还没有通用剪辑出片记录。</td></tr>}</tbody></table></div>}
  <p className="connection-note connection-usage-foot">按这台电脑最近 30 天的通用剪辑出片统计，只存在本机。按工程去重，平均用时只计智能体调用；拿不到用量或最终结果的显示「—」。</p>
 </div>;
}
