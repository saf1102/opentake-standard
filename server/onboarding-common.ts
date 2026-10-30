import fs from 'node:fs';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {agentSettingsFile,atomicAgentJson} from './agent-settings.ts';
import {agentInstallationStatus} from './agent-installations.ts';
import {defaultProjectRoot,pathStatus} from './system-settings.ts';
import {openScreenEnvironmentStatus} from './editor/openscreen.ts';
export type OnboardingCheck='perf'|'parts'|'agent'|'disk'|'reader'|'stats'|'seedance'|'voice'|'openscreen';
/** ok：好了；warn：能用但要知道；act：必须补上才能开工；opt：可选，没接入时哪些功能用不了。 */
export type CheckState='ok'|'warn'|'act'|'opt';
/** 要动手时去哪里：登录 Codex（在终端里）、读取器浏览器登录、设置的某一栏、某个页面、外部下载页。 */
export type CheckAction={kind:'codex-login'|'reader-login'|'settings'|'route'|'link'|'system';label:string;target?:string};
export type AgentTile={id:string;name:string;line:string;state:'on'|'found'|'off';status:string};
export type ScreenGuide={state:'missing'|'outdated'|'permission-unknown';version?:string;minimum:string};
export type CheckResult={screenGuide?:ScreenGuide;id:OnboardingCheck;state:CheckState;text:string;chips?:string[];agents?:AgentTile[];action?:CheckAction};

const gb=(bytes:number)=>Math.round(bytes/1024**3);
export function disk():CheckResult{
 const status=pathStatus(defaultProjectRoot());
 const where=status.path.split(path.sep)[1]==='Volumes'?`外置盘 ${status.path.split('/')[2]}`:'本机';
 if(!status.online||!status.writable)return {id:'disk',state:'act',text:`工程文件夹用不了：${status.error||status.path}`,action:{kind:'settings',label:'换个文件夹',target:'storage'}};
 const free=status.freeBytes===undefined?'':` · 剩 ${status.freeBytes>=1024**4?`${(status.freeBytes/1024**4).toFixed(1)} TB`:`${gb(status.freeBytes)} GB`}`;
 return {id:'disk',state:'ok',text:`${where} · 可写${free}`};
}

/** 录屏运镜的录制和导出都调用 OpenScreen（10-27：官方 2.1.2 验证能用，1.10.0 打不开 v7 工程）。 */
export const OPENSCREEN_MIN='2.1';
export function versionBelow(version:string,min:string){
 const a=version.split('.').map(n=>parseInt(n,10)||0),b=min.split('.').map(n=>parseInt(n,10)||0);
 for(let i=0;i<Math.max(a.length,b.length);i++){if((a[i]||0)!==(b[i]||0))return (a[i]||0)<(b[i]||0)}
 return false;
}
export async function openscreen():Promise<CheckResult>{
 return openScreenCheckResult(await openScreenEnvironmentStatus(),process.platform);
}
/** Shared by deployment and the recording page. Unknown permission is never reported as denied. */
export function openScreenCheckResult(environment:{installed:boolean;version?:string},platform:NodeJS.Platform):CheckResult{
 const guide=(state:ScreenGuide['state'])=>platform==='darwin'?{screenGuide:{state,version:environment.version,minimum:OPENSCREEN_MIN}}:{};
 const status={state:environment.installed?'found':'missing',version:environment.version};const tool={page:'https://github.com/getopenscreen/openscreen/releases/latest'};
 if(status.state!=='found')return {...guide('missing'),id:'openscreen',state:'opt',text:'没安装 · 录屏运镜的录制和导出都要用它',action:{kind:'link',label:'去下载',target:tool.page}};
 if(status.version&&versionBelow(status.version,OPENSCREEN_MIN))return {...guide('outdated'),id:'openscreen',state:'opt',text:`版本太旧（${status.version}）· 录屏运镜要 ${OPENSCREEN_MIN} 以上`,action:{kind:'link',label:'去下载新版',target:tool.page}};
 // 屏幕录制权限是 OpenScreen 自己的，这里读不到，只提醒
 return {...guide('permission-unknown'),id:'openscreen',state:'ok',text:`已安装${status.version?` · ${status.version}`:''} · 还要给它开「屏幕录制」权限：系统设置 → 隐私与安全性 → 屏幕录制`,action:{kind:'system',label:'打开屏幕录制设置',target:'screen-recording'}};
}

/** 一键部署里能直接打开的系统设置页（只认这几个）。 */
const SYSTEM_PANES:Record<string,string>={'screen-recording':'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture'};
export async function openSystemPane(target:string){
 const url=SYSTEM_PANES[target];if(!url)throw Error('不认识要打开的设置');
 if(process.platform!=='darwin')throw Error('只有 Mac 能打开');
 await promisify(execFile)('open',[url],{timeout:10000});
 return {opened:target};
}

/** Whether the first-run check was shown on this Mac, kept beside the other settings (a dynamic port rules out browser storage). */
const seenFile=()=>path.join(path.dirname(agentSettingsFile()),'onboarding.json');
export function onboardingSeen():{seenAt?:string}{try{return JSON.parse(fs.readFileSync(seenFile(),'utf8'))}catch{return {}}}
export function markOnboardingSeen(){const value={seenAt:new Date().toISOString()};atomicAgentJson(seenFile(),value);return value}

export async function codex():Promise<CheckResult>{
 const status=await agentInstallationStatus('codex');
 const tile={id:'codex',name:'Codex',line:status.version||'没有检测到',state:status.state==='ready'?'on' as const:status.executable?'found' as const:'off' as const,status:status.state==='ready'?'已接入 · 现在用它出片':status.executable?'已安装 · 还没登录':'未安装'};
 if(status.state==='ready')return {id:'agent',state:'ok',text:'Codex 已登录，现在用它出片',agents:[tile]};
 if(status.state==='needs-login')return {id:'agent',state:'act',text:'Codex 已安装，还没有登录',agents:[tile],action:{kind:'codex-login',label:'登录 Codex'}};
 return {id:'agent',state:'act',text:status.executable?'Codex 登录状态未确认，请在设置里重新检测':'没有检测到 Codex，请在设置里安装或选择程序路径',agents:[tile],action:{kind:'settings',label:'打开 Codex 设置',target:'agents'}};
}

/** Separate from the deployment wizard; stable across local server port changes. */
const generalSeenFile=()=>path.join(path.dirname(agentSettingsFile()),'general-agent-onboarding.json');
export function generalAgentOnboardingSeen():{seenAt?:string}{
 try{const value=JSON.parse(fs.readFileSync(generalSeenFile(),'utf8'));return typeof value.seenAt==='string'?{seenAt:value.seenAt}:{}}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return {};throw Error('首次选择记录暂时读不到，请重试')}
}
export function markGeneralAgentOnboardingSeen(){const value={seenAt:new Date().toISOString()};atomicAgentJson(generalSeenFile(),value);return value}
