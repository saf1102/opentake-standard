import {useState} from 'react';
import {Trash2} from 'lucide-react';
import {toast} from 'sonner';
import {purgeProject} from '../api';
import {Dialog,DialogContent,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {Button} from '@/components/ui/button';
export function PurgeProjectButton({id,name,onDeleted}:{id:string;name:string;onDeleted:()=>void}){
 const [open,setOpen]=useState(false),[busy,setBusy]=useState(false);
 const remove=async()=>{setBusy(true);try{await purgeProject(id);setOpen(false);onDeleted();toast.success('工程及其存储目录已彻底删除');}catch(e){toast.error(e instanceof Error?e.message:'删除失败，请重试');}finally{setBusy(false);}};
 return <><button type="button" className="is-delete" title="彻底删除" aria-label={`彻底删除工程 ${name}`} onClick={e=>{e.stopPropagation();setOpen(true)}}><Trash2 size={17}/>彻底删除</button><Dialog open={open} onOpenChange={value=>{if(!busy)setOpen(value)}}><DialogContent><DialogTitle>彻底删除“{name}”？</DialogTitle><DialogDescription>将从磁盘永久删除该工程的整个存储目录，包括工程文件、目录内素材、缓存、生成结果和导出文件。删除后无法恢复。工程目录以外的原始素材不会删除。</DialogDescription><div className="flex justify-end gap-3"><Button variant="outline" disabled={busy} onClick={()=>setOpen(false)}>取消</Button><Button variant="destructive" disabled={busy} onClick={()=>void remove()}>{busy?'正在彻底删除…':'彻底删除，无法恢复'}</Button></div></DialogContent></Dialog></>;
}
