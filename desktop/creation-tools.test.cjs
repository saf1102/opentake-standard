const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {doctor,probeBrowser,PYTHON_ENV}=require('./creation-tools.cjs');
const {SAMPLE_ARGS,RENDER_ARGS}=require('../shared/browser-launch.cjs');

function fixture() {
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"creation tools ' 中文-"));
 const file=name=>{const p=path.join(root,name);fs.writeFileSync(p,'#!/bin/sh\nexit 0\n',{mode:0o755});return p};
 const python=file('python3'),chrome=file('chromium'),ffmpeg=file('ffmpeg'),ffprobe=file('ffprobe'),codex=file('codex');
 const calls=[],browsers=[];
 const chromium={launch:async options=>{calls.push({browser:options});const b={closed:false,newPage:async()=>({setDefaultTimeout(){},setContent:async()=>{},screenshot:async()=>Buffer.from('png')}),close:async()=>{b.closed=true}};browsers.push(b);return b}};
 const options={probeSandbox:async()=>{},env:{PATH:'/usr/bin:/bin',LINKREADER_PYTHON:python,CW_HFX_CHROME:chrome},chromium,codexPath:()=>codex,findMedia:()=>({ffmpeg,ffprobe}),run:async(file,args,extra)=>{calls.push({file,args,extra});return {stdout:file===python?'3.14 / numpy 2.4':'工具版本'}}};
 return {root,python,chrome,ffmpeg,ffprobe,codex,options,calls,browsers,close:()=>fs.rmSync(root,{recursive:true,force:true})};
}
test('all tools are executed; Python uses agent isolation; host render mode closes; paths stay exact',async()=>{
 const f=fixture();try{
  const result=await doctor(f.options);assert.equal(result.ok,true);assert.deepEqual(result.tools,{python:f.python,chromium:f.chrome,ffmpeg:f.ffmpeg,ffprobe:f.ffprobe,codex:f.codex});
  assert.deepEqual(f.calls.find(c=>c.file===f.python).extra.env,{...f.options.env,...PYTHON_ENV});
  assert.ok(f.calls.some(c=>c.file===f.codex&&c.args.join(' ')==='login status'));
  assert.equal(f.browsers.length,1);assert.ok(f.browsers.every(b=>b.closed));
 }finally{f.close()}
});
for(const missing of ['numpy','chromium','ffmpeg','ffprobe','codex'])test(`missing ${missing} blocks; repair and retry returns verified paths`,async()=>{
 const f=fixture();try{
  const bad={...f.options};
  if(missing==='chromium')bad.env={...f.options.env,CW_HFX_CHROME:path.join(f.root,'absent')};
  else bad.run=async(file,args,extra)=>{
   if(file===f[missing==='numpy'?'python':missing])throw Object.assign(Error('not ready'),{stderr:missing==='numpy'?"ModuleNotFoundError: No module named 'numpy'":'private login detail'});
   return f.options.run(file,args,extra);
  };
  const result=await doctor(bad);assert.equal(result.ok,false);assert.equal(result.tools,undefined);
  const item=result.items.find(i=>i.id===(missing==='numpy'?'python':missing==='ffprobe'?'ffmpeg':missing));assert.equal(item.color,'#9869dc');assert.ok(item.install);assert.ok(!JSON.stringify(result).includes('private login detail'));
  assert.equal((await doctor(f.options)).ok,true);
 }finally{f.close()}
});
test('browser file present but launch or screenshot fails: blocks and closes owned browser',async()=>{
 const f=fixture();try{
  let closed=false;
  f.options.chromium={launch:async()=>({close:async()=>{closed=true},newPage:async()=>({setDefaultTimeout(){},setContent:async()=>{},screenshot:async()=>{throw Error('failed')}})})};
  const result=await doctor(f.options);assert.equal(result.ok,false);assert.equal(closed,true);assert.match(result.items.find(i=>i.id==='chromium').message,/启动或页面截图失败/);
 }finally{f.close()}
});
test('pinned Playwright exposes matching headless shell registry without cache scans',()=>{
 const {registry}=require('playwright-core/lib/coreBundle').registry;
 const file=registry.findExecutable('chromium-headless-shell').executablePath();
 assert.ok(path.isAbsolute(file));assert.match(file,/headless[-_]shell/);
});

test('host browser success cannot conceal failure inside the agent sandbox',async()=>{
 const f=fixture();try{f.options.probeSandbox=async()=>{throw Error('sandbox denied')};const result=await doctor(f.options);assert.equal(result.ok,false);assert.match(result.items.find(i=>i.id==='chromium').message,/出片沙盒/);assert.equal(result.tools,undefined);}finally{f.close()}
});

test('沙盒仅允许单进程样张，服务端多进程渲染在沙盒外检查，整体通过',async()=>{
 const f=fixture();try{
  const hostLaunch=f.options.chromium.launch;
  const hostArgs=[];
  f.options.chromium={launch:async options=>{hostArgs.push(options.args);return hostLaunch(options)}};
  let sandboxLaunches=0;
  const sandboxChromium={launch:async options=>{
   sandboxLaunches++;
   if(!options.args.includes('--single-process')||!options.args.includes('--no-zygote'))throw Error('MachPortRendezvousServer Permission denied');
   assert.deepEqual(options.args,SAMPLE_ARGS);
   assert.ok(options.args.includes('--no-sandbox'));
   return hostLaunch(options);
  }};
  f.options.probeSandbox=async(_codex,file,env)=>probeBrowser(sandboxChromium,file,env);
  const result=await doctor(f.options);
  assert.equal(result.ok,true,JSON.stringify(result.items));
  assert.equal(sandboxLaunches,1);
  assert.deepEqual(hostArgs,[RENDER_ARGS]);
  assert.equal(hostArgs[0].includes('--single-process'),false);
  assert.ok(f.browsers.every(browser=>browser.closed));
 }finally{f.close()}
});

test('服务端渲染失败仍阻断，不用样张成功掩盖，并提示清理旧路径而非放宽权限',async()=>{
 const f=fixture();try{
  let sandboxCalls=0;f.options.probeSandbox=async()=>{sandboxCalls++};
  f.options.chromium={launch:async options=>{assert.deepEqual(options.args,RENDER_ARGS);throw Error('render failed')}};
  const result=await doctor(f.options),item=result.items.find(i=>i.id==='chromium');
  assert.equal(result.ok,false);assert.equal(result.tools,undefined);assert.equal(sandboxCalls,0);
  assert.match(item.message,/服务端渲染模式/);
  for(const name of ['CW_HFX_CHROME','CW_CHROME','PLAYWRIGHT_CHROMIUM_EXECUTABLE'])assert.ok(item.install.includes(name));
  assert.match(item.install,/不要关闭 Codex 沙盒/);
 }finally{f.close()}
});
