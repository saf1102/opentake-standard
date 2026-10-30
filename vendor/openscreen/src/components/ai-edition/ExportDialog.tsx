import {useEffect,useRef} from 'react';
import type {AxcutDocument} from '@/lib/ai-edition/schema';
import {requestSharedExportDialog} from '@/linkreader/bridge';
import {useProjectStore} from '@/lib/ai-edition/store/projectStore';
export function ExportDialog({open,onClose,document}:{open:boolean;onClose:()=>void;document:AxcutDocument|null}) {
 const opening=useRef(false);
 useEffect(()=>{
  if(!open||!document||opening.current)return;
  opening.current=true;
  // bridge 向宿主发出持久可见的错误横条，不依赖 iframe 内易被遮挡的 toast。
  void requestSharedExportDialog(document,useProjectStore.getState().dirty).catch(()=>{}).finally(()=>{opening.current=false;onClose();});
 },[open,document,onClose]);
 return null;
}
