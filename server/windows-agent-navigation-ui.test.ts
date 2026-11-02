import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {JSDOM} from 'jsdom';
import {CONNECTION_DEFINITIONS} from '../shared/agent-connections.ts';
import {defaultAgentSettings} from '../src/studio/agent-settings.ts';

const root=fileURLToPath(new URL('../',import.meta.url));
const tick=()=>new Promise(resolve=>setTimeout(resolve,20));
async function mount(page:'deploy'|'project'|'models',offline=false){
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'windows-agent-nav-'));
 fs.symlinkSync(path.join(root,'node_modules'),path.join(temp,'node_modules'),'dir');
 const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost/general/projects/qa',pretendToBeVisual:true});
 Object.defineProperty(dom.window.navigator,'platform',{value:'Win32',configurable:true});
 const saved=new Map<string,PropertyDescriptor|undefined>();
 const globals:Record<string,unknown>={window:dom.window,document:dom.window.document,navigator:dom.window.navigator,IS_REACT_ACT_ENVIRONMENT:true};
 for(const key of ['HTMLElement','HTMLInputElement','Node','NodeFilter','Element','Event','CustomEvent','KeyboardEvent','MutationObserver'])globals[key]=(dom.window as any)[key];
 globals.getComputedStyle=dom.window.getComputedStyle.bind(dom.window);
 globals.requestAnimationFrame=dom.window.requestAnimationFrame.bind(dom.window);
 globals.cancelAnimationFrame=dom.window.cancelAnimationFrame.bind(dom.window);
 for(const[key,value]of Object.entries(globals)){saved.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{value,configurable:true,writable:true})}
 const connections=CONNECTION_DEFINITIONS.filter(c=>c.kind==='agent').map(c=>({
  id:c.id,name:c.name,kind:c.kind,mode:'cli',enabled:c.id!=='claude',connected:c.id==='codex',
  cliInstalled:['codex','kimi'].includes(c.id),heavySupported:c.id!=='claude',filmOutdated:false,
  cliAuthState:c.id==='codex'?'connected':c.id==='kimi'?'needs-login':'missing',cliLoginAvailable:c.id==='kimi',
  cliAuthMessage:c.id==='codex'?'已接通':'还没登录',cliPath:'',baseUrl:c.baseUrl,model:'default',models:[],hasKey:false,
  relay:false,state:c.id==='codex'?'connected':'unconfigured',revision:1,
 })) as any[];
 const settings=defaultAgentSettings();
 const view={settings,catalog:{executable:'codex',cliVersion:'qa',checkedAt:new Date().toISOString(),models:[{id:'qa-model',name:'QA 模型',efforts:['medium'],defaultEffort:'medium',isDefault:true}]},runs:[]};
 const requests:{url:string;method:string;body?:any}[]=[];
 const oldFetch=globalThis.fetch;
 let failConnections=offline;
 globalThis.fetch=(async(input:any,options:any={})=>{
  const url=String(input),method=options.method||'GET';requests.push({url,method,body:options.body?JSON.parse(options.body):undefined});let result:unknown;
  if(url==='/api/editor/agent-connections'){
   if(failConnections)return Response.json({ok:false,error:'测试：暂时离线'},{status:503});
   result={connections};
  }else if(url==='/api/editor/system-settings')result={revision:1,preferences:{paths:{projects:'D:/QA',cache:'',exports:'',backups:''},reserveGB:1,export:{},backup:{}},paths:{},libraries:[]};
  else if(url.startsWith('/api/editor/onboarding/'))result={id:url.split('/').at(-1),state:'ok',text:'测试就绪'};
  else if(url==='/api/agent-settings')result=view;
  else if(url==='/api/editor/agent-settings'&&method==='PUT'){view.settings=JSON.parse(options.body);result=view;}
  else if(url==='/api/editor/agent-connections/kimi/login')result={waiting:method==='POST',connection:connections.find(c=>c.id==='kimi')};
  else throw Error(`Unexpected request: ${method} ${url}`);
  return Response.json({ok:true,result});
 }) as typeof fetch;
 const outfile=path.join(temp,'harness.mjs');
 await build({stdin:{contents:`
  import React,{act}from'react';import{createRoot}from'react-dom/client';import{MemoryRouter}from'react-router';
  import{DeployButton,DeployWizard}from'./src/onboarding/DeployWizard';
  import{SystemSettings}from'./src/settings/SystemSettings';
  import{AgentPicker as GeneralPicker}from'./src/general/AgentPicker';
  import{ScopedAgentChoice}from'./src/studio/components/ScopedAgentChoice';
  import{AgentSettingsDialog}from'./src/studio/components/AgentSettingsDialog';
  import{syncDeployConnections,useDeploy,openSettings}from'./src/onboarding/onboarding-store';
  import{refreshConnections}from'./src/studio/connection-store';
  export{act,createRoot,syncDeployConnections,openSettings,refreshConnections};
  function Status(){const s=useDeploy();return <output data-agent-state={s.rows.agent?.state}/>}
  export function Harness(){return <MemoryRouter><SystemSettings/><Status/>${page==='deploy'?'<DeployButton/><DeployWizard/>':page==='models'?'<AgentSettingsDialog embedded/>':'<GeneralPicker onChange={()=>{throw Error("Navigation must not change project choice")}}/><ScopedAgentChoice work="screenEditing" onChange={()=>{throw Error("Navigation must not change project choice")}}/>'}</MemoryRouter>}
 `,resolveDir:root,loader:'tsx'},outfile,bundle:true,format:'esm',platform:'node',packages:'external',jsx:'automatic',loader:{'.css':'empty'},logLevel:'silent'});
 const h=await import(pathToFileURL(outfile).href),React=await import('react');
 const app=h.createRoot(document.getElementById('root'));
 await h.act(async()=>{app.render(React.createElement(h.Harness));await tick()});await h.act(tick);
 return {...h,connections,requests,view,
  offline(value:boolean){failConnections=value},
  async click(label:string,scope:ParentNode=document){const button=[...scope.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent?.trim()===label||b.getAttribute('aria-label')===label);assert.ok(button,label);assert.equal(button.disabled,false,label);await h.act(async()=>{button.click();await tick()});await h.act(tick)},
  async change(label:string,value:string){const el=document.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`);assert.ok(el,label);await h.act(async()=>{el.value=value;el.dispatchEvent(new dom.window.Event('change',{bubbles:true}));await tick()})},
  async close(){await h.act(async()=>app.unmount());await new Promise(resolve=>setTimeout(resolve,0));globalThis.fetch=oldFetch;dom.window.close();for(const[key,value]of saved){if(value)Object.defineProperty(globalThis,key,value);else delete(globalThis as any)[key]}fs.rmSync(temp,{recursive:true,force:true})},
 };
}
const card=(name:string)=>{const node=[...document.querySelectorAll<HTMLElement>('.ot-deploy-agent')].find(e=>e.querySelector('b')?.textContent===name);assert.ok(node,name);return node};

test('Windows ready panel exposes all agent settings/install paths and returns from the real settings dialog',async()=>{
 const h=await mount('deploy');
 try{
  await h.click('✓已就绪');assert.match(document.body.textContent||'',/智能体 · 至少要有一个/);
  assert.equal(document.querySelectorAll('.ot-deploy-agent').length,10);
  for(const c of h.connections){
   const current=card(c.name);assert.ok([...current.querySelectorAll('button')].some(b=>b.textContent==='设置 ›'));
   if(!c.cliInstalled){const install=current.querySelector<HTMLAnchorElement>('a');assert.equal(install?.href,CONNECTION_DEFINITIONS.find(d=>d.id===c.id)!.page);assert.equal(install?.target,'_blank')}
  }
  await h.click('在设置里管理 →');assert.equal(document.querySelector('.ot-deploy'),null);assert.ok(document.querySelector('.unified-connections'));
  await h.click('← 回到一键部署');assert.ok(document.querySelector('.ot-deploy'));
  for(const id of ['codex','copilot','cursor','opencode','qwen','claude','kimi','deepseek','minimax','codebuddy']){
   await h.click('设置 ›',card(h.connections.find(c=>c.id===id)!.name));
   assert.ok(document.querySelector(`#connection-editor-${id}`),id);assert.equal(document.querySelector('.ot-deploy'),null);
   const selected=document.querySelector(`#connection-row-${id}`)!;assert.equal(selected.closest('details'),null,'deep links expose uninstalled agents');
   await h.click('← 回到一键部署');assert.ok(document.querySelector('.ot-deploy'));
  }
  await h.click('填密钥',card('GitHub Copilot'));
  const editor=document.querySelector('#connection-editor-copilot')!;
  assert.ok(editor.querySelector('#connection-copilot-key'));assert.equal(editor.querySelector('button[aria-pressed="true"]')?.textContent,'API 密钥');
  await h.click('← 回到一键部署');assert.match(document.querySelector('.settings-confirm-modal')?.textContent||'',/未保存的修改/);
  await h.click('继续编辑');assert.ok(document.querySelector('#connection-editor-copilot'));
  await h.click('← 回到一键部署');await h.click('放弃修改');assert.ok(document.querySelector('.ot-deploy'));
  assert.ok(h.requests.every(r=>r.method==='GET'),'navigation never saves credentials or settings');
  h.offline(true);await h.click('重新查找');assert.match(document.querySelector('.ot-deploy-connection-error')?.textContent||'',/暂时离线/);
  h.offline(false);await h.click('重新查找');assert.equal(document.querySelector('.ot-deploy-connection-error'),null);
  await h.click('登录',card('Kimi'));assert.match(card('Kimi').textContent||'',/等你登录/);
  await h.click('取消',card('Kimi'));assert.ok([...card('Kimi').querySelectorAll('button')].some(b=>b.textContent==='登录'));
  assert.deepEqual(h.requests.filter(r=>r.method!=='GET').map(r=>[r.method,r.url]),[['POST','/api/editor/agent-connections/kimi/login'],['DELETE','/api/editor/agent-connections/kimi/login']]);
  assert.equal(window.location.pathname,'/general/projects/qa');
 }finally{await h.close()}
});

test('Windows project agent pickers open the selected connection without changing the project or defaults',async()=>{
 const h=await mount('project');
 try{
  await h.click(document.querySelector('.ge-model-pick')!.textContent!.trim());
  await h.click('管理智能体接入 →',document.querySelector('.ge-model-pop')!);
  assert.equal(document.querySelector('.ge-model-pop'),null);assert.ok(document.querySelector('#connection-editor-codex'));
  assert.equal(document.querySelector('.settings-back-deploy'),null);await h.click('关闭系统设置');
  await h.click('管理智能体接入 →',document.querySelector('.scoped-agent-choice')!);
  assert.ok(document.querySelector('#connection-editor-codex'));await h.click('关闭系统设置');
  assert.equal(window.location.pathname,'/general/projects/qa');assert.ok(h.requests.every(r=>r.method==='GET'));
 }finally{await h.close()}
});

test('Windows module selectors use supported connections and readiness excludes outdated or unsupported film routes',async()=>{
 const h=await mount('models');
 try{
  const kimi=h.connections.find(c=>c.id==='kimi')!;Object.assign(kimi,{connected:true,mode:'api',cliInstalled:false,models:[{id:'kimi-model',name:'Kimi 模型'}]});
  await h.act(async()=>{window.dispatchEvent(new Event('opentake-connections-changed'));await h.refreshConnections();await tick()});
  const options=(work:string)=>[...document.querySelectorAll<HTMLOptionElement>(`select[aria-label="${work}使用的 Agent"] option`)].map(o=>o.value);
  assert.deepEqual(options('通用剪辑出片'),['codex']);assert.deepEqual(options('录屏编辑'),['codex']);assert.ok(options('录屏字幕翻译').includes('kimi'));
  await h.change('录屏字幕翻译使用的 Agent','kimi');assert.match(document.querySelector('select[aria-label="录屏字幕翻译模型"]')!.textContent||'',/跟随 Kimi 默认/);
  await h.change('录屏字幕翻译模型','kimi-model');await h.click('保存设置');
  assert.deepEqual(h.view.settings.modules.captionTranslation,{agent:'kimi',model:'kimi-model',effort:'none'});
  assert.deepEqual(h.view.settings.modules.generalEditing,{model:'default',effort:'medium'});
  const codex=h.connections.find(c=>c.id==='codex')!;
  for(const [connection,expected]of [[{...codex,filmOutdated:true},'act'],[{...kimi,cliInstalled:true,heavySupported:true},'act'],[codex,'ok']] as const){
   await h.act(async()=>h.syncDeployConnections([connection]));assert.equal(document.querySelector('output')?.getAttribute('data-agent-state'),expected);
  }
 }finally{await h.close()}
});

test('Windows project picker keeps settings and retry reachable when connections cannot be loaded',async()=>{
 const h=await mount('project',true);
 try{
  await h.click('接入读取失败');assert.match(document.querySelector('.ge-model-pop [role="alert"]')?.textContent||'',/暂时离线/);
  await h.click('管理智能体接入 →',document.querySelector('.ge-model-pop')!);
  assert.equal(document.querySelector('.ge-model-pop'),null);assert.ok(document.querySelector('.unified-connections'));
  await h.click('关闭系统设置');await h.click('接入读取失败');h.offline(false);await h.click('重新读取',document.querySelector('.ge-model-pop')!);
  assert.match(document.querySelector('.ge-model-pop')?.textContent||'',/Codex/);assert.equal(document.querySelector('.ge-model-pop [role="alert"]'),null);
  assert.equal(window.location.pathname,'/general/projects/qa');assert.ok(h.requests.every(r=>r.method==='GET'));
 }finally{await h.close()}
});
