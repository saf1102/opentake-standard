import {useEffect,useState} from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import pkg from '../../package.json';
import metadata from '../../desktop/windows-version.json';
type Release={version:string;windowsBuild:number;revision:string;notes:string;url:string;sha256:string;size:number};
type View={currentVersion:string;currentBuild:number;release:Release|null;available:boolean;notify:boolean;offline?:boolean;message?:string};
async function api(route:string,method='GET',body?:unknown){
  const response=await fetch('/api/upgrade/windows/'+route,{method,headers:{'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
  const value=await response.json();if(!response.ok)throw Error(value.error||'Windows 更新服务暂时不可用');return value;
}
const announce=(view:View)=>window.dispatchEvent(new CustomEvent('standard-update-state',{detail:view}));
const show=()=>window.dispatchEvent(new Event('standard-update-open'));
export function WindowsAboutUpdate(){
  const[daily,setDaily]=useState(true),[message,setMessage]=useState(''),[checking,setChecking]=useState(false);
  useEffect(()=>{void api('preferences').then(v=>setDaily(v.daily)).catch(e=>setMessage(e.message))},[]);
  async function check(){setChecking(true);setMessage('正在检查…');try{const result=await api('state'),view=result.clientUpdate as View;announce(view);setMessage(view.offline?view.message||'暂时无法检查，请稍后重试':view.available?'发现 Windows 新版本':'已是最新 Windows 版本');if(view.available)show()}catch(e){setMessage(e instanceof Error?e.message:'检查失败')}finally{setChecking(false)}}
  return <section className="standard-update-about"><h2>关于与更新</h2><p>OpenTake Standard 是开源免费的，源码在 GitHub。</p><div className="srow"><div><b>当前版本</b><small>{pkg.version} · Windows x64 · 构建 {metadata.windowsBuild}</small></div><span/><button disabled={checking} onClick={()=>void check()}>{checking?'正在检查…':'检查更新'}</button></div><p role="status">{message}</p><div className="srow"><label><b>自动检查更新</b><small>每天从 GitHub 检查一次 Windows 更新；发现新版后，由你下载并安装。</small><input type="checkbox" checked={daily} onChange={e=>{const next=e.target.checked;void api('preferences','PUT',{daily:next}).then(()=>setDaily(next)).catch(e=>setMessage(e.message))}}/></label></div><div className="srow"><b>更新说明</b><span/><button onClick={show}>查看 ›</button></div></section>;
}
export function WindowsClientUpdate(){
  const[view,setView]=useState<View>(),[open,setOpen]=useState(false),[error,setError]=useState(''),[copied,setCopied]=useState(false);
  useEffect(()=>{const state=(e:Event)=>{setView((e as CustomEvent<View>).detail);setCopied(false)},display=()=>{setOpen(true);setError('')};window.addEventListener('standard-update-state',state);window.addEventListener('standard-update-open',display);void api('client').then(announce).catch(()=>{});return()=>{window.removeEventListener('standard-update-state',state);window.removeEventListener('standard-update-open',display)}},[]);
  const release=view?.release;
  async function dismiss(action:string){try{announce(await api('dismiss','POST',{action}));setOpen(false)}catch(e){setError(e instanceof Error?e.message:'操作失败')}}
  return <Dialog.Root open={open} onOpenChange={setOpen}><Dialog.Portal><Dialog.Overlay className="pro-flow-overlay"/><Dialog.Content className="standard-update-dialog" aria-describedby={undefined}><header><img src="/opentake-icon-512.png" alt=""/><div><Dialog.Title>OpenTake Standard {release?.version??pkg.version}</Dialog.Title><small>当前 {pkg.version} · 构建 {metadata.windowsBuild}</small></div></header><div className="update-notes"><h4>Windows 更新说明</h4>{view?.offline?<p role="status">{view.message}</p>:<ul>{(release?.notes||'请在“关于与更新”中检查 Windows 更新。').split('\n').filter(Boolean).map((line,index)=><li key={index}>{line}</li>)}</ul>}</div>{view?.available&&release&&!view.offline&&<div className="update-ways"><div className="recommended"><b>下载安装包</b><p>{release.version} · 构建 {release.windowsBuild} · Windows x64 · {(release.size/1024/1024).toFixed(1)} MB</p><p>在浏览器中下载。请保存工作并退出软件，再运行安装包完成更新。</p><a className="primary windows-update-download" href={release.url} target="_blank" rel="noreferrer">下载 Windows 安装包 ↗</a><p><small>SHA-256</small><code className="windows-update-hash">{release.sha256}</code></p><button onClick={()=>void navigator.clipboard.writeText(release.sha256).then(()=>setCopied(true)).catch(()=>setError('复制失败，请手动选中校验码'))}>{copied?'已复制校验码':'复制校验码'}</button></div></div>}<footer><small>每天检查一次，可在设置里关闭</small><button onClick={()=>void dismiss('later')}>稍后提醒</button><button disabled={!release} onClick={()=>void dismiss('skip')}>跳过这个版本</button></footer>{error&&<p role="alert">{error}</p>}<Dialog.Close className="update-close" aria-label="关闭更新窗口">×</Dialog.Close></Dialog.Content></Dialog.Portal></Dialog.Root>;
}
