import {EnvironmentResults} from '../standard/EnvironmentResults'
import type {EnvironmentCheck} from '../../shared/creation-tools'
import {AboutUpdate} from '../standard/ClientUpdate'
import {useEffect,useState} from 'react'
import {Settings} from 'lucide-react'
import {Dialog,DialogContent,DialogTitle,DialogDescription,DialogTrigger} from '@/components/ui/dialog'
import {ThemeSwitcher} from '@/workspace/ThemeSwitcher'
import AgentSettings from '@/pages/StandardSettings'
import './system-settings.css'
import pkg from '../../package.json'
function MediaDoctor(){
 const [value,setValue]=useState<EnvironmentCheck>();const [busy,setBusy]=useState(false);const [error,setError]=useState('');
 const check=async()=>{setBusy(true);setError('');try{const response=await fetch('/api/environment');if(!response.ok)throw Error();const data=await response.json();setValue(data.items?data:{ok:data.ffmpeg.ok,checkedAt:'',items:[{id:'ffmpeg',label:'FFmpeg / ffprobe',...data.ffmpeg}]})}catch{setError('环境检查失败，请重试')}finally{setBusy(false)}};
 useEffect(()=>{void check()},[]);
 return <section><h3>出片工具环境检查</h3>{value&&<EnvironmentResults value={value}/>}<p role="status" style={{color:'#9869dc'}}>{busy?'正在检查…':error}</p><button disabled={busy} onClick={()=>void check()}>重新检查</button></section>
}
export function StandardAbout(){return <><AboutUpdate/><MediaDoctor/><section><h3>OpenTake Standard</h3><p>版本 {pkg.version}</p><p>通用剪辑与录屏运镜，开源创作工作台。</p><p>只有升级查询与主动申请时联网。申请收集名字、联系方式、用途和密码摘要；网络地址用于防刷并在 90 天后清理。会话保存在用户数据目录，不在工程里。</p><p>代码采用 AGPL-3.0。OpenTake 名字和 T 图标不随代码授权。</p><a href="/NOTICE" target="_blank" rel="noreferrer">开源许可与第三方署名</a></section></>}
export function SystemSettings(){const [open,setOpen]=useState(false),[group,setGroup]=useState('general');return <Dialog open={open} onOpenChange={setOpen}><DialogTrigger asChild><button className="system-settings-entry" aria-label="系统设置" title="系统设置"><Settings size={17}/><span>系统设置</span></button></DialogTrigger><DialogContent className="system-settings" showCloseButton={false}><header><div><DialogTitle>系统设置</DialogTitle><DialogDescription>管理这台电脑上的创作环境与默认行为。</DialogDescription></div><button onClick={()=>setOpen(false)} aria-label="关闭系统设置">关闭</button></header><div className="system-settings-layout"><nav aria-label="设置分类">{[['general','通用与外观'],['agents','已接入的 Agent'],['about','关于与更新']].map(([id,label])=><button key={id} aria-current={group===id?'page':undefined} onClick={()=>setGroup(id)}>{label}</button>)}</nav><main id="settings-panel">{group==='general'?<><h2>通用与外观</h2><section><h3>界面主题</h3><p>即时应用，保留当前工作台布局。</p><ThemeSwitcher/></section><section><h3>工程自动保存</h3><p>编辑后自动保存；保存失败会在编辑器中提示。</p></section></>:group==='agents'?<AgentSettings/>:<StandardAbout/>}</main></div><footer><span>Agent 设置在对应分组独立保存</span></footer></DialogContent></Dialog>}
