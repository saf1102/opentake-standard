import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {fileURLToPath,pathToFileURL} from 'node:url';
import {build} from 'esbuild';import {JSDOM} from 'jsdom';
const root=fileURLToPath(new URL('../',import.meta.url));

test('S05：共享目录设置保存导出默认值、保留旧库并登记已有工程库，拒绝过期保存和离线外置盘',async()=>{
 const dir=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'task21-settings-'))),oldSettings=process.env.LINKREADER_SYSTEM_SETTINGS_FILE,oldRoot=process.env.LINK_READER_PROJECTS_DIR;
 process.env.LINKREADER_SYSTEM_SETTINGS_FILE=path.join(dir,'settings.json');process.env.LINK_READER_PROJECTS_DIR=path.join(dir,'first');
 for(const name of ['first','second','library','cache','exports','backups'])fs.mkdirSync(path.join(dir,name));
 try{
  const s=await import('./system-settings.ts');const initial=s.settingsView();
  const saved=s.writeSystemSettings({...initial.preferences,paths:{projects:path.join(dir,'second'),cache:path.join(dir,'cache'),exports:path.join(dir,'exports'),backups:path.join(dir,'backups')},export:{...initial.preferences.export,quality:'high',resolution:'1080p'}},initial.revision);
  assert.equal(saved.preferences.export.quality,'high');assert.equal(saved.preferences.export.resolution,'1080p');
  assert.deepEqual(s.projectRoots(),[path.join(dir,'second'),path.join(dir,'first')]);
  s.registerProjectLibrary(path.join(dir,'library'));assert.ok(s.projectRoots().includes(path.join(dir,'library')));
  assert.equal(s.readSystemSettings().preferences.paths.cache,path.join(dir,'cache'));
  assert.throws(()=>s.writeSystemSettings(saved.preferences,initial.revision),/其他窗口/);
  if(process.platform==='darwin')assert.throws(()=>s.validateDirectory(path.join(path.sep,'Volumes','task21-not-mounted','projects')),/未连接/);
 }finally{if(oldSettings===undefined)delete process.env.LINKREADER_SYSTEM_SETTINGS_FILE;else process.env.LINKREADER_SYSTEM_SETTINGS_FILE=oldSettings;if(oldRoot===undefined)delete process.env.LINK_READER_PROJECTS_DIR;else process.env.LINK_READER_PROJECTS_DIR=oldRoot;fs.rmSync(dir,{recursive:true,force:true})}
});

test('S12：共享设置有未保存目录时，分组切换、外部入口、关闭均确认；取消保留草稿，放弃恢复原值',async()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'task21-settings-ui-'));fs.symlinkSync(path.join(root,'node_modules'),path.join(temp,'node_modules'),'dir');
 const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost'}),saved=new Map<string,PropertyDescriptor|undefined>();
 for(const [key,value] of Object.entries({window:dom.window,document:dom.window.document,navigator:dom.window.navigator,IS_REACT_ACT_ENVIRONMENT:true,requestAnimationFrame:(fn:()=>void)=>setTimeout(fn,0)})){saved.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{value,configurable:true,writable:true})}
 const oldFetch=globalThis.fetch;const preferences={paths:{projects:'/fixture',cache:'',exports:'',backups:'/backups'},export:{preset:'quick',container:'mp4',quality:'fast',resolution:'original',revealWhenDone:false},backup:{automatic:true,intervalMinutes:15,keep:20},reserveGB:5};
 globalThis.fetch=(async()=>Response.json({ok:true,result:{revision:0,preferences,libraries:[],paths:{},cacheRoots:[],backupRoots:[],projectPathOverridden:false}})) as typeof fetch;
 let app:any;
 try{
  const outfile=path.join(temp,'harness.mjs');
  await build({stdin:{contents:`import React,{act} from 'react';import {createRoot} from 'react-dom/client';import {SystemSettings} from './src/settings/SystemSettings';export {act,createRoot};export const element=<SystemSettings/>;`,resolveDir:root,loader:'tsx'},outfile,jsx:'automatic',bundle:true,platform:'node',format:'esm',packages:'external',logLevel:'silent',plugins:[{name:'settings-isolation',setup(b){
   b.onResolve({filter:/\.css$/},a=>({path:a.path,namespace:'empty'}));b.onLoad({filter:/.*/,namespace:'empty'},()=>({contents:'',loader:'js'}));
   b.onResolve({filter:/components\/ui\/dialog$/},()=>({path:'dialog',namespace:'fixture'}));
   b.onResolve({filter:/^\.\/edition$/},a=>a.importer.endsWith('SystemSettings.tsx')?{path:'edition',namespace:'fixture'}:undefined);
   b.onResolve({filter:/CreationEnvironment|AgentSettingsDialog|ProjectStorage|ThemeSwitcher/},a=>({path:a.path.split('/').pop()!,namespace:'fixture'}));
   b.onLoad({filter:/.*/,namespace:'fixture'},a=>({resolveDir:root,loader:'tsx',contents:a.path==='dialog'?`import React,{createContext,useContext} from 'react';const C=createContext({});export function Dialog({open,onOpenChange,children}){return <C.Provider value={{open,onOpenChange}}>{children}</C.Provider>}export function DialogTrigger({children}){const c=useContext(C);return React.cloneElement(children,{onClick:()=>c.onOpenChange(true)})}export function DialogContent({children}){return useContext(C).open?<div role="dialog">{children}</div>:null}export const DialogTitle=({children})=><h2>{children}</h2>;export const DialogDescription=({children})=><p>{children}</p>;`:a.path==='edition'?`export const settingsGroups=['general','agents','models','storage','export','backup','about'];export const AgentRoster=()=>null,EnhancedAgentSettings=()=>null,IntegrationSettings=()=>null,DesktopSettings=()=>null,PublishDirSetting=()=>null,ProjectMigration=()=>null;`:`export const ${a.path}=()=>null;`}));
  }}]});
  const h=await import(pathToFileURL(outfile).href);app=h.createRoot(document.getElementById('root'));const click=async(text:string)=>{const button=[...document.querySelectorAll('button')].find(el=>el.textContent===text);assert.ok(button,text);await h.act(async()=>button.click())};
  await h.act(async()=>app.render(h.element));await click('系统设置');await click('文件与存储');
  const edit=async(value:string)=>{const input=document.querySelector('input[aria-label="缓存与临时文件目录"]') as HTMLInputElement;assert.ok(input);await h.act(async()=>{Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype,'value')!.set!.call(input,value);input.dispatchEvent(new dom.window.Event('input',{bubbles:true}))})};
  await edit('/draft-cache');await click('导出默认值');assert.match(document.body.textContent||'',/未保存的修改/);await click('继续编辑');assert.equal((document.querySelector('input[aria-label="缓存与临时文件目录"]') as HTMLInputElement).value,'/draft-cache');
  await h.act(async()=>window.dispatchEvent(new dom.window.CustomEvent('opentake:open-settings',{detail:{group:'export'}})));assert.match(document.body.textContent||'',/未保存的修改/);await click('放弃修改');
  await click('文件与存储');assert.equal((document.querySelector('input[aria-label="缓存与临时文件目录"]') as HTMLInputElement).value,'');
  await edit('/close-draft');await click('关闭');assert.match(document.body.textContent||'',/未保存的修改/);await click('放弃修改');assert.equal(document.querySelector('[role="dialog"]'),null);
  await h.act(async()=>app.unmount());app=null;
 }finally{if(app)app.unmount();globalThis.fetch=oldFetch;dom.window.close();for(const [key,value] of saved){if(value)Object.defineProperty(globalThis,key,value);else delete (globalThis as any)[key]}fs.rmSync(temp,{recursive:true,force:true})}
});
