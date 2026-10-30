import {useEffect,useState,useRef} from 'react';
import {ChevronRight,Download} from 'lucide-react';
import {toast} from 'sonner';
import type {ExportJob,ExportSettings} from '../types/editor';
import type {GeneralExport,GeneralProject} from './general-contract';
import {generalEditorApi,generalApi,errorText} from './general-api';
import {ExportDialog} from '../studio/components/ExportDialog';

function History({id,refresh,onPublish}:{id:string;refresh:string;onPublish?:()=>void}) {
 const [open,setOpen]=useState(false),[entries,setEntries]=useState<GeneralExport[]>([]),[error,setError]=useState('');
 useEffect(()=>{if(!open)return;let alive=true;generalEditorApi.exportHistory(id).then(rows=>{if(alive){setEntries(rows);setError('');}},e=>{if(alive)setError(errorText(e));});return()=>{alive=false;};},[id,open,refresh]);
 return <section className="export-history"><button className="export-history__toggle" onClick={()=>setOpen(v=>!v)} aria-expanded={open}><ChevronRight/>导出记录</button>{open&&<div className="export-history__body">
 {error&&<p role="alert">{error}</p>}{!entries.length&&!error&&<p>本工程还没有导出记录。</p>}
 {entries.map(e=><div className="export-history__actions" key={e.id}><span>{new Date(e.startedAt).toLocaleString('zh-CN')} · 第 {e.version} 版 · {e.format==='jianying'?'剪映草稿':e.settings?.video.codec==='prores422'?'ProRes 422':e.settings?.video.codec==='h265'?'HEVC':'H.264'} · {e.media?`${e.media.width} × ${e.media.height} · ${e.media.fps} fps`:''} · {e.step}</span>
 {e.state==='done'&&<>{e.downloadUrl&&<a href={e.downloadUrl} download>下载成片</a>}<button onClick={()=>void generalEditorApi.revealExport(id,e.id).catch(e=>setError(errorText(e)))}>所在文件夹</button>{onPublish&&e.downloadUrl&&e.id===entries.find(e=>e.state==='done'&&e.downloadUrl)?.id&&<button onClick={onPublish}>去发布</button>}</>}{e.error&&<p>{e.error}</p>}</div>)}
 </div>}</section>;
}
export function GeneralExportButton({project,version,onPublish}:{project:GeneralProject;version:number;onPublish?:()=>void}) {
 const [open,setOpen]=useState(false),[starting,setStarting]=useState(false),[showJob,setShowJob]=useState(false);
 const [capabilities,setCapabilities]=useState<Awaited<ReturnType<typeof generalEditorApi.exportCapabilities>>>();
 const [task,setTask]=useState(project.exportTask);
 const lastState=useRef(task?`${task.id}:${task.state}`:'');
 useEffect(()=>{
  if(!task)return;const key=`${task.id}:${task.state}`;if(key===lastState.current)return;lastState.current=key;
  if(task.state==='done')toast.success('导出好了',{...(onPublish&&task.downloadUrl?{action:{label:'去发布',onClick:onPublish}}:{}),duration:15000});
  if(task.state==='failed')toast.error(task.error||'导出失败');
 },[task,onPublish]);
 useEffect(()=>setTask(project.exportTask),[project.exportTask]);
 useEffect(()=>{if(task?.state!=='running')return;const timer=setInterval(()=>{void generalApi.get(project.id).then(p=>setTask(p.exportTask)).catch(()=>{});},800);return()=>clearInterval(timer);},[project.id,task?.state]);
 const launch=async()=>{try {setCapabilities(await generalEditorApi.exportCapabilities(project.id,version));setShowJob(task?.state==='running');setOpen(true);}catch(e){toast.error(errorText(e));}};
 const start=async(settings:ExportSettings)=>{setStarting(true);try {setTask(await generalEditorApi.export(project.id,version,settings.preset==='jianying'?'jianying':'mp4',settings));setShowJob(true);}finally{setStarting(false);}};
 const job:ExportJob|undefined=showJob&&task?{id:task.id,projectId:project.id,status:task.state==='done'?'completed':task.state==='failed'?'failed':task.state==='cancelled'?'cancelled':'running',progress:task.progress*100,message:task.step,error:task.error,settings:task.settings,outputDir:task.outputDir||task.folder,createdAt:Date.parse(task.startedAt),updatedAt:Date.parse(task.endedAt||task.startedAt)}:undefined;
 return <><button type="button" className="ge-export" disabled={starting} onClick={()=>void launch()}><Download/>{task?.state==='running'?`导出 ${Math.round(task.progress*100)}%`:'导出'}</button>
 {open&&capabilities&&<ExportDialog key={`${project.id}:${version}`} projectId={project.id} projectName={`${project.name} · 通用剪辑 · 第 ${version} 版`} mode="general" apiBase={`/api/general/projects/${encodeURIComponent(project.id)}/exports`} canvas={capabilities.canvas} capabilities={capabilities} job={job} starting={starting} onClose={()=>setOpen(false)} onChooseDestination={()=>generalEditorApi.chooseExportDestination(project.id)} onStart={start}
 onRetry={async()=>{if(task?.settings)await start(task.settings);}} onRestart={async()=>setShowJob(false)} onStop={async()=>setTask(await generalEditorApi.cancelExport(project.id))} onReveal={()=>void generalEditorApi.revealExport(project.id).catch(e=>toast.error(errorText(e)))} onPublish={task?.state==='done'&&task.downloadUrl?onPublish:undefined}
 history={<History id={project.id} refresh={`${task?.id}:${task?.state}`} onPublish={onPublish}/>} />}</>;
}
