import {harnessRouteLabel} from '../../../shared/agent-connections';
import {useEffect} from 'react';
import {connectionDefinition,type ConnectionView} from '../connections';
import {cancelConnectionLogin,recheckConnection,startConnectionLogin,cancelWorkBuddySetup,restoreWorkBuddySetup,startWorkBuddySetup,useConnections} from '../connection-store';

export function connectionLabel(connection:ConnectionView,waiting=false){
 if(waiting)return '等你登录';
 if(connection.id==='claude'&&!connection.enabled)return connection.cliInstalled?'已安装 · 默认不调用':'默认不调用';
 if(connection.connected)return connection.id==='deepseek'&&connection.mode==='cli'?(connection.deepseekVerified?'已接通 · ':'已选 · ')+harnessRouteLabel(connection):'已接通';
 if(connection.mode==='api')return connection.state==='pending'?'待适配':'未接通';
 if(connection.workBuddyNeedsCli)return '已装 WorkBuddy';
 if(!connection.cliInstalled)return '没找到命令行';
 if(connection.id==='deepseek'&&connection.cliAuthState==='needs-login')return '需要设置出片凭据';
 return connection.cliAuthState==='needs-login'?'已安装 · 还没登录':connection.cliAuthState==='unknown'?'没查到':connection.cliAuthState==='pending'?'待适配':'未接通';
}
export function ConnectionActions({connection,onConfigure,compact=false,disabled=false,showRecheck=true}:{connection:ConnectionView;onConfigure:(mode?:'api')=>void;compact?:boolean;disabled?:boolean;showRecheck?:boolean}){
 const {waiting,busy,errors,workBuddySetup}=useConnections(),id=connection.id,isWaiting=!!waiting[id],isBusy=!!busy[id],definition=connectionDefinition(id);
 const observesSetup=id==='codebuddy'&&connection.enabled&&(connection.mode==='cli'||connection.workBuddyNeedsCli)&&!connection.connected;
 useEffect(()=>{if(observesSetup)void restoreWorkBuddySetup()},[observesSetup]);
 const harness=id==='deepseek'&&connection.mode==='cli'&&connection.cliInstalled&&connection.enabled;
 const setupWaiting=observesSetup&&workBuddySetup?.state==='waiting';
 const showSetup=observesSetup&&connection.workBuddyNeedsCli&&!!connection.installCommand;
 return <div className={`connection-quick-actions${compact?' is-compact':''}`}>
  <div className="connection-quick-buttons">
   {setupWaiting?<><span className="connection-wait-copy" role="status"><i className="connection-spinner" aria-hidden="true"/>{workBuddySetup?.message}</span><button type="button" disabled={disabled||isBusy} onClick={()=>void cancelWorkBuddySetup()}>取消等待</button></>
    :showSetup?<><span>{connection.cliNotice||connection.cliAuthMessage}</span><button type="button" className="connection-login" disabled={disabled||isBusy} onClick={()=>void startWorkBuddySetup(connection.installCommand!)}>{isBusy?'正在打开终端…':connection.mode==='api'?'切换到命令行并安装登录':'安装命令行并登录'}</button></>
    :isWaiting?<><span className="connection-wait-copy" role="status"><i className="connection-spinner" aria-hidden="true"/>{compact?'等你登录，好了自动接上':'等你登录，好了自动接上'}</span><button type="button" disabled={disabled} onClick={()=>void cancelConnectionLogin(id)}>取消</button></>
    :connection.id==='claude'&&!connection.enabled&&connection.cliInstalled?<><span>{compact?connectionLabel(connection):''}</span>{compact&&<button type="button" disabled={disabled} onClick={()=>onConfigure()}>打开…</button>}</>
    :harness?showRecheck?<><span role="status">{connection.cliAuthMessage||harnessRouteLabel(connection)}</span><button type="button" title="发送极短请求，验证当前出片凭据" disabled={disabled||isBusy} onClick={()=>void recheckConnection(id)}>{isBusy?'检查中…':'重新检查'}</button></>:null
    :connection.connected?compact?<span className="connection-ok">● 已接通</span>:null
    :connection.mode==='api'?null
    :!connection.cliInstalled?<> {connection.installCommand&&connection.enabled
      ?showRecheck&&<button type="button" disabled={disabled} onClick={()=>onConfigure()}>安装命令行…</button>
      :<a href={connection.installPage||definition.page} target="_blank" rel="noreferrer">打开官方下载页 ↗</a>}{!definition.apiReason&&<button type="button" disabled={disabled} onClick={()=>onConfigure('api')}>{compact?'填密钥':'填 API 密钥'}</button>}</>
    :connection.cliAuthState==='needs-login'&&connection.cliLoginAvailable?<><span>{compact?'已安装 · 还没登录':''}</span><button type="button" className="connection-login" disabled={isBusy||disabled} onClick={()=>void startConnectionLogin(id)}>{isBusy?'正在打开…':'登录'}</button></>
    :connection.cliAuthState==='pending'?<><span className="connection-adaptation">{connection.cliAuthMessage||'命令行接通待适配'}</span><button type="button" disabled={disabled} onClick={()=>onConfigure('api')}>改用 API 密钥</button></>
    :showRecheck?<><span>{compact?'没查到':''}</span><button type="button" disabled={isBusy||disabled} onClick={()=>void recheckConnection(id)}>{isBusy?'检查中…':'重新检查'}</button></>:null}
  </div>
  {!showSetup&&!setupWaiting&&!isWaiting&&connection.cliAuthState==='missing'&&connection.cliAuthMessage&&connection.cliAuthMessage!=='未安装'&&<span className="connection-adaptation">{connection.cliAuthMessage}</span>}
  {!harness&&!setupWaiting&&!compact&&!isWaiting&&connection.cliAuthState==='needs-login'&&connection.cliAuthMessage&&connection.cliAuthMessage!=='还没登录'&&<span className="connection-adaptation">{connection.cliAuthMessage}</span>}
  {isWaiting&&definition.loginHint&&<span className="connection-wait-copy">{definition.loginHint}</span>}
  {id==='codebuddy'&&connection.enabled&&connection.mode==='cli'&&connection.cliInstalled&&!connection.connected&&
   ((!isWaiting&&connection.cliAuthState==='needs-login')||errors[id]?.startsWith('登录'))&&
   <span role="note" className="connection-inline-error" style={{color:'#9869dc'}}>国内版在开着 VPN 或代理时可能登录不上。请把 codebuddy.cn、workbuddy.cn 设为直连，或暂时关掉代理再登录。</span>}
  {observesSetup&&workBuddySetup?.state==='failed'&&<span role="alert" className="connection-inline-error">{workBuddySetup.message}</span>}
  {errors[id]&&<span role="alert" className="connection-inline-error">{errors[id]}</span>}
 </div>;
}
