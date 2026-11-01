import {connectionDefinition,type ConnectionView} from '../connections';
import {cancelConnectionLogin,recheckConnection,startConnectionLogin,useConnections} from '../connection-store';

export function connectionLabel(connection:ConnectionView,waiting=false){
 if(waiting)return '等你登录';
 if(connection.id==='claude'&&!connection.enabled)return connection.cliInstalled?'已安装 · 默认不调用':'默认不调用';
 if(connection.connected)return '已接通';
 if(connection.mode==='api')return connection.state==='pending'?'待适配':'未接通';
 if(!connection.cliInstalled)return '没找到命令行';
 return connection.cliAuthState==='needs-login'?'已安装 · 还没登录':connection.cliAuthState==='unknown'?'没查到':connection.cliAuthState==='pending'?'待适配':'未接通';
}
export function ConnectionActions({connection,onConfigure,compact=false,disabled=false,showRecheck=true}:{connection:ConnectionView;onConfigure:(mode?:'api')=>void;compact?:boolean;disabled?:boolean;showRecheck?:boolean}){
 const {waiting,busy,errors}=useConnections(),id=connection.id,isWaiting=!!waiting[id],isBusy=!!busy[id],definition=connectionDefinition(id);
 return <div className={`connection-quick-actions${compact?' is-compact':''}`}>
  <div className="connection-quick-buttons">
   {isWaiting?<><span className="connection-wait-copy" role="status"><i className="connection-spinner" aria-hidden="true"/>{compact?'等你登录，好了自动接上':'等你登录，好了自动接上'}</span><button type="button" disabled={disabled} onClick={()=>void cancelConnectionLogin(id)}>取消</button></>
    :connection.id==='claude'&&!connection.enabled&&connection.cliInstalled?<><span>{compact?connectionLabel(connection):''}</span>{compact&&<button type="button" disabled={disabled} onClick={()=>onConfigure()}>打开…</button>}</>
    :connection.connected?compact?<span className="connection-ok">● 已接通</span>:null
    :connection.mode==='api'?null
    :!connection.cliInstalled?<><a href={definition.page} target="_blank" rel="noreferrer">去安装 ↗</a><button type="button" disabled={disabled} onClick={()=>onConfigure('api')}>{compact?'填密钥':'填 API 密钥'}</button></>
    :connection.cliAuthState==='needs-login'&&connection.cliLoginAvailable?<><span>{compact?'已安装 · 还没登录':''}</span><button type="button" className="connection-login" disabled={isBusy||disabled} onClick={()=>void startConnectionLogin(id)}>{isBusy?'正在打开…':'登录'}</button></>
    :connection.cliAuthState==='pending'?<><span className="connection-adaptation">{connection.cliAuthMessage||'命令行接通待适配'}</span><button type="button" disabled={disabled} onClick={()=>onConfigure('api')}>改用 API 密钥</button></>
    :showRecheck?<><span>{compact?'没查到':''}</span><button type="button" disabled={isBusy||disabled} onClick={()=>void recheckConnection(id)}>{isBusy?'检查中…':'重新检查'}</button></>:null}
  </div>
  {isWaiting&&definition.loginHint&&<span className="connection-wait-copy">{definition.loginHint}</span>}
  {errors[id]&&<span role="alert" className="connection-inline-error">{errors[id]}</span>}
 </div>;
}
