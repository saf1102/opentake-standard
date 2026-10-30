import {useEffect,useRef,useState,type CSSProperties} from 'react';
import {createPortal} from 'react-dom';
import {useNavigate} from 'react-router';
import {AgentMark} from '@/studio/components/AgentMark';
import type {AgentId} from '@/studio/agent-marks';
import {useAccountAndFirstRun,deployDescription,pendingAgents} from './edition';
import {DEPLOY_ITEMS,openSettings,recheck,runAll,setDeployOpen,summary,useDeploy,useDeployOpen,type CheckAction,type DeployItemId} from './onboarding-store';
import './deploy.css';

const SYMBOL:Record<string,string>={ok:'✓',warn:'!',act:'!',opt:'–',wait:'·',checking:''};


/** The sign-in the desktop shell holds feeds the account row; and on this Mac's first sign-in, the window opens once by itself. */

function Ring({ok,total}:{ok:number;total:number}){
 return <svg className="ot-deploy-ring" viewBox="0 0 28 28" aria-hidden="true"><circle cx="14" cy="14" r="11" fill="#ffffff22" stroke="#ffffff44" strokeWidth="3"/><circle cx="14" cy="14" r="11" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeDasharray="69" strokeDashoffset={69-69*ok/Math.max(1,total)} transform="rotate(-90 14 14)"/></svg>;
}

/** The header button: bright purple while something still needs doing, a quiet tick once this Mac is ready. */
export function DeployButton(){
 useAccountAndFirstRun();
 const s=summary(useDeploy());
 if(s.ready)return <button className="ot-deploy-nav is-ready" onClick={()=>setDeployOpen(true)} title="这台电脑已准备好，点开可以重新检查"><span className="ot-deploy-tick" aria-hidden="true">✓</span>已就绪</button>;
 return <button className="ot-deploy-nav" onClick={()=>setDeployOpen(true)} aria-label={`一键部署，必须项已就绪 ${s.okRequired} / ${s.required}`}>
  <Ring ok={s.okRequired} total={s.required}/><span>{s.done?`一键部署 · ${s.okRequired} / ${s.required}`:'一键部署'}</span>
 </button>;
}

/** The home page's strip, only while this Mac is not ready yet. */
export function DeployStrip(){
 const s=summary(useDeploy());
 if(s.ready||!s.done)return null;
 return <section className="ot-deploy-strip" aria-label="一键部署">
  <div><b>先花 2 分钟，把这台电脑准备好</b><span>{deployDescription}</span></div>
  <button className="ot-deploy-nav" onClick={()=>setDeployOpen(true)}><Ring ok={s.okRequired} total={s.required}/><span>一键部署</span></button>
 </section>;
}

export function DeployWizard(){
 const open=useDeployOpen(),snap=useDeploy(),s=summary(snap),navigate=useNavigate();
 const dialog=useRef<HTMLDivElement>(null);
 const [watching,setWatching]=useState<DeployItemId|null>(null);
 // every opening is a fresh check of this Mac
 useEffect(()=>{if(open)void runAll()},[open]);
 useEffect(()=>{if(!open)return;const key=(e:KeyboardEvent)=>{if(e.key==='Escape')setDeployOpen(false)};window.addEventListener('keydown',key);requestAnimationFrame(()=>dialog.current?.focus());return()=>window.removeEventListener('keydown',key)},[open]);
 // after a fix that happens elsewhere (Terminal, a browser, settings), check that row again until it is done
 useEffect(()=>{
  if(!watching)return;
  let tries=0;const timer=setInterval(()=>{tries++;void recheck(watching).then(r=>{if(r.state==='ok'||r.state==='warn'||tries>=40)setWatching(null)})},4000);
  return()=>clearInterval(timer);
 },[watching]);
 if(!open)return null;
 const act=async(id:DeployItemId,action:CheckAction)=>{
  if(action.kind==='codex-login'){await fetch('/api/editor/agent-settings/installation/codex/login',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});setWatching(id)}
  else if(action.kind==='reader-login'){await fetch('/api/reader-browser',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({site:action.target})});setWatching(id)}
  else if(action.kind==='link'){window.open(action.target,'_blank','noreferrer');setWatching(id)}
  else if(action.kind==='system'){await fetch(`/api/editor/onboarding/system/${encodeURIComponent(action.target||'')}`,{method:'POST'})}
  else if(action.kind==='route'){setDeployOpen(false);navigate(action.target||'/')}
  else{setDeployOpen(false);openSettings(action.target||'agents')}
 };
 const checking=snap.running;
 const title=s.ready?'可以开工了':checking?'正在检查这台电脑':`还差 ${s.required-s.okRequired} 项`;
 const sub=s.ready?(s.allOk?'全部就绪':'可选的几项，用到时再登录也行'):checking?`已查 ${s.done} / ${s.total} 项`:'点紫色的按钮补上，补完自动再查一遍';
 let n=0,group='';
 return createPortal(<div className="ot-deploy-veil" onMouseDown={e=>{if(e.target===e.currentTarget)setDeployOpen(false)}}>
  <div ref={dialog} className={`ot-deploy${s.ready?' is-ready':''}`} role="dialog" aria-modal="true" aria-labelledby="ot-deploy-title" tabIndex={-1}>
   <div className="ot-deploy-left">
    <button className="ot-deploy-close" onClick={()=>setDeployOpen(false)}>✕ 稍后再说</button>
    <span className="ot-deploy-glow" aria-hidden="true"/><div className="ot-deploy-mark" aria-hidden="true"/>
    <h2 id="ot-deploy-title">{title}</h2><p aria-live="polite">{sub}</p>
    <div className="ot-deploy-meter" aria-hidden="true">{DEPLOY_ITEMS.map(item=>{const st=snap.rows[item.id]?.state;return <i key={item.id} className={st==='ok'||st==='warn'?'ok':st==='act'?'act':''}/>})}</div>
    <p className="ot-deploy-privacy">🔒 只检测电脑性能，以及各个 agent 装在哪、能不能用。<br/>不会读取你的任何账号信息，结果只存在本机。</p>
    <button className="ot-deploy-go" onClick={()=>setDeployOpen(false)} tabIndex={s.ready?0:-1}>可以开工了 →</button>
   </div>
   <div className="ot-deploy-list">
    {DEPLOY_ITEMS.map(item=>{
     const optional='optional' in item,label=optional?'可选 · 用到再登录':'必须';
     const head=label!==group?(group=label,<div className="ot-deploy-grp" key={`g-${label}`}><span>{label}</span><span>{optional?'可以跳过':'全部就绪才能开工'}</span></div>):null;
     const row=snap.rows[item.id],state=row?.state||'wait',result=row?.result,done=state!=='wait'&&state!=='checking';
     const msg=state==='checking'&&!result?'检查中…':state==='wait'?'等待检查':result?.text||'';
     return [head,<div key={item.id} className="ot-deploy-item" data-s={state} style={{'--i':n++} as CSSProperties}>
      <span className="ot-deploy-st">{SYMBOL[state]}</span>
      <div><b>{item.title}</b><small>{msg}</small></div>
      <span className="ot-deploy-slot">{done&&result?.action&&(state==='act'||state==='opt'||(state==='ok'&&result.action.kind==='system'))?<button className="ot-deploy-act" onClick={()=>void act(item.id,result.action!)}>{watching===item.id?'等待完成…':result.action.label}</button>:optional&&state==='ok'?<span className="ot-deploy-tag">可选</span>:null}</span>
      {item.id==='perf'&&<div className={`ot-deploy-chips${done?'':' is-pending'}`}>{(result?.chips||['CPU','GPU','内存','系统','系统盘','硬件编码']).map(chip=><span key={chip}>{chip}</span>)}</div>}
      {item.id==='agent'&&<div className="ot-deploy-agents">{(result?.agents||pendingAgents.map(id=>({id,name:{codex:'Codex',claude:'Claude Code',kimi:'Kimi',deepseek:'DeepSeek',minimax:'MiniMax Code',codebuddy:'CodeBuddy'}[id],line:'',state:'off' as const,status:''}))).map(tile=>
       <div key={tile.id} className={`ot-deploy-agent${!result?' is-pending':tile.state==='on'?' is-on':tile.state==='off'?' is-off':''}`}>
        <span className="ot-deploy-logo"><AgentMark id={tile.id as AgentId} size={24}/></span>
        <b><i/>{tile.name}</b><small>{result?tile.line:' '}</small><span>{result?tile.status:state==='checking'?'检查中…':'等待检查'}</span>
       </div>)}</div>}
     </div>];
    })}
   </div>
  </div>
 </div>,document.body);
}
