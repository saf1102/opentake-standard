import {useEffect,useState} from 'react'
import {EnvironmentResults} from '../standard/EnvironmentResults'
import type {EnvironmentCheck} from '../../shared/creation-tools'
export function CreationEnvironment(){
 const [value,setValue]=useState<EnvironmentCheck>();const [busy,setBusy]=useState(false);const [error,setError]=useState('');
 const check=async()=>{setBusy(true);setError('');try{const response=await fetch('/api/environment');if(!response.ok)throw Error();const data=await response.json();setValue(data.items?data:{ok:data.ffmpeg.ok,checkedAt:'',items:[{id:'ffmpeg',label:'FFmpeg / ffprobe',...data.ffmpeg}]})}catch{setError('环境检查失败，请重试')}finally{setBusy(false)}};
 useEffect(()=>{void check()},[]);
 return <section><h3>出片工具环境检查</h3>{value&&<EnvironmentResults value={value}/>}<p role="status" style={{color:'#9869dc'}}>{busy?'正在检查…':error}</p><button disabled={busy} onClick={()=>void check()}>重新检查</button></section>
}
