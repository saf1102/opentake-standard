import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {renderFrames} from './frame-render/index.ts';
import {prepareWork} from './general/kit-env.ts';
import {quarantineSoftware} from './general/net-guard.ts';
import {createGeneral,findGeneral,updateGeneral} from './general/store.ts';
import {readSession,writeSession,setGeneralRuntime,resumeRun,isLive,missingCodexRollout} from './general/runner.ts';
import {initialSteps,verifySelfCheck} from './general/events.ts';
const checker=createRequire(import.meta.url)('../desktop/creation-tools.cjs');

test('第14行：Pro 仅检查登录，不探测其他三项；失败不泄漏登录输出',async()=>{
 const calls:string[][]=[];
 const options={onlyCodex:true,env:{},codexPath:()=>'/fixture/codex',run:async(_file:string,args:string[])=>{calls.push(args);return {stdout:'private account fixture'};},chromium:{launch(){throw Error('不应启动')}}};
 const ok=await checker.doctor(options);assert.deepEqual(ok.items.map((i:any)=>i.id),['codex']);assert.equal(ok.ok,true);assert.deepEqual(calls,[['login','status']]);assert.doesNotMatch(JSON.stringify(ok),/private account/);
 const bad=await checker.doctor({...options,run:async()=>{throw Error('private account fixture')}});assert.equal(bad.ok,false);assert.equal(bad.tools,undefined);assert.doesNotMatch(JSON.stringify(bad),/private account/);
});

test('P01：每个输出帧等待所有子 frame 的字体；失败拒绝交付',async()=>{
 for(const fail of [false,true]){
  let seek=-1,closed=false;const waits:string[]=[],captures:number[]=[];
  const frames=[0,1].map(n=>({evaluate:async()=>{await new Promise(r=>setTimeout(r,2));waits.push(`${seek}:${n}`);if(fail&&n===1)throw Error('导出字体加载失败：测试字体');}}));
  const page={on(){},route:async()=>{},goto:async()=>{},waitForFunction:async()=>{},context:()=>({newCDPSession:async()=>({send:async(method:string)=>{if(method==='Page.captureScreenshot'){assert.ok(waits.includes(`${seek}:0`)&&waits.includes(`${seek}:1`));captures.push(seek);return {data:Buffer.from('frame').toString('base64')}}return {};}})}),evaluate:async(_fn:unknown,arg:any)=>{if(typeof arg==='number')seek=arg;return {};},frames:()=>frames,close:async()=>{closed=true}};
  const browser:any={browser:{newPage:async()=>page},decoder:{close(){}},capture:(capture:()=>any)=>capture()};
  const run=renderFrames({serveUrl:'unused',puppeteerInstance:browser,composition:{id:'test',width:16,height:16,fps:30,durationInFrames:3},concurrency:1});
  if(fail){await assert.rejects(run,/导出字体加载失败/);assert.deepEqual(captures,[]);}else{await run;assert.deepEqual(captures,[0,1,2]);assert.equal(waits.length,6);}assert.equal(closed,true);
 }
});

test('P03：自己的逐字节匹配 ZIP 保留，伪装、篡改、穿越 ZIP 隔离',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'task19-archive-'));const old=process.env.LINKREADER_PYTHON;process.env.LINKREADER_PYTHON='/usr/bin/python3';
 try{
  const work=path.join(root,'work'),snapshot=path.join(root,'versions/v1/work');fs.mkdirSync(path.join(work,'versions'),{recursive:true});fs.mkdirSync(snapshot,{recursive:true});fs.writeFileSync(path.join(snapshot,'index.html'),'saved');
  const zip=(name:string,body:string,entry='index.html')=>execFileSync('/usr/bin/python3',['-c','import zipfile,sys\nwith zipfile.ZipFile(sys.argv[1],"w") as z:z.writestr(sys.argv[3],sys.argv[2])',path.join(work,name),body,entry]);
  zip('versions/v1.zip','saved');zip('versions/v2.zip','saved');zip('download.zip','saved');assert.deepEqual(quarantineSoftware(work,path.join(root,'blocked')).sort(),['download.zip','versions/v2.zip']);
  zip('versions/v1.zip','wrong');assert.deepEqual(quarantineSoftware(work,path.join(root,'tampered')),['versions/v1.zip']);
  zip('versions/v1.zip','saved','../index.html');assert.deepEqual(quarantineSoftware(work,path.join(root,'traversal')),['versions/v1.zip']);
 }finally{if(old===undefined)delete process.env.LINKREADER_PYTHON;else process.env.LINKREADER_PYTHON=old;fs.rmSync(root,{recursive:true,force:true});}
});

test('P15：内容不变的每个包装脚本仍恢复 0755',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'task19-permissions-'));
 const tools={codex:process.execPath,python:process.execPath,ffmpeg:process.execPath,ffprobe:process.execPath,chromium:process.execPath};
 try{prepareWork(root,{},false,tools);const bin=path.join(root,'work/.opentake/bin');const before=new Map(fs.readdirSync(bin).map(name=>[name,fs.readFileSync(path.join(bin,name))]));for(const name of before.keys())fs.chmodSync(path.join(bin,name),0o644);prepareWork(root,{},false,tools);for(const [name,bytes]of before){assert.deepEqual(fs.readFileSync(path.join(bin,name)),bytes);assert.equal(fs.statSync(path.join(bin,name)).mode&0o777,0o755);}}finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('P04：阶段完成不代表自查完成，缺样张时跳过且清掉缩略图',()=>{
 const steps=initialSteps('topic','first').map(s=>({...s,state:'done' as const,thumbs:['unproven']}));
 assert.equal(verifySelfCheck(steps,true,'now'),steps);
 const check=verifySelfCheck(steps,false,'now').find(s=>s.id==='self-check')!;assert.equal(check.state,'skipped');assert.equal(check.thumbs,undefined);
});

for(const mode of ['recover','repeat','unrelated','empty-sheet','valid-sheet'] as const)test(`P02/P04/P05/S01 真实 runner + 假 CLI：${mode}`,async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'task19-runner-'));
 const keys=['LINK_READER_PROJECTS_DIR','LINKREADER_AGENT_SETTINGS_FILE'];const old=keys.map(k=>process.env[k]);
 process.env.LINK_READER_PROJECTS_DIR=path.join(root,'projects');process.env.LINKREADER_AGENT_SETTINGS_FILE=path.join(root,'settings/agent.json');fs.mkdirSync(process.env.LINK_READER_PROJECTS_DIR,{recursive:true});
 const fake=path.join(root,'codex');const calls=path.join(root,'calls.jsonl');let id='';let activity='';
 try{
  const script=path.join(root,'fake.mjs');
  fs.writeFileSync(script,`import fs from 'node:fs';const args=process.argv.slice(2);let prompt='';for await(const x of process.stdin)prompt+=x;fs.appendFileSync(${JSON.stringify(calls)},JSON.stringify({args,prompt})+'\\n');const resume=args.includes('resume');if(${JSON.stringify(mode)}==='unrelated'||resume||${JSON.stringify(mode)}==='repeat'){console.error(${JSON.stringify(mode)}==='unrelated'?'network unavailable':'thread/resume: no rollout found for thread id old');process.exit(1)}console.log(JSON.stringify({type:'thread.started',thread_id:'new-thread'}));console.log(JSON.stringify({type:'turn.completed',usage:{input_tokens:12,output_tokens:3}}));fs.writeFileSync(args[args.indexOf('-o')+1],'完成测试');`);
  fs.writeFileSync(fake,`#!/bin/sh\nexec '${process.execPath.replaceAll("'","'\\''")}' '${script.replaceAll("'","'\\''")}' "$@"\n`,{mode:0o755});
  const tools={codex:fake,python:process.execPath,ffmpeg:process.execPath,ffprobe:process.execPath,chromium:process.execPath};
  setGeneralRuntime({creationTools:async()=>tools,resolveCodex:async()=>({executable:fake,model:'actual',effort:'low',requested:{model:'old-model',effort:'low'}}),baseEnv:()=>({...process.env}),agentReview:false,render:async(_work,_video,options)=>{options?.onActivity?.('正在抽取并解码测试素材');activity=findGeneral(id).project.run!.steps.find(s=>s.id==='render')!.detail!;throw Error('TEST_RENDER_BOUNDARY');}});
  const made=createGeneral({styleId:'whiteboard',settings:{aspect:'16:9',length:15},inputs:{kind:'topic',text:'保留文案'}},'测试');id=made.project.id;const {dir}=made;
  fs.writeFileSync(path.join(dir,'work/index.html'),'<main data-composition-id="test">保留内容</main>');fs.writeFileSync(path.join(dir,'work/keep.txt'),'unchanged');
  if(mode.includes('sheet')){fs.mkdirSync(path.join(dir,'work/look'));fs.writeFileSync(path.join(dir,'work/look/sheet.jpg'),mode==='valid-sheet'?'fixture':'');}
  const s=readSession(dir);writeSession(dir,{...s,pending:'make',threadId:'old',resumed:true,queue:[{id:'note',text:'保留排队意见'}]});
  updateGeneral(id,p=>{p.run={id:'prior',state:'failed',agent:'codex',purpose:'first',startedAt:new Date().toISOString(),steps:initialSteps('topic','first').map(s=>({...s,state:'done'})),queued:1};});
  resumeRun(id);const deadline=Date.now()+15000;while(isLive(id)&&Date.now()<deadline)await new Promise(r=>setTimeout(r,20));assert.equal(isLive(id),false);
  const records=fs.readFileSync(calls,'utf8').trim().split('\n').map(s=>JSON.parse(s));assert.equal(records.length,mode==='unrelated'?1:2);assert.equal(records[0].args.includes('resume'),true);if(records[1]){assert.equal(records[1].args.includes('resume'),false);assert.match(records[1].prompt,/保留排队意见/);}
  assert.equal(fs.readFileSync(path.join(dir,'work/keep.txt'),'utf8'),'unchanged');assert.equal(findGeneral(id).project.inputs.text,'保留文案');
  const logs=fs.readdirSync(path.join(root,'settings/agent-runs')).filter(f=>f.endsWith('.json')).map(f=>JSON.parse(fs.readFileSync(path.join(root,'settings/agent-runs',f),'utf8')));assert.ok(logs.length);for(const r of logs)assert.deepEqual(r.requested,{model:'old-model',effort:'low'});
  if(mode==='repeat'||mode==='unrelated')assert.equal(activity,'');else{assert.match(activity,/抽取并解码/);assert.match(findGeneral(id).project.run!.error!,/TEST_RENDER_BOUNDARY/);assert.equal(findGeneral(id).project.run!.steps.find(s=>s.id==='self-check')!.state,mode==='valid-sheet'?'done':'skipped');assert.equal(readSession(dir).threadId,'new-thread');}
 }finally{keys.forEach((k,i)=>{if(old[i]===undefined)delete process.env[k];else process.env[k]=old[i]});fs.rmSync(root,{recursive:true,force:true});}
});

test('P02：只识别明确的恢复会话缺失，不将普通失败重试',()=>{
 assert.equal(missingCodexRollout('thread/resume: no rollout found for thread id old'),true);
 for(const s of ['no rollout found for thread id old','authentication failed','rate limit'])assert.equal(missingCodexRollout(s),false);
});
