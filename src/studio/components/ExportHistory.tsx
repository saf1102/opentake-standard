import {ExportMethodIcon} from './ExportMethodIcon';
import {useEffect,useRef,useState} from 'react';
import {ChevronRight,FolderOpen,Play,Trash2,ListX} from 'lucide-react';
import {exportHistoryKind,exportHistoryQuality,type ExportHistoryEntry,type ExportHistoryPage} from '../export-history';
import './export-history.css';

export function ExportHistory({projectId,refreshKey}:{projectId:string;refreshKey?:string}) {
  const [expanded,setExpanded]=useState(false),[entries,setEntries]=useState<ExportHistoryEntry[]>([]);
  const [offset,setOffset]=useState<number>(),[loading,setLoading]=useState(false),[error,setError]=useState(''),[busy,setBusy]=useState('');
  const [reload,setReload]=useState(0),[page,setPage]=useState(0);
  const [pending,setPending]=useState<{entry:ExportHistoryEntry;action:'history'|'files';filename?:string}>();
  const [notice,setNotice]=useState('');
  const trigger=useRef<HTMLButtonElement|null>(null),toggle=useRef<HTMLButtonElement|null>(null);
  useEffect(()=>{
    if(!pending)return;
    const outside=(event:PointerEvent)=>{if(!busy&&!trigger.current?.contains(event.target as Node))setPending(undefined);};
    const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.stopPropagation();if(!busy){setPending(undefined);trigger.current?.focus();}}};
    document.addEventListener('pointerdown',outside);document.addEventListener('keydown',escape,true);
    return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',escape,true);};
  },[pending,busy]);
  const alive=useRef(true);
  useEffect(()=>{setPage(0);},[refreshKey]);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  useEffect(()=>{if(!expanded)return;const controller=new AbortController();setLoading(true);setError('');
    fetch(`/api/editor/projects/${encodeURIComponent(projectId)}/exports/history?offset=${page}`,{signal:controller.signal}).then(async response=>{
      const data=await response.json();if(!response.ok||!data.ok)throw Error(data.error||'无法读取导出记录');return data.result as ExportHistoryPage;
    }).then(data=>{if(controller.signal.aborted)return;setEntries(current=>page?Array.from(new Map([...current,...data.entries].map(entry=>[entry.id,entry])).values()):data.entries);setOffset(data.nextOffset);})
      .catch(cause=>{if(!controller.signal.aborted)setError(cause instanceof Error?cause.message:'无法读取导出记录');})
      .finally(()=>{if(!controller.signal.aborted)setLoading(false);});return()=>controller.abort();
  },[projectId,expanded,refreshKey,page,reload]);
  async function open(entry:ExportHistoryEntry,filename?:string,reveal=false){
    setBusy(entry.id);setError('');
    try {const res=await fetch(`/api/editor/projects/${encodeURIComponent(projectId)}/exports/${encodeURIComponent(entry.id)}/open-history`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({filename,reveal})});const data=await res.json();if(!res.ok||!data.ok)throw Error(data.error||'无法打开导出文件');}
    catch(cause){if(alive.current)setError(cause instanceof Error?cause.message:'无法打开导出文件');}
    finally{if(alive.current)setBusy('');}
  }
  async function remove(){
    if(!pending||busy)return;
    setBusy(pending.entry.id);setError('');setNotice('');
    try {
      const res=await fetch(`/api/editor/projects/${encodeURIComponent(projectId)}/exports/${encodeURIComponent(pending.entry.id)}/${pending.action}`,{method:'DELETE',headers:{'content-type':'application/json'},body:JSON.stringify({filename:pending.filename})});
      const data=await res.json();if(!res.ok||!data.ok)throw Error(data.error||'删除失败');
      if(alive.current){setNotice(pending.action==='history'?'记录已删除，导出文件保留。':'原文件已删除，导出记录保留。');setPending(undefined);setPage(0);setReload(n=>n+1);toggle.current?.focus();}
    }catch(cause){if(alive.current)setError(cause instanceof Error?cause.message:'删除失败');}
    finally{if(alive.current)setBusy('');}
  }
  const retry=()=>{setPage(0);setReload(n=>n+1);};
  return <section className="export-history">
    <button type="button" ref={toggle} className="export-history__toggle" aria-expanded={expanded} aria-controls="export-history-list" onClick={()=>{setExpanded(value=>!value);setPage(0);}}><ChevronRight aria-hidden="true"/>导出记录</button>
    {expanded&&<div id="export-history-list" className="export-history__body">
      {error&&!pending&&<p role="alert">{error} <button type="button" onClick={retry}>重试</button></p>}
      {loading&&<p role="status">正在读取导出记录…</p>}
      {busy&&<p role="status">正在处理…</p>}
      {!loading&&!error&&!entries.length&&<p>本工程还没有已完成的导出。</p>}
      {notice&&<p role="status">{notice}</p>}
      <table className="export-history__table" aria-label="导出记录">
        <thead><tr><th scope="col">导出类型</th><th scope="col">导出时间</th><th scope="col">规格</th><th scope="col">文件操作</th><th scope="col">记录</th></tr></thead>
        <tbody>{entries.map(entry=>{const kind=exportHistoryKind(entry);
          const request=(button:HTMLButtonElement,action:'history'|'files',filename?:string)=>{trigger.current=button;setError('');setPending({entry,action,filename});};
          const locked=!!busy;
          const deleteButton=(action:'history'|'files',filename?:string)=>{
            const confirming=pending?.entry.id===entry.id&&pending.action===action&&pending.filename===filename;
            const Icon=action==='files'?Trash2:ListX;
            return <button type="button" className={confirming?'export-history__delete-confirm':undefined} disabled={locked}
              aria-label={confirming?'确定删除':action==='files'?'删除原文件':'删除记录'}
              onClick={event=>{if(confirming)void remove();else request(event.currentTarget,action,filename);}}>
              <Icon aria-hidden="true"/>{confirming?(busy?'正在删除…':'确定删除'):action==='files'?'删除原文件':'删除记录'}
            </button>;
          };
          return <tr key={entry.id}>
            <td><span className={`export-history__kind export-history__kind--${kind}`}><ExportMethodIcon kind={kind}/>{kind==='jianying'?'剪映工程':kind==='video'?'视频成片':'素材文件'}</span></td>
            <td><time dateTime={new Date(entry.completedAt).toISOString()}>{new Date(entry.completedAt).toLocaleString('zh-CN',{hour12:false})}</time></td>
            <td className="export-history__quality">{exportHistoryQuality(entry).replace(/^剪映工程 · /,'')}</td>
            <td>
              {entry.availability==='missing'&&<p>文件位置不可用，请检查文件或磁盘。</p>}
              {entry.availability==='replaced'&&<p>原文件已被另一次导出替换。</p>}
              {entry.availability==='available'&&kind==='video'&&!entry.videos.length&&<p>成片已移动或删除。</p>}
              {entry.availability==='available'&&kind==='jianying'&&!entry.packageAvailable&&<p>剪映工程包已移动或删除。</p>}
              {entry.videos.map(filename=><div className="export-history__actions" key={filename}>
                {entry.videos.length>1&&<span className="export-history__filename" title={filename}>{filename.includes('_混音成片.')?'混音成片':filename.includes('_静音母版.')?'静音母版':filename}</span>}
                <button type="button" disabled={locked} onClick={()=>void open(entry,filename)}><Play aria-hidden="true"/>打开成片</button>
                <button type="button" disabled={locked} onClick={()=>void open(entry,filename,true)}><FolderOpen aria-hidden="true"/>所在文件夹</button>
                {deleteButton('files',filename)}
              </div>)}
              {!entry.videos.length&&entry.availability==='available'&&(kind!=='jianying'||entry.packageAvailable)&&<div className="export-history__actions">
                <button type="button" disabled={locked} onClick={()=>void open(entry)}><FolderOpen aria-hidden="true"/>所在文件夹</button>
                {kind==='jianying'&&deleteButton('files')}
              </div>}
            </td>
            <td><div className="export-history__actions">{deleteButton('history')}</div>{pending?.entry.id===entry.id&&error&&<p role="alert">{error}</p>}</td>
          </tr>;
        })}</tbody>
      </table>
      {offset!==undefined&&<button type="button" disabled={loading} onClick={()=>setPage(offset)}>加载更早记录</button>}
    </div>}
  </section>;
}
