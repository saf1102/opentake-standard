import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import {JSDOM} from 'jsdom';
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {exportSettingsForPreset} from '../src/studio/export-settings.ts';
import type {ExportSettings} from '../src/types/editor.ts';

const require=createRequire(import.meta.url);

test('真实共享弹窗：口播、通用剪辑与录屏的剪映提交隔离成片选择，切回和重开仍保留',async()=>{
 const output=await build({entryPoints:['src/studio/components/ExportDialog.tsx'],bundle:true,write:false,
  platform:'node',format:'cjs',packages:'external',jsx:'automatic',loader:{'.css':'empty'}});
 const mod={exports:{} as typeof import('../src/studio/components/ExportDialog.tsx')};
 new Function('require','module','exports',output.outputFiles[0].text)(require,mod,mod.exports);
 for(const mode of ['koubo','general','screen'] as const)for(const selected of [false,true]) {
  const dom=new JSDOM('<nav class="workspace-nav" style="position:sticky;z-index:40"><button id="trigger">打开导出</button></nav><main class="workspace-content" style="position:relative;z-index:1"><div class="studio-editor" id="root"></div></main>',{url:'http://localhost'});
  const savedGlobals=new Map<string,PropertyDescriptor|undefined>();
  const submissions:ExportSettings[]=[],writes:ExportSettings[]=[];
  let preference:ExportSettings|null=null;
  const values={window:dom.window,document:dom.window.document,HTMLElement:dom.window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true,
   fetch:async(_url:unknown,init?:RequestInit)=>{
    if(init?.method==='PUT'){preference=JSON.parse(String(init.body));writes.push(preference!);}
    return {ok:true,json:async()=>({ok:true,result:preference})};
   }};
  for(const [key,value]of Object.entries(values)){savedGlobals.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});}
  const root=createRoot(dom.window.document.getElementById('root')!);
  const props={mode,projectId:'fixture',projectName:'隔离测试',starting:false,history:React.createElement('div'),notice:mode==='screen'?'另一个窗口正在编辑，导出的是上次保存的版本':undefined,
   capabilities:{defaultDestination:'/tmp/task13-exports',jianying:{available:false,warning:'测试'}},
   onClose:()=>{},onChooseDestination:async()=>'/tmp/task13-exports',onStart:async(s:ExportSettings)=>{submissions.push(s);},
   onRetry:async()=>{},onStop:async()=>{},onRestart:async()=>{},onReveal:()=>{}};
  const render=async(key:string)=>{await act(async()=>{root.render(React.createElement(mod.exports.ExportDialog,{...props,key}));});};
  const click=async(selector:string,starts:string)=>{
   const button=[...dom.window.document.querySelectorAll<HTMLButtonElement>(selector)].find(b=>b.textContent?.trim().startsWith(starts));
   assert.ok(button,`${mode}: ${starts}`);assert.equal(button.disabled,false);
   await act(async()=>{button.click();});
  };
  const chosen=(group:string,label:string)=>{
   const button=[...dom.window.document.querySelectorAll(`[aria-label="${group}"][role="group"] button`)].find(b=>b.textContent?.trim().startsWith(label));
   assert.equal(button?.getAttribute('aria-pressed'),'true',`${mode}: ${label}`);
  };
  try {
   const trigger=dom.window.document.getElementById('trigger')!;trigger.focus();
   await render('first');
   const backdrop=dom.window.document.querySelector('.export-backdrop');assert.ok(backdrop);
   assert.equal(backdrop.parentElement,dom.window.document.body,'遮罩和弹窗必须脱离编辑器层叠上下文');
   assert.equal(dom.window.document.querySelector('#root .export-backdrop'),null);
   if(mode==='screen')assert.equal(dom.window.document.querySelector('.export-notice[role="status"]')?.textContent,props.notice);
   const initial={...exportSettingsForPreset('quick'),destinationDir:props.capabilities.defaultDestination};
   const film=selected?{...initial,resolution:'720p' as const,fps:60 as const,video:{...initial.video,codec:'prores422' as const,container:'mov' as const}}:initial;
   if(selected){await click('[aria-label="导出画质"] button','流畅');await click('[aria-label="编码"] button','ProRes 422');await click('[aria-label="帧率"] button','60');}
   await click('.export-presets button',mode==='koubo'?'剪映工程':'剪映草稿');
   for(const button of dom.window.document.querySelectorAll<HTMLButtonElement>('.export-resolution button'))assert.equal(button.disabled,true);
   await click('.export-footer button.export-primary','导出');
   assert.deepEqual(submissions[0],exportSettingsForPreset('jianying',film));
   assert.equal(Object.hasOwn(submissions[0],'fps'),false);
   assert.deepEqual(writes.at(-1),film,'保存的只有成片偏好');
   await click('.export-presets button',mode==='koubo'?'快速成片':'成片');
   chosen('编码',selected?'ProRes 422':'H.264');chosen('帧率',selected?'60':'跟工程');chosen('导出画质',selected?'流畅':'原片');
   await click('.export-footer button.export-primary','导出成片');assert.deepEqual(submissions[1],film);
   await render('reopened');
   chosen('编码',selected?'ProRes 422':'H.264');chosen('帧率',selected?'60':'跟工程');
  }finally{
   await act(async()=>root.unmount());
   assert.equal(dom.window.document.querySelector('.export-backdrop'),null,'卸载必须清除 portal');
   dom.window.close();
   for(const [key,descriptor]of savedGlobals){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else Reflect.deleteProperty(globalThis,key);}
  }
 }
});
