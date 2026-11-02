import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {setTimeout as delay} from 'node:timers/promises';
import {NativeRecordingController,type NativeRecordingState} from './editor/native-recording.ts';

const script = `const fs=require('node:fs'),readline=require('node:readline');
const [output,mode]=process.argv.slice(2);
fs.writeFileSync(output+'.env.json',JSON.stringify({runAsNode:process.env.ELECTRON_RUN_AS_NODE,compositor:process.env.OPENSCREEN_COMPOSITOR_VIEW_NODE,pid:process.pid}));
const emit=value=>process.stdout.write(JSON.stringify(value)+'\\n');
if(mode==='early-error'){emit({event:'done',success:false,error:'fixture capture failed'});process.exit(2)}
if(mode==='native-init-failure')process.stderr.write('ERROR: SetInputMediaType failed (hr=0xc00d36b4)\\nERROR: Failed to initialize Media Foundation encoder\\n');
if(mode==='native-init-retry')process.stderr.write('ERROR: SetInputMediaType failed (hr=0xc00d36b4)\\nWARNING: Default Media Foundation H.264 encoder setup failed; retrying\\n');
if(mode==='invalid-events')process.stdout.write('null\\n[]\\n42\\n"ignored"\\n');
if(mode==='split-error'){const b=Buffer.from(JSON.stringify({event:'done',success:false,error:'中文录制错误'}));const cut=b.indexOf(Buffer.from('中文'))+1;process.stdout.write(b.subarray(0,cut));setTimeout(()=>{process.stdout.write(b.subarray(cut));setTimeout(()=>process.exit(2),30)},30);}
if(!['never-start','split-error','native-init-failure'].includes(mode))setTimeout(()=>emit({event:'log',message:'Recording started'}),mode==='slow-start'?150:10);
let stops=0;
readline.createInterface({input:process.stdin}).on('line',line=>{
 if(line!=='stop')return;stops++;
 if(mode==='ignore-stop')return;
 if(mode==='stderr-before-finalize')process.stderr.write('fixture native clock validation failed\\n');
 if(mode!=='no-project')fs.writeFileSync(output,JSON.stringify({stops,fixture:true}));
 emit({event:'done',success:true});setTimeout(()=>process.exit(0),30);
});setInterval(()=>{},1000);`;

function fixture(mode='normal',options: {startTimeoutMs?:number;stopTimeoutMs?:number;finalize?:(input:any)=>Promise<void>;terminate?:(pid:number)=>void;onState?:(state:NativeRecordingState)=>void;onStateError?:(state:NativeRecordingState)=>void}={}){
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'standard-recording-'));
 const worker=path.join(folder,'recorder.cjs'),projectFile=path.join(folder,'中文 工程.openscreen');
 fs.writeFileSync(worker,script);
 const states:NativeRecordingState[]=[];
 const recorder=new NativeRecordingController({...options,onState:state=>{states.push(state);options.onState?.(state)}});
 const start=()=>recorder.start({id:'take-1',projectId:'project-1',sourceName:'合成测试窗口',executable:process.execPath,
  args:[worker,projectFile,mode],projectFile,diagnosticFile:projectFile+'.diagnostic.json',env:{...process.env,ELECTRON_RUN_AS_NODE:'1',OPENSCREEN_COMPOSITOR_VIEW_NODE:'1'}});
 return {folder,projectFile,states,recorder,start};
}
async function until(condition:()=>boolean){
 const end=Date.now()+12_000;
 while(!condition()){if(Date.now()>end)throw Error('fixture state timeout');await delay(20)}
}
async function cleanup(f:ReturnType<typeof fixture>){
 if(f.recorder.busy){try{f.recorder.stop('project-1','take-1')}catch{}await until(()=>!f.recorder.busy)}
 fs.rmSync(f.folder,{recursive:true,force:true});
}

test('real child obeys stdin stop once and has no inherited Electron Node/native-view mode',async()=>{
 const f=fixture();try{
  f.start();await until(()=>f.recorder.state?.phase==='recording');
  assert.equal(f.recorder.busy,true);
  assert.throws(()=>f.start(),/已有录制/);
  assert.throws(()=>f.recorder.stop('another-project','take-1'),/未停止其他/);
  f.recorder.stop('project-1','take-1');f.recorder.stop('project-1','take-1');
  await until(()=>!f.recorder.busy);assert.equal(f.recorder.state?.phase,'saved');
  assert.equal(JSON.parse(fs.readFileSync(f.projectFile,'utf8')).stops,1);
  const env=JSON.parse(fs.readFileSync(f.projectFile+'.env.json','utf8'));
  assert.equal(env.runAsNode,undefined);assert.equal(env.compositor,undefined);
  assert.ok(f.states.some(s=>s.phase==='stopping'));
 }finally{await cleanup(f)}
});

test('stop requested during startup waits for actual recording readiness then saves',async()=>{
 const f=fixture('slow-start');try{
  f.start();f.recorder.stop('project-1','take-1');
  await until(()=>!f.recorder.busy);assert.equal(f.recorder.state?.phase,'saved');
  assert.ok(f.recorder.state?.startedAt);assert.equal(JSON.parse(fs.readFileSync(f.projectFile,'utf8')).stops,1);
 }finally{await cleanup(f)}
});

test('early recorder failure is reported without a successful saved take',async()=>{
 const f=fixture('early-error');try{
  f.start();await until(()=>!f.recorder.busy);
  assert.equal(f.recorder.state?.phase,'failed');assert.match(f.recorder.state?.error||'',/fixture capture failed/);
  assert.equal(fs.existsSync(f.projectFile),false);
 }finally{await cleanup(f)}
});

test('terminal native encoder failure reports the HRESULT immediately instead of waiting for wrapper startup timeout',async()=>{
 const f=fixture('native-init-failure',{startTimeoutMs:30_000});try{
  const start=Date.now();f.start();await until(()=>!f.recorder.busy);
  assert.ok(Date.now()-start<10_000);assert.equal(f.recorder.state?.phase,'failed');
  assert.match(f.recorder.state?.error||'',/SetInputMediaType.*0xc00d36b4/);
  assert.equal(fs.existsSync(f.projectFile),false);
  assert.match(JSON.parse(fs.readFileSync(f.projectFile+'.diagnostic.json','utf8')).stderr,/Failed to initialize Media Foundation encoder/);
 }finally{await cleanup(f)}
});

test('recoverable native encoder warning allows fallback to finish recording',async()=>{
 const f=fixture('native-init-retry');try{
  f.start();await until(()=>f.recorder.state?.phase==='recording');
  f.recorder.stop('project-1','take-1');await until(()=>!f.recorder.busy);
  assert.equal(f.recorder.state?.phase,'saved');
 }finally{await cleanup(f)}
});

test('success event without the promised project file remains a failure',async()=>{
 const f=fixture('no-project');try{
  f.start();await until(()=>f.recorder.state?.phase==='recording');f.recorder.stop('project-1','take-1');
  await until(()=>!f.recorder.busy);assert.equal(f.recorder.state?.phase,'failed');
 }finally{await cleanup(f)}
});

test('startup watchdog ends only its owned hung recorder and retains artifacts',async()=>{
 const f=fixture('never-start',{startTimeoutMs:1500});try{
  f.start();await until(()=>!f.recorder.busy);
  assert.equal(f.recorder.state?.phase,'failed');assert.match(f.recorder.state?.error||'',/时限内开始/);
  assert.equal(fs.existsSync(f.projectFile+'.env.json'),true);
 }finally{await cleanup(f)}
});

test('stop watchdog bounds a child that ignores stop and keeps the raw artifact',async()=>{
 const f=fixture('ignore-stop',{stopTimeoutMs:200});try{
  f.start();await until(()=>f.recorder.state?.phase==='recording');
  fs.writeFileSync(f.projectFile+'.raw.mp4','salvageable fixture');
  f.recorder.stop('project-1','take-1');await until(()=>!f.recorder.busy);
  assert.equal(f.recorder.state?.phase,'failed');assert.match(f.recorder.state?.error||'',/保存超时/);
  assert.equal(fs.readFileSync(f.projectFile+'.raw.mp4','utf8'),'salvageable fixture');
 }finally{await cleanup(f)}
});

test('save finalization stays busy and rejects another take until its document is ready',async()=>{
 let finish!:()=>void;let finalizing=false;const terminations:number[]=[];
 const f=fixture('normal',{terminate:pid=>terminations.push(pid),finalize:async()=>{finalizing=true;await new Promise<void>(resolve=>{finish=resolve})}});
 try{
  f.start();await until(()=>f.recorder.state?.phase==='recording');f.recorder.stop('project-1','take-1');
  await until(()=>finalizing);assert.equal(f.recorder.busy,true);assert.throws(()=>f.start(),/已有录制/);
  f.recorder.stop('project-1','take-1');await delay(50);assert.deepEqual(terminations,[]);
  finish();await until(()=>!f.recorder.busy);assert.equal(f.recorder.state?.phase,'saved');
 }finally{finish?.();await cleanup(f)}
});

test('failed clock/document finalization preserves raw output and never publishes saved',async()=>{
 const f=fixture('normal',{finalize:async()=>{throw Error('录制时间校验失败：帧数不匹配；原始文件已保留')}});
 try{
  f.start();await until(()=>f.recorder.state?.phase==='recording');f.recorder.stop('project-1','take-1');
  await until(()=>!f.recorder.busy);
  assert.equal(f.recorder.state?.phase,'failed');assert.match(f.recorder.state?.error||'',/时间校验失败/);
  assert.equal(fs.existsSync(f.projectFile),true);assert.equal(f.states.some(s=>s.phase==='saved'),false);
 }finally{await cleanup(f)}
});
test('clock import failure retains recorder diagnostics without recording arguments or environment',async()=>{
 const f=fixture('stderr-before-finalize',{finalize:async()=>{throw Error('本次采集器未保存逐帧时钟')}});
 try{
  f.start();await until(()=>f.recorder.state?.phase==='recording');f.recorder.stop('project-1','take-1');
  await until(()=>!f.recorder.busy);
  const diagnostics=JSON.parse(fs.readFileSync(f.projectFile+'.diagnostic.json','utf8'));
  assert.equal(diagnostics.state.phase,'failed');assert.equal(diagnostics.exit.code,0);
  assert.match(diagnostics.stderr,/native clock validation failed/);
  assert.ok(diagnostics.events.some((e:any)=>e.event==='done'&&e.success===true));
  assert.equal(diagnostics.env,undefined);assert.equal(diagnostics.args,undefined);
 }finally{await cleanup(f)}
});

test('initial persistence failure starts no recorder process',async()=>{
 const f=fixture('normal',{onState:()=>{throw Error('initial state EPERM')}});
 try{assert.throws(f.start,/initial state EPERM/);assert.equal(f.recorder.busy,false);await delay(150);assert.equal(fs.existsSync(f.projectFile+'.env.json'),false);assert.equal(f.recorder.state?.phase,'failed')}finally{await cleanup(f)}
});
test('persistence failure after recording starts uses normal save protocol and leaves the service alive',async()=>{
 const notifications:NativeRecordingState[]=[];
 const f=fixture('normal',{onState:state=>{if(state.phase==='recording')throw Error('state EBUSY')},onStateError:state=>notifications.push(state)});
 try{f.start();await until(()=>!f.recorder.busy);assert.equal(f.recorder.state?.phase,'failed');assert.match(f.recorder.state?.error||'',/state EBUSY/);assert.equal(JSON.parse(fs.readFileSync(f.projectFile,'utf8')).stops,1);assert.ok(notifications.length);assert.equal(f.states.some(s=>s.phase==='saved'),false)}finally{await cleanup(f)}
});
test('a final saved-state observer failure retains the file and reports failure without an unhandled rejection',async()=>{
 const f=fixture('normal',{onState:state=>{if(state.phase==='saved')throw Error('final state EPERM')}});
 try{f.start();await until(()=>f.recorder.state?.phase==='recording');f.recorder.stop('project-1','take-1');await until(()=>!f.recorder.busy);assert.equal(f.recorder.state?.phase,'failed');assert.equal(fs.existsSync(f.projectFile),true);assert.match(f.recorder.state?.error||'',/final state EPERM/)}finally{await cleanup(f)}
});
test('invalid primitive protocol events do not crash the recorder controller',async()=>{
 const f=fixture('invalid-events');try{f.start();await until(()=>f.recorder.state?.phase==='recording');f.recorder.stop('project-1','take-1');await until(()=>!f.recorder.busy);assert.equal(f.recorder.state?.phase,'saved')}finally{await cleanup(f)}
});
test('split UTF-8 and a final event without newline preserve the original recorder error',async()=>{
 const f=fixture('split-error');try{f.start();await until(()=>!f.recorder.busy);assert.equal(f.recorder.state?.phase,'failed');assert.equal(f.recorder.state?.error,'中文录制错误')}finally{await cleanup(f)}
});
