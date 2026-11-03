import {useEffect,useState} from 'react';
type View={paths:{app:string;drafts:string};detected:{app:string;drafts:string}};
export function JianyingSettings(){
 const [view,setView]=useState<View|null>(null),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 const load=async(method='GET',body?:unknown)=>{
  const response=await fetch('/api/editor/system-settings/jianying',{method,headers:{'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
  const value=await response.json();if(!response.ok||!value.ok)throw Error(value.error||'剪映设置读取失败');
  if(!value.result?.paths||typeof value.result.paths.app!=='string'||typeof value.result.paths.drafts!=='string'||!value.result.detected)throw Error('剪映设置响应无效，请重启软件后重试');
  setView(value.result);
 };
 useEffect(()=>{void load().catch(error=>setMessage(String(error.message)))},[]);
 return <section><h3>剪映路径</h3><p>草稿生成组件已随 OpenTake 提供。安装剪映后，可在其中打开草稿继续编辑；导入前请保存并退出剪映。</p>
 {view&&<>{([['app','剪映程序路径'],['drafts','剪映草稿目录']] as const).map(([key,label])=><label key={key}>{label}<input value={view.paths[key]} placeholder={view.detected[key]||'留空自动检测，可填写自定义绝对路径'} onChange={event=>setView({...view,paths:{...view.paths,[key]:event.target.value}})}/></label>)}
 <p>草稿目录应包含 root_meta_info.json；可在剪映设置中查看草稿位置。</p>
 <button disabled={busy} onClick={async()=>{setBusy(true);setMessage('');try{await load('PUT',view.paths);setMessage('剪映路径已保存')}catch(error){setMessage(error instanceof Error?error.message:String(error))}finally{setBusy(false)}}}>保存剪映路径</button></>}
 {message&&<p role="status">{message}</p>}</section>;
}
