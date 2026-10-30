import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {JSDOM} from 'jsdom';
const root=fileURLToPath(new URL('../',import.meta.url));
const tick=()=>new Promise(resolve=>setTimeout(resolve,10));
async function mount(file:string,state:any){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'task17-onboarding-'));fs.symlinkSync(path.join(root,'node_modules'),path.join(dir,'node_modules'),'dir');
 const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost/',pretendToBeVisual:true});const old=new Map<string,PropertyDescriptor|undefined>();Object.defineProperty(dom.window.navigator,'platform',{value:state.platform||'MacIntel',configurable:true});
 const fetch=async(url:string,options:any={})=>{state.requests.push([url,options.method||'GET']);if(url.endsWith('/module/generalEditing'))state.saved=JSON.parse(options.body);return {ok:true,json:async()=>url.endsWith('/module/generalEditing')?{ok:true,result:{}}:url.endsWith('/general-choice')?{ok:true,result:options.method==='POST'?{seenAt:'saved'}:{}}:url.includes('/system/')?{ok:true,result:{opened:'screen-recording'}}:{ok:true,result:state.screen}}};
 for(const [key,value] of Object.entries({window:dom.window,document:dom.window.document,navigator:dom.window.navigator,Event:dom.window.Event,fetch,IS_REACT_ACT_ENVIRONMENT:true,__task17Onboarding:state})){old.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{value,writable:true,configurable:true})}
 const mocks:Record<string,string>={
  '@/studio/connections':`export const connectionRequest=async()=>{globalThis.__task17Onboarding.connectionReads=(globalThis.__task17Onboarding.connectionReads||0)+1;return {connections:globalThis.__task17Onboarding.connections}};`,
  '@/studio/components/ConnectionSettings':`export function ConnectionEditor({connection,onChanged,onDirtyChange}){return <div><button onClick={()=>onDirtyChange(true)}>修改地址</button><button onClick={()=>onChanged({...connection,connected:true})}>连接通过</button></div>}`,
  '@/studio/api':`export const getAgentSettings=async()=>({settings:{version:1,cliPath:'',modules:{generalEditing:{model:'default',effort:'medium'},keep:{model:'keep'}}}});export const saveAgentSettings=async(settings)=>{globalThis.__task17Onboarding.saved=settings};`,
 };
 const outfile=path.join(dir,'ui.mjs');await build({stdin:{contents:`import React,{act} from 'react';import{createRoot}from'react-dom/client';import{${file==='hook'?'useFirstAgentChoice':file==='first'?'FirstAgentChoice':'ScreenSetupGuide'} as Exported}from'./src/${file==='screen'?'screen-motion/ScreenSetupGuide':'general/FirstAgentChoice'}';export{act,createRoot};function View(){${file==='hook'?"const choice=Exported();globalThis.__task17Onboarding.hook=choice;return choice.enabled?<button onClick={choice.show}>选择出片智能体</button>:null;":"return <Exported onDone={()=>globalThis.__task17Onboarding.done++}/>;"}}export const element=<View/>;`,loader:'tsx',resolveDir:root},outfile,bundle:true,platform:'node',format:'esm',packages:'external',jsx:'automatic',loader:{'.css':'empty'},logLevel:'silent',plugins:[{name:'mock',setup(b){b.onResolve({filter:/.*/},a=>mocks[a.path]?{path:a.path,namespace:'mock'}:undefined);b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path],loader:'tsx',resolveDir:root}))}}]});
 const h=await import(pathToFileURL(outfile).href);const app=h.createRoot(document.getElementById('root'));await h.act(async()=>{app.render(h.element);await tick()});await h.act(tick);
 return {async click(text:string){const button=[...document.querySelectorAll<HTMLButtonElement>('button')].find(x=>x.textContent?.includes(text));assert.ok(button,text);await h.act(async()=>{button.click();await tick()})},async close(){await h.act(async()=>app.unmount());dom.window.close();for(const[k,v]of old){if(v)Object.defineProperty(globalThis,k,v);else delete(globalThis as any)[k]}fs.rmSync(dir,{recursive:true,force:true})}};
}
const connection=(more={})=>({id:'codex',name:'Codex',kind:'agent',enabled:true,connected:true,cliInstalled:true,heavySupported:true,mode:'cli',model:'default',models:[],baseUrl:'https://api.openai.com/v1',hasKey:false,relay:false,state:'connected',...more});
const state=(more={})=>({requests:[] as any[],done:0,connections:[connection()],saved:undefined as any,...more});

test('任务17：首次默认选择保存到已有设置，保留其他模块；以后再说不改默认选择',async()=>{
 for(const skip of [false,true]){const s=state();const h=await mount('first',s);try{await h.click(skip?'以后再说':'用这个开始');assert.equal(s.done,1);assert.ok(s.requests.some(([url,method])=>url.endsWith('/general-choice')&&method==='POST'));if(skip)assert.equal(s.saved,undefined);else{assert.deepEqual(s.saved,{agent:'codex',model:'default',effort:'medium'});assert.ok(!('modules' in s.saved),'只写当前模块，不覆盖其他默认值')}}finally{await h.close()}}
});
test('任务17：中转站API测通且有命令行可开始，改地址后重新测通；没命令行不能出片',async()=>{
 for(const installed of [true,false]){const s=state({connections:[connection({mode:'api',relay:true,cliInstalled:installed})]});const h=await mount('first',s);try{await h.click('API 密钥');const primary=()=>document.querySelector<HTMLButtonElement>('.first-agent-primary')!;assert.equal(primary().disabled,!installed);await h.click('修改地址');assert.equal(primary().disabled,true);await h.click('连接通过');assert.equal(primary().disabled,!installed);if(!installed)assert.match(document.body.textContent||'',/需要安装 Codex 命令行/)}finally{await h.close()}}
});
test('任务17：关闭的Claude不能从首次选择开始，不自动执行CLI',async()=>{
 const s=state({connections:[connection(),connection({id:'claude',name:'Claude Code',enabled:false,connected:true})]});const h=await mount('first',s);try{await h.click('Claude Code');assert.equal(document.querySelector<HTMLButtonElement>('.first-agent-primary')!.disabled,true);assert.equal(s.requests.length,0)}finally{await h.close()}
});
test('任务17：录屏缺安装/旧版本/权限未知显示真实引导，重检复用部署接口且不启动录制',async()=>{
 for(const kind of ['missing','outdated','permission-unknown']){const s=state({screen:{screenGuide:{state:kind,version:'1.10.0',minimum:'2.1'}}});const h=await mount('screen',s);try{assert.match(document.querySelector('h2')!.textContent!,kind==='missing'?/先装好/:kind==='outdated'?/更新/:/权限/);const primary=document.querySelectorAll('.screen-setup-guide .screen-setup-primary');assert.equal(primary.length,1);assert.equal(primary[0].textContent,kind==='missing'?'去下载':kind==='outdated'?'去下载新版':'打开屏幕录制设置');assert.ok(document.querySelector('.screen-setup-notice')?.textContent);if(kind==='permission-unknown'){assert.match(document.body.textContent||'',/无法读取/);await h.click('打开屏幕录制设置');assert.ok(s.requests.some(([url])=>url.endsWith('/system/screen-recording')))}else assert.match(document.querySelector('a')!.href,/getopenscreen\/openscreen\/releases\/latest/);await h.click('重新检测');assert.equal(s.requests.filter(([url])=>url.endsWith('/onboarding/openscreen')).length,2);assert.ok(s.requests.every(([url])=>!url.includes('/capture')))}finally{await h.close()}}
});
test('任务17：部署和录屏页同用结构化结果，Windows不添加新引导；首次记录损坏不会被空写覆盖',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'task17-onboarding-server-'));const outfile=path.join(dir,'check.mjs');
 try{await build({entryPoints:[path.join(root,'server/onboarding-common.ts')],outfile,bundle:true,platform:'node',format:'esm',packages:'external',logLevel:'silent',plugins:[{name:'fixture',setup(b){b.onResolve({filter:/agent-installations\.ts$|agent-settings\.ts$|system-settings\.ts$|editor\/openscreen\.ts$/},a=>({path:a.path,namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:a.path.endsWith('agent-settings.ts')?`import fs from'node:fs';export const agentSettingsFile=()=>${JSON.stringify(path.join(dir,'settings.json'))};export const atomicAgentJson=(p,v)=>fs.writeFileSync(p,JSON.stringify(v));`:a.path.endsWith('agent-installations.ts')?`export const agentInstallationStatus=async()=>({});`:a.path.endsWith('system-settings.ts')?`export const defaultProjectRoot=()=>'/unused';export const pathStatus=()=>({});`:`export const openScreenEnvironmentStatus=()=>({});`,loader:'js'}))}}]});const c=await import(pathToFileURL(outfile).href);assert.equal(c.openScreenCheckResult({installed:false},'darwin').screenGuide.state,'missing');assert.equal(c.openScreenCheckResult({installed:true,version:'1.10.0'},'darwin').screenGuide.state,'outdated');assert.equal(c.openScreenCheckResult({installed:true,version:'2.1.2'},'darwin').screenGuide.state,'permission-unknown');assert.equal(c.openScreenCheckResult({installed:true,version:'2.1.2'},'win32').screenGuide,undefined);assert.deepEqual(c.generalAgentOnboardingSeen(),{});assert.ok(c.markGeneralAgentOnboardingSeen().seenAt);const file=path.join(dir,'general-agent-onboarding.json');fs.writeFileSync(file,'broken');assert.throws(()=>c.generalAgentOnboardingSeen(),/暂时读不到/);assert.equal(fs.readFileSync(file,'utf8'),'broken');}finally{fs.rmSync(dir,{recursive:true,force:true})}
});
test('任务17：两版部署智能体行按统一接入状态判断，Claude API就绪可出片，关闭和仅API轻活不算就绪',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'task17-deploy-agents-'));const outfile=path.join(dir,'check.mjs');
 try{await build({entryPoints:[path.join(root,'server/onboarding-agents.ts')],outfile,bundle:true,platform:'node',format:'esm',packages:'external',logLevel:'silent',plugins:[{name:'fixture',setup(b){b.onResolve({filter:/agent-connections\.ts$/},a=>a.path.startsWith('./')?{path:a.path,namespace:'fixture'}:undefined);b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:`export const listAgentConnections=async()=>{throw Error('本测试不得访问真实接入')};`,loader:'js'}))}}]});const c=await import(pathToFileURL(outfile).href);const ready=connection({id:'claude',name:'Claude Code',mode:'api'});assert.equal(c.agentCheckResult([ready]).state,'ok');assert.match(c.agentCheckResult([ready]).text,/Claude Code 已接通/);assert.equal(c.agentCheckResult([{...ready,enabled:false}]).state,'act');assert.equal(c.agentCheckResult([{...ready,cliInstalled:false}]).state,'act');assert.match(c.agentCheckResult([{...ready,cliInstalled:false}]).agents[0].status,/仅限轻活/);}finally{fs.rmSync(dir,{recursive:true,force:true})}
});

test('任务17：Windows首次引导、重开入口、录屏引导不显示，也不请求新增API',async()=>{
 for(const file of ['first','hook','screen']){const s=state({platform:'Win32'});const h=await mount(file,s);try{assert.equal(document.getElementById('root')!.textContent,'');assert.deepEqual(s.requests,[]);assert.equal((s as any).connectionReads||0,0);if(file==='hook'){assert.equal((s as any).hook.enabled,false);(s as any).hook.show();assert.equal((s as any).hook.open,false)}}finally{await h.close()}}
 const entrance=fs.readFileSync(path.join(root,'src/general/GeneralEntrance.tsx'),'utf8');assert.match(entrance,/firstAgent\.enabled && <button[^>]+ge-en-choose-agent/);
});

test('复审修正2：真实暖雾通用控件样式不能覆盖三种录屏引导的主按钮，加载顺序无关',async()=>{
 const guideCss=fs.readFileSync(path.join(root,'src/screen-motion/screen-setup-guide.css'),'utf8');
 const warmCss=fs.readFileSync(path.join(root,'src/workspace/warm-theme.css'),'utf8');
 for(const theme of ['original','warm'])for(const kind of ['permission-unknown','missing','outdated']){
  const h=await mount('screen',state({screen:{screenGuide:{state:kind,version:'1.10.0',minimum:'2.1'}}}));
  try{
   document.documentElement.dataset.uiTheme=theme;document.body.classList.add('studio-projects');
   for(const themeLast of [true,false]){
    const guide=document.createElement('style'),warm=document.createElement('style');guide.textContent=guideCss;warm.textContent=warmCss;
    document.head.append(...(themeLast?[guide,warm]:[warm,guide]));
    // JSDOM computes selector precedence/custom properties but does not resolve var() in colors.
    // Resolve only the card's existing variables; leave selectors and competing theme rules intact.
    const cardStyle=window.getComputedStyle(document.querySelector('.screen-setup-guide')!);
    const resolvedCss=guideCss.replace(/var\((--sg-[\w-]+)\)/g,(_all,name)=>{const value=cardStyle.getPropertyValue(name).trim();assert.ok(value,name);return value});
    guide.remove();warm.remove();guide.textContent=resolvedCss;document.head.append(...(themeLast?[guide,warm]:[warm,guide]));
    const primary=document.querySelectorAll('.screen-setup-primary');assert.equal(primary.length,1);
    const actual=window.getComputedStyle(primary[0]);
    assert.equal(actual.backgroundColor,theme==='warm'?'rgb(233, 165, 22)':'rgb(245, 179, 22)',`${theme}/${kind}/themeLast=${themeLast}`);
    assert.equal(actual.color,theme==='warm'?'rgb(43, 29, 5)':'rgb(29, 20, 4)');
    assert.equal(window.getComputedStyle(document.querySelector('.screen-setup-notice')!).color,'rgb(152, 105, 220)');
    guide.remove();warm.remove();
   }
  }finally{await h.close()}
 }
});
