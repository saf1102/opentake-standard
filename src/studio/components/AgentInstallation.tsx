import {useEffect,useRef,useState,type ReactNode} from 'react';
import {DropdownMenu,DropdownMenuContent,DropdownMenuItem,DropdownMenuTrigger} from '@/components/ui/dropdown-menu';
import {AgentMark} from './AgentMark';
export type Status={host:string;mode:string;state:string;executable?:string;version?:string;error?:string;notice?:string;loginCommand?:string;installCommand?:string;app?:{name:string;path:string};candidates:{path:string;source:string;status:string;version?:string}[]};
type Watch=''|'page'|'install'|'login';
const labels:Record<string,string>={ready:'已就绪','needs-login':'需要登录',missing:'未安装',invalid:'指定路径无效',unknown:'登录状态待确认',installed:'已安装'};
const watching:Record<Exclude<Watch,''>,string>={page:'等待安装完成，正在定期检测。',install:'已在服务主机打开终端运行安装命令。请在终端里完成安装，这里会定期检测。',login:'已在服务主机打开终端运行登录命令。请在终端和浏览器里完成登录，这里会定期检测。'};
/**
 * One agent's row in Settings › 已接入的 Agent: its state and program, what it is used for, and its own actions.
 * Claude Code is only detected (its program file is there or not): the workbench never runs it, so its row has no
 * login, manual path or test, only 重新检测, 诊断 and its install page.
 */
export function AgentInstallation({kind,onSaved,use,onStatus,onDirtyChange,onBusyChange}:{kind:'codex'|'claude';onSaved?:(path:string)=>void;use?:ReactNode;onStatus?:(status:Status|null)=>void;onDirtyChange?:(value:boolean)=>void;onBusyChange?:(value:boolean)=>void}){
 const [status,setStatus]=useState<Status|null>(null),[manual,setManual]=useState(false),[value,setValue]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[watch,setWatch]=useState<Watch>(''),[confirm,setConfirm]=useState(false),[opening,setOpening]=useState(false),[diagnosis,setDiagnosis]=useState(false);
 const controller=useRef<AbortController|null>(null);
 const manualButton=useRef<HTMLButtonElement|null>(null),terminalButton=useRef<HTMLButtonElement|null>(null),manualInput=useRef<HTMLInputElement|null>(null),focusManual=useRef(false);
 useEffect(()=>{onStatus?.(status)},[status,onStatus]);
 useEffect(()=>{onDirtyChange?.(manual&&value!==(status?.executable||''));return()=>onDirtyChange?.(false)},[manual,value,status?.executable,onDirtyChange]);
 useEffect(()=>{onBusyChange?.(busy);return()=>onBusyChange?.(false)},[busy,onBusyChange]);
 const name=kind==='codex'?'Codex':'Claude Code';
 // `action` opens Codex's login or confirmed installer in Terminal; success means only that Terminal opened.
 async function request(method='GET',cliPath?:string,action?:'login'|'install'){
  controller.current?.abort();const current=new AbortController();controller.current=current;setBusy(true);setError('');setOpening(!!action);if(action)setConfirm(false);
  try{
   const payload=action?{command:action==='install'?status?.installCommand:undefined}:cliPath!==undefined?{cliPath}:undefined;
   const response=await fetch(`/api/editor/agent-settings/installation/${kind}${action?`/${action}`:''}`,{method:action?'POST':method,signal:current.signal,headers:{'Content-Type':'application/json'},...(payload?{body:JSON.stringify(payload)}:{})});
   const body=await response.json();if(!response.ok||!body.ok)throw Error(body.error||(action?'没有打开终端':'检测失败'));
   if(current.signal.aborted)return;
   if(action){setWatch(action);return}
   setStatus(body.result);setWatch(w=>(w==='login'?body.result.state==='ready':body.result.executable)?'':w);if(body.result.state!=='missing')setConfirm(false);
   if(method==='PUT'){setManual(false);onSaved?.(cliPath||'');requestAnimationFrame(()=>manualButton.current?.focus())}
  }catch(e){if(!current.signal.aborted)setError(e instanceof Error?e.message:String(e))}finally{if(!current.signal.aborted){setBusy(false);if(action)requestAnimationFrame(()=>terminalButton.current?.focus())}}
 }
 function cancelInstall(){setConfirm(false);requestAnimationFrame(()=>terminalButton.current?.focus())}
 useEffect(()=>{void request();return()=>controller.current?.abort()},[kind]); // eslint-disable-line react-hooks/exhaustive-deps
 useEffect(()=>{if(!watch||busy)return;const timer=setTimeout(()=>void request(),5000);return()=>clearTimeout(timer)},[watch,busy]); // eslint-disable-line react-hooks/exhaustive-deps
 const tone=!status?'':status.state==='ready'?' is-ready':status.state==='missing'?' is-missing':' is-warn';
 return <div className={`agent-row${status?.state==='missing'?' is-absent':''}`} role="group" aria-label={kind==='claude'?`${name} 安装`:`${name} 安装与登录`} aria-busy={busy}>
  <AgentMark id={kind}/>
  <div className="agent-row-main">
   <div className="agent-row-title"><b>{name}</b><span className={`agent-pill${tone}`}>{status?labels[status.state]||'待检测':'正在检测'}</span></div>
   {status?.executable?<p className="agent-row-line">{[status.version||(kind==='claude'?'版本未知':''),status.mode==='manual'?'手动指定':'自动检测'].filter(Boolean).join(' · ')} <code>{status.executable}</code></p>:status&&status.state!=='invalid'?<p className="agent-row-line">本机没有找到</p>:null}
   {status?.notice&&<p className="agent-row-notice" role="status">{status.notice}</p>}
   {use&&<p className="agent-row-use">{use}</p>}
  {kind==='codex'&&manual&&<div className="agent-cli-controls"><label htmlFor={`installation-${kind}`}>服务主机上的可执行文件</label><input ref={manualInput} autoFocus id={`installation-${kind}`} value={value} onChange={e=>setValue(e.target.value)} placeholder="绝对路径" disabled={busy}/><button disabled={busy} onClick={()=>{setBusy(true);setError('');void fetch('/api/editor/agent-settings/choose-cli',{method:'POST'}).then(async r=>{const b=await r.json();if(!r.ok||!b.ok)throw Error(b.error||'没有选中程序');if(b.result.path)setValue(b.result.path)}).catch(e=>setError(String(e))).finally(()=>setBusy(false))}}>选择程序</button><button disabled={busy||!value.trim()} onClick={()=>void request('PUT',value.trim())}>验证并保存路径</button><button disabled={busy} onClick={()=>{controller.current?.abort();setBusy(false);setManual(false);manualButton.current?.focus()}}>取消</button></div>}
  {kind==='codex'&&status?.state==='missing'&&status.installCommand&&<div className="agent-cli-action">
   <p>{status.app?<>已安装 {status.app.name} app（<code style={{overflowWrap:'anywhere'}}>{status.app.path}</code>），但没有找到可用的 Codex 命令行（CLI）。工作台通过命令行调用 Codex：请点「一键安装」装上命令行，或更新 app 后重新检测。</>:'没有找到 Codex 命令行（CLI）。可以一键安装，也可以从 Codex 下载页安装 app。'}</p>
   <div className="agent-cli-controls"><button ref={terminalButton} disabled={busy||confirm} aria-expanded={confirm} aria-controls={`install-confirm-${kind}`} onClick={()=>setConfirm(true)}>一键安装…</button></div>
   {confirm&&<div id={`install-confirm-${kind}`} className="agent-cli-confirm" role="group" aria-labelledby={`install-confirm-${kind}-title`}>
    <p id={`install-confirm-${kind}-title`}>将在服务主机打开「终端」窗口，运行 Codex 官方安装命令：</p>
    <code>{status.installCommand}</code>
    <p className="agent-settings-note">安装程序从 OpenAI 下载 Codex 命令行，放到 ~/.local/bin，必要时把这个目录加进 shell 的 PATH。安装中的提问请在终端里回答。</p>
    <div className="agent-cli-controls"><button autoFocus disabled={busy} onClick={cancelInstall}>取消</button><button className="agent-cli-run" disabled={busy} onClick={()=>void request(undefined,undefined,'install')}>运行安装命令</button></div>
   </div>}
  </div>}
  {kind==='codex'&&status?.state==='needs-login'&&<div className="agent-cli-action">
   <p>Codex 还没有登录。「一键登录」会在服务主机打开「终端」窗口运行 <code style={{overflowWrap:'anywhere'}}>{status.loginCommand||'codex login'}</code>，按提示在浏览器里登录 ChatGPT；也可以在 Codex app 里登录。打开终端后这里会自动检测登录结果。</p>
   <div className="agent-cli-controls"><button ref={terminalButton} disabled={busy} onClick={()=>void request(undefined,undefined,'login')}>一键登录</button></div>
  </div>}
  <p role="status" aria-live="polite" className="agent-row-status">{busy?(opening?'正在服务主机打开终端…':kind==='claude'?'正在检测是否安装…':'正在读取安装与登录状态…'):watch?watching[watch]:''}</p>
  {(error||status?.error)&&<p role="alert" className="agent-settings-error">{error||status?.error}</p>}
  {diagnosis&&status&&<div className="agent-row-diagnosis"><b>诊断 · 已检查 {status.candidates.length} 个位置</b>{status.candidates.map(c=><p key={c.path}><code>{c.path}</code> · {c.status==='valid'?(kind==='claude'?'已找到':'有效'):c.status==='invalid'?'版本检查失败':c.status==='duplicate'?'重复路径':'未找到'} {c.version||''}</p>)}</div>}
  </div>
  <div className="agent-row-actions">
   {watch?<button onClick={()=>{setWatch('');controller.current?.abort();setBusy(false)}}>{watch==='login'?'停止登录检测':'停止安装检测'}</button>:<button disabled={busy} onClick={()=>void request()}>重新检测</button>}
   <DropdownMenu>
    <DropdownMenuTrigger asChild><button ref={manualButton} className="agent-row-more" aria-label={`${name} 更多操作`} title="更多操作">⋯</button></DropdownMenuTrigger>
    <DropdownMenuContent align="end" className="agent-row-menu" onCloseAutoFocus={e=>{if(focusManual.current){e.preventDefault();focusManual.current=false;manualInput.current?.focus()}}}>
     {kind==='codex'&&<><DropdownMenuItem disabled={busy} onSelect={()=>{setValue(status?.executable||'');setManual(true);focusManual.current=true}}>手动指定…</DropdownMenuItem>
     <DropdownMenuItem disabled={busy} onSelect={()=>void request('PUT','')}>恢复自动检测</DropdownMenuItem></>}
     <DropdownMenuItem disabled={!status} onSelect={()=>setDiagnosis(v=>!v)}>{diagnosis?'收起诊断':'诊断'}</DropdownMenuItem>
     <DropdownMenuItem asChild><a href={kind==='codex'?'https://chatgpt.com/download':'https://code.claude.com/docs/en/setup'} target="_blank" rel="noreferrer" onClick={()=>setWatch('page')}>{kind==='codex'?'Codex 下载页':'Claude Code 安装页'} ↗</a></DropdownMenuItem>
    </DropdownMenuContent>
   </DropdownMenu>
  </div>
 </div>
}
