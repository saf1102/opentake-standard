import {useEffect,useState,useRef,useCallback} from 'react';
import {Archive,HardDrive,RotateCcw,Search,Trash2,File} from 'lucide-react';
import {toast} from 'sonner';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription,DialogTrigger} from '@/components/ui/dialog';
import {Button} from '@/components/ui/button';
import type {EditProject} from '@/types';

type CacheFile={path:string;name:string;projectName:string;kind:string;bytes:number;mtime:number;ino:number};
type Plan={plannedBytes:number;plannedFiles:number;warnings?:string[];files:CacheFile[]};
type Row={id:string;name:string;dir:string;cache:number;media:number;exports:number;project:number;total:number;archivedAt?:number;deletedAt?:number};
type Policy={renderBudgetGB:number;previewDays:number;temporaryDays:number;automatic:boolean};
type View={root:string;available:number;policy:Policy;projects:Row[];auxiliary:{name:string;dir:string;bytes:number|null}[]};
const size=(n:number)=>n<1024?`${n} B`:n<1024**2?`${(n/1024).toFixed(1)} KB`:n>=1024**3?`${(n/1024**3).toFixed(1)} GB`:`${(n/1024**2).toFixed(1)} MB`;
async function request<T>(url:string,method='GET',body?:unknown,signal?:AbortSignal):Promise<T>{const r=await fetch('/api/editor/'+url,{method,signal,headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined});const d=await r.json();if(!r.ok||!d.ok)throw Error(d.error||'操作失败');return d.result;}
export function ProjectStorage({project,onChanged}:{project?:EditProject;onChanged:()=>void}){
 const [canCancel,setCanCancel]=useState(false),[visibleFiles,setVisibleFiles]=useState(100);
 const pending=useRef<AbortController|null>(null);
 const send=<T,>(url:string,method='GET',body?:unknown)=>request<T>(url,method,body,pending.current?.signal);
 const [open,setOpen]=useState(false),[view,setView]=useState<View>(),[error,setError]=useState(''),[busy,setBusy]=useState(false),[plan,setPlan]=useState<Plan>(),[mode,setMode]=useState<'all'|'policy'>('policy');
 const projectId=project?.id;
 const load=useCallback(async()=>{setError('');try{setView(await request<View>('storage'+(projectId?'?projectId='+encodeURIComponent(projectId):''),'GET',undefined,pending.current?.signal))}catch(e){setError(String(e))}},[projectId]);
 useEffect(()=>{if(open){setView(undefined);setPlan(undefined);void load()}},[open,load]);
 const act=async(fn:()=>Promise<void>,cancellable=true)=>{setCanCancel(cancellable);pending.current=new AbortController();setBusy(true);setError('');try{await fn()}catch(e){setError(e instanceof Error&&e.name==='AbortError'?'已取消等待；已清理的缓存会按需重建。':e instanceof Error?e.message:String(e))}finally{pending.current=null;setBusy(false)}};
 const rows=view?.projects.filter(p=>!project||p.id===project.id)||[];
 return <Dialog open={open} onOpenChange={v=>{if(!busy)setOpen(v)}}><DialogTrigger asChild><button type="button" className="project-storage-trigger" data-archived={Boolean(project?.archivedAt&&!project.deletedAt)} title={project?.archivedAt?'已归档 · 点击恢复编辑':project?'工程存储与归档':'存储管理'} aria-label={project?`${project.archivedAt?'已归档 · ':''}存储与归档：${project.name}`:'存储管理'} onClick={e=>e.stopPropagation()}><HardDrive/>{!project&&'存储管理'}</button></DialogTrigger>
 <DialogContent className="project-storage-dialog" onClick={e=>e.stopPropagation()}><DialogHeader><DialogTitle>{project?project.name+' · 存储':'工作台存储'}</DialogTitle><DialogDescription>清理可重新生成的缓存。工程、素材库、历史版本及已导出文件保留；仍被引用的缓存会受到保护。</DialogDescription></DialogHeader>
 {!view&&!error&&<p role="status">正在统计磁盘占用…</p>}
 {view&&<><p className="project-storage-path">{view.root}<br/>所在磁盘可用 {size(view.available)}</p>
 <div className="project-storage-list">{rows.map(p=><div key={p.id}><strong>{p.name}{p.deletedAt?' · 回收站':p.archivedAt?' · 已归档':''}</strong><p>素材 {size(p.media)} · 缓存 {size(p.cache)} · 导出 {size(p.exports)} · 工程数据 {size(p.project)}</p></div>)}</div>
 {!project&&view.auxiliary.map(item=><p key={item.name} className="project-storage-path">{item.name} {item.bytes===null?'占用统计暂不可用':size(item.bytes)}<br/>{item.dir}</p>)}
 {!project&&<fieldset disabled={busy}><legend>自动清理规则</legend><label><input type="checkbox" checked={view.policy.automatic} onChange={e=>setView({...view,policy:{...view.policy,automatic:e.target.checked}})}/> 空闲时按规则管理缓存</label><label>可回收渲染缓存预算（GB）<input type="number" min="1" max="500" value={view.policy.renderBudgetGB} onChange={e=>setView({...view,policy:{...view.policy,renderBudgetGB:Number(e.target.value)}})}/></label><label>预览缓存保留天数<input type="number" min="1" max="365" value={view.policy.previewDays} onChange={e=>setView({...view,policy:{...view.policy,previewDays:Number(e.target.value)}})}/></label><Button variant="outline" onClick={()=>void act(async()=>{await send('storage/policy','PUT',view.policy);toast.success('缓存规则已保存')})}>保存规则</Button></fieldset>}
 <div className="project-storage-toolbar"><label>清理范围 <select disabled={busy} value={mode} onChange={e=>{setMode(e.target.value as 'all'|'policy');setPlan(undefined)}}><option value="policy">按容量与期限清理</option><option value="all">全部可重建缓存</option></select></label>
 <div className="project-storage-actions"><Button variant="outline" disabled={busy} onClick={()=>void act(async()=>{setPlan(undefined);setVisibleFiles(100);setPlan(await send<Plan>('storage/plan','POST',{projectId:project?.id,mode}));}) }><Search size={16}/>检查可清理空间</Button><Button disabled={busy||!plan?.files?.length} onClick={()=>void act(async()=>{const result=await send<{removedBytes:number}>('storage/clean','POST',{projectId:project?.id,mode,reviewedFiles:plan?.files.map(({path,mtime,ino})=>({path,mtime,ino}))});toast.success(`已清理约 ${size(result.removedBytes)}`);setPlan(undefined);await load();onChanged()})}><Trash2 size={16}/>{busy?'正在处理…':'清理缓存'}</Button>{busy&&canCancel&&<Button variant="outline" onClick={()=>pending.current?.abort()}>取消</Button>}</div>
 </div>
 <p>正在使用或仍被引用的缓存不计入可回收预算，也不会清理。清理后首次预览或导出可能较慢；空间统计不包含外部引用素材。</p>
 {plan?.warnings?.map(w=><p key={w} role="status">{w}</p>)}
 {plan&&<p role="status">预计释放 {size(plan.plannedBytes)}，共 {plan.plannedFiles} 个文件。执行前会再次核对引用；仅清理本次清单中未变化的文件。</p>}
 {plan&&<section className="project-storage-candidates" aria-label="可清理文件清单">{plan.files?.length?<><div className="project-storage-file-list">{plan.files.slice(0,visibleFiles).map(file=><div className="project-storage-file" key={file.path}><File size={16}/><div><strong>{file.name}</strong><span title={file.path}>{!project&&`${file.projectName} · `}{file.path}</span></div><b>{size(file.bytes)}</b></div>)}</div>{plan.files.length>visibleFiles&&<button type="button" onClick={()=>setVisibleFiles(n=>n+100)}>再显示 100 项（已显示 {Math.min(visibleFiles,plan.files.length)} / {plan.files.length}）</button>}</>:<p>当前范围内没有可安全清理的文件。</p>}</section>}

 {project&&!project.deletedAt&&<div className="project-storage-archive"><p>{project.archivedAt?'恢复编辑后将按需重建缓存。':'归档会清理可重建缓存并暂停编辑；保留所有素材及历史版本。'}</p><Button variant="outline" disabled={busy} onClick={()=>void act(async()=>{const result=await send<{warnings?:string[]}>(`projects/${project.id}/archive`,'POST',{archived:!project.archivedAt});if(result?.warnings?.length)toast.info(result.warnings.join('；'));toast.success(project.archivedAt?'已恢复编辑':'工程已归档');onChanged();setOpen(false)},false)}>{project.archivedAt?<RotateCcw size={16}/>:<Archive size={16}/>} {project.archivedAt?'恢复编辑':'归档并清理缓存'}</Button></div>}
 </>}{error&&<p role="alert">{error} <button disabled={busy} onClick={()=>void load()}>重新读取</button></p>}
 </DialogContent></Dialog>;
}
