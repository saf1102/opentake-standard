import {useEffect,useState} from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import type {CaptureSource,OpenScreenHostSession} from '@/types'
import {getRecordingSources,startNativeRecording} from '@/studio/api'
import '@/screen-motion/recording-setup.css'

export default function RecordingSetup({projectId,clientId,onStarted,onClose}:{
 projectId:string;clientId:string;onStarted:(session:OpenScreenHostSession)=>void;onClose:()=>void
}) {
 const [sources,setSources]=useState<CaptureSource[]>([])
 const [selected,setSelected]=useState('')
 const [loading,setLoading]=useState(true)
 const [starting,setStarting]=useState(false)
 const [error,setError]=useState('')
 const [duration,setDuration]=useState(0)
 const [systemAudio,setSystemAudio]=useState(false)
 const [microphone,setMicrophone]=useState(false)
 const [revision,setRevision]=useState(0)
 useEffect(()=>{
  let disposed=false
  setLoading(true);setSelected('');setError('')
  getRecordingSources().then(next=>{if(!disposed){setSources(next.filter(s=>s.type!=='microphone'));setLoading(false)}})
   .catch(reason=>{if(!disposed){setError(reason instanceof Error?reason.message:String(reason));setLoading(false)}})
  return()=>{disposed=true}
 },[revision])
 const source=sources.find(s=>`${s.type}:${s.id}`===selected)
 async function begin(){
  if(!source || source.type==='microphone' || starting)return
  setStarting(true);setError('')
  try{
   const session=await startNativeRecording(projectId,clientId,{sourceId:source.id,sourceType:source.type,durationSeconds:duration,systemAudio,microphone})
   onStarted(session)
  }catch(reason){setError(reason instanceof Error?reason.message:String(reason));setStarting(false)}
 }
 return <Dialog.Root open onOpenChange={open=>{if(!open&&!starting)onClose()}}><Dialog.Portal><Dialog.Overlay className="recording-setup-backdrop"/><Dialog.Content className="recording-setup">
  <Dialog.Title>开始录制</Dialog.Title>
  <Dialog.Description>选择这台电脑上的窗口或屏幕。录制后可从可见控制栏、OpenTake 托盘菜单或快捷键停止并保存。</Dialog.Description>
  <label>录制来源<select autoFocus value={selected} disabled={loading||starting} onChange={e=>setSelected(e.target.value)}>
   <option value="">{loading?'正在读取窗口和屏幕…':'请选择要录制的窗口或屏幕'}</option>
   {(['window','display'] as const).map(type=><optgroup key={type} label={type==='window'?'窗口':'整个屏幕'}>
    {sources.filter(s=>s.type===type).map(s=><option key={s.id} value={`${s.type}:${s.id}`}>{s.name}</option>)}
   </optgroup>)}
  </select></label><button type="button" disabled={starting||loading} onClick={()=>setRevision(value=>value+1)}>刷新来源</button>
  <label>自动停止<select value={duration} disabled={starting} onChange={e=>setDuration(Number(e.target.value))}>
   <option value={0}>手动停止</option><option value={15}>15 秒后保存</option><option value={30}>30 秒后保存</option><option value={60}>60 秒后保存</option>
  </select></label>
  <div className="recording-setup-options"><label><input type="checkbox" checked={systemAudio} disabled={starting} onChange={e=>setSystemAudio(e.target.checked)}/>系统声音</label>
   <label><input type="checkbox" checked={microphone} disabled={starting} onChange={e=>setMicrophone(e.target.checked)}/>麦克风</label></div>
  <p>已启用可编辑鼠标。遇到系统授权提示时，请自行确认。</p>
  {source?.type==='display'&&<p className="recording-setup-warning">录制整个屏幕时，可见控制栏也可能入镜。可隐藏控制栏后用快捷键停止，或改为只录制一个窗口。</p>}
  {error&&<p role="alert" className="recording-setup-warning">{error}</p>}
  <footer><button type="button" disabled={starting} onClick={onClose}>取消</button><button type="button" disabled={!source||loading||starting} onClick={()=>void begin()}>{starting?'正在准备…':'开始录制'}</button></footer>
 </Dialog.Content></Dialog.Portal></Dialog.Root>
}
