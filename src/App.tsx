import {ClientUpdate} from './standard/ClientUpdate';
import {Routes,Route,Link,useParams} from 'react-router';
import {Toaster} from 'sonner';
import {useEffect,useRef,useState} from 'react';
import GeneralEdit from './pages/GeneralEdit';
import GeneralProject from './pages/GeneralProject';
import StyleLibraryPage from './pages/StyleLibraryPage';
import Screen from './pages/OpenScreenWorkspace';
import Home from './pages/WorkspaceHome';
import StudioProjects from './pages/StudioProjects';
import {WorkspaceNavigation} from './workspace/WorkspaceNavigation';
import {WorkspaceNavigationProvider} from './workspace/navigation-guard';
import {StandardAbout} from './settings/SystemSettings';
import {modules} from './standard/modules';
import {UpgradeDialog,openUpgrade} from './standard/Upgrade';
export const upgrade=openUpgrade;
function Pro(){
 const {id}=useParams();const m=modules.find(x=>x.id===id&&x.pro);const video=useRef<HTMLVideoElement>(null);
 const [reduced,setReduced]=useState(()=>matchMedia('(prefers-reduced-motion: reduce)').matches);
 useEffect(()=>{const q=matchMedia('(prefers-reduced-motion: reduce)');const change=()=>setReduced(q.matches);q.addEventListener('change',change);return()=>q.removeEventListener('change',change)},[]);
 useEffect(()=>{const v=video.current;if(!v)return;const update=()=>{if(reduced||document.hidden){v.pause();if(reduced)v.currentTime=0}else void v.play().catch(()=>{})};update();document.addEventListener('visibilitychange',update);return()=>{v.pause();document.removeEventListener('visibilitychange',update)}},[reduced,m?.id]);
 if(!m||!m.pro)return <main className="standard-page"><h1>页面不存在</h1><Link to="/">返回首页</Link></main>;
 return <main className="home-soon workspace-dashboard standard-pro-page"><section className="home-entry standard-pro-intro" data-kind="koubo"><div className="standard-pro-media">{reduced?<img src={m.poster} alt={m.name+'概念封面'}/>:<video key={m.id} ref={video} src={m.video} poster={m.poster} aria-label={m.name+'概念演示'} muted playsInline loop autoPlay/>}</div><div className="standard-pro-copy"><div className="standard-pro-title"><h1>{m.name}</h1><span className="home-only standard-pro-badge">Pro</span></div><p>{m.description}</p><div className="standard-pro-actions"><button className="home-entry__button" onClick={upgrade}>升级到 Pro</button><Link to="/">返回首页</Link></div></div></section></main>
}
export default function App(){return <WorkspaceNavigationProvider><UpgradeDialog/><ClientUpdate/><WorkspaceNavigation/><div className="workspace-content"><Routes><Route path="/" element={<Home/>}/><Route path="/general" element={<GeneralEdit/>}/><Route path="/general/projects/:id" element={<GeneralProject/>}/><Route path="/styles" element={<StyleLibraryPage/>}/><Route path="/studio" element={<StudioProjects/>}/><Route path="/screen-motion" element={<StudioProjects/>}/><Route path="/screen-motion/projects/:id" element={<Screen/>}/><Route path="/about" element={<div className="system-settings"><main><StandardAbout/></main></div>}/><Route path="/pro/:id" element={<Pro/>}/><Route path="*" element={<main className="workspace-dashboard"><h1>页面不存在</h1><Link to="/">返回首页</Link></main>}/></Routes></div><Toaster theme="dark" richColors position="top-center"/></WorkspaceNavigationProvider>}
