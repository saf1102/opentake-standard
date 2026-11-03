import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import cp from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import {setTimeout as delay} from 'node:timers/promises';
import {recordingDocument} from '../shared/openscreen-recording.ts';
import {createScreenProject,projectFolder,save} from './editor/store.ts';
import {createOpenScreenDocument} from './editor/openscreen-documents.ts';
import {startOpenScreenExport,readOpenScreenExport,cancelOpenScreenExport,activeOpenScreenExports,revealOpenScreenExport} from './editor/openscreen-export.ts';
import {sourceListFromEvents} from './editor/openscreen.ts';

const worker=`const fs=require('fs');const [out,mode]=process.argv.slice(2);fs.writeFileSync(out,'partial');const emit=v=>process.stdout.write(JSON.stringify(v)+'\\n');emit({event:'progress',progress:0.1});if(mode==='wait'){setInterval(()=>emit({event:'progress',progress:0.3}),100)}else setTimeout(()=>{fs.writeFileSync(out,'complete-fixture-export');if(mode==='reported-error')emit({event:'done',success:false,error:'native fixture error'});else emit({event:'done',success:true});setTimeout(()=>process.exit(0),30)},80);`;
async function until(check:()=>boolean){const deadline=Date.now()+12_000;while(!check()){if(Date.now()>deadline)throw Error('export fixture timeout');await delay(20)}}
async function fixture(t:any){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'opentake-export-failure-'));
 const keys=['LINK_READER_PROJECTS_DIR','LINKREADER_SYSTEM_SETTINGS_FILE','OPENSCREEN_BIN','OPENSCREEN_USER_DATA_DIR'];
 const old=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
 Object.assign(process.env,{LINK_READER_PROJECTS_DIR:dir,LINKREADER_SYSTEM_SETTINGS_FILE:path.join(dir,'settings.json'),OPENSCREEN_BIN:process.execPath,OPENSCREEN_USER_DATA_DIR:path.join(dir,'profile')});
 const project=createScreenProject('失败链路 中文 空格'),folder=projectFolder(project.id),media=path.join(folder,'media/source.mp4');fs.mkdirSync(path.dirname(media),{recursive:true});fs.writeFileSync(media,'fixture-source-not-a-video');
 const document=recordingDocument({version:2,media:{screenVideoPath:media},editor:{}},{duration:2,width:640,height:360,fps:30},{id:'qa_document',title:'导出测试',createdAt:new Date().toISOString()});
 project.media.push({id:'asset_qa_document',name:'fixture',type:'video',mimeType:'video/mp4',originalFile:'media/source.mp4',duration:2,width:640,height:360,fps:30,status:'ready',createdAt:Date.now(),size:25} as any);save(folder,project);
 createOpenScreenDocument(project.id,{document});
 const script=path.join(dir,'worker.cjs');fs.writeFileSync(script,worker);
 const originalSpawn=cp.spawn,children:ReturnType<typeof cp.spawn>[]=[],outputs:string[]=[],stagedDocuments:any[]=[];let mode='success';
 const spawnMock=t.mock.method(cp,'spawn',(command:any,args:any[],options:any)=>{
  if(args.includes('export')){stagedDocuments.push(JSON.parse(fs.readFileSync(args[args.indexOf('export')+1],'utf8')));const output=args[args.indexOf('-o')+1];outputs.push(output);const child=originalSpawn(process.execPath,[script,output,mode],{...options,env:{...options.env,ELECTRON_RUN_AS_NODE:'1'}});children.push(child);return child;}
  if(mode==='reveal-error')return originalSpawn(path.join(dir,'missing-explorer.exe'),[],options);
  return originalSpawn(command,args,options);
 });syncBuiltinESMExports();
 const start=(outPath?:string)=>startOpenScreenExport(project.id,'qa_document',{format:'mp4',outPath});
 const read=(id:string)=>readOpenScreenExport(project.id,'qa_document',id);
 const terminal=(id:string)=>until(()=>!['queued','running'].includes(read(id).status));
 return {dir,folder,project,start,read,terminal,outputs,children,stagedDocuments,mode:(value:string)=>{mode=value},async cleanup(){spawnMock.mock.restore();syncBuiltinESMExports();for(const c of children){if(c.exitCode===null&&c.signalCode===null)c.kill('SIGKILL')}await until(()=>children.every(c=>c.exitCode!==null||c.signalCode!==null));for(const k of keys){if(old[k]===undefined)delete process.env[k];else process.env[k]=old[k]}assert.equal(path.dirname(path.resolve(dir)),path.resolve(os.tmpdir()));assert.ok(path.basename(dir).startsWith('opentake-export-failure-'));fs.rmSync(dir,{recursive:true,force:true})}};
}
test('source protocol filters primitive values and surfaces native failures instead of crashing',()=>{assert.deepEqual(sourceListFromEvents([null,42,[],{event:'done',sources:{windows:[{id:'1',title:'中文窗口'}]}}] as any).map(s=>s.name),['中文窗口']);assert.throws(()=>sourceListFromEvents([{event:'done',success:false,error:'来源不可用'}]),/来源不可用/)});
test('cancel waits for owned child close, preserves an existing final file, and retry publishes a new export',async t=>{
 const f=await fixture(t);try{f.mode('wait');const target=path.join(f.folder,'exports','原成品.mp4');fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,'original-complete');const job=f.start(target);await until(()=>fs.existsSync(f.outputs[0]));assert.throws(()=>f.start(target),/目标文件正在导出/);const cancelled=await cancelOpenScreenExport(f.project.id,'qa_document',job.id);assert.equal(cancelled.status,'cancelled');assert.ok(f.children[0].exitCode!==null||f.children[0].signalCode!==null);assert.equal(fs.readFileSync(target,'utf8'),'original-complete');assert.equal(fs.existsSync(path.dirname(f.outputs[0])),false);f.mode('success');const retry=f.start(target);await f.terminal(retry.id);assert.equal(f.read(retry.id).status,'completed');assert.equal(fs.readFileSync(target,'utf8'),'complete-fixture-export');assert.equal(activeOpenScreenExports(),0)}finally{await f.cleanup()}
});

test('file explorer launch failure rejects the request without an unhandled child error',async t=>{
 const f=await fixture(t);try{
  const target=path.join(f.folder,'exports','成片.mp4');fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,'fixture');f.mode('reveal-error');
  await assert.rejects(revealOpenScreenExport(f.project.id,target),{code:'ENOENT'});
 }finally{await f.cleanup()}
});

test('Windows file URLs with Chinese, spaces and escaped characters become native export paths',async t=>{
 const f=await fixture(t);try{
  const wallpaper=path.join(f.folder,'中文 背景 #1.png');fs.writeFileSync(wallpaper,'fixture-image');
  const job=startOpenScreenExport(f.project.id,'qa_document',{format:'mp4',exportEditor:{wallpaper:pathToFileURL(wallpaper).href}});
  assert.equal(f.stagedDocuments[0].legacyEditor.wallpaper,wallpaper);
  await f.terminal(job.id);assert.equal(f.read(job.id).status,'completed');
 }finally{await f.cleanup()}
});

test('staging failure is a failed job and never starts an export worker',async t=>{
 const f=await fixture(t);try{
  assert.throws(()=>startOpenScreenExport(f.project.id,'qa_document',{format:'mp4',exportEditor:{wallpaper:'/wallpapers/wallpaper9999.jpg'}}),/背景资源缺失/);
  const jobs=path.join(f.folder,'analysis/openscreen/qa_document/export-jobs');
  const job=JSON.parse(fs.readFileSync(path.join(jobs,fs.readdirSync(jobs).find(name=>name.endsWith('.json'))!),'utf8'));
  assert.equal(job.status,'failed');assert.match(job.error,/准备导出失败.*背景资源缺失/);assert.equal(f.children.length,0);
 }finally{await f.cleanup()}
});
test('explicit native failure cannot publish a file even when exit code is zero',async t=>{const f=await fixture(t);try{f.mode('reported-error');const job=f.start();await f.terminal(job.id);assert.equal(f.read(job.id).status,'failed');assert.match(f.read(job.id).error||'',/native fixture error/);assert.equal(fs.existsSync(job.outputFile),false)}finally{await f.cleanup()}});
test('an occupied cleanup directory cannot turn a completed export into a backend exception',async t=>{const f=await fixture(t);const original=fs.rmSync;const mock=t.mock.method(fs,'rmSync',((p:any,opts:any)=>{if(String(p).includes('.staging-'))throw Object.assign(Error('simulated sharing lock'),{code:'EPERM'});return original(p,opts)}) as any);try{const job=f.start();await f.terminal(job.id);await until(()=>activeOpenScreenExports()===0);assert.equal(f.read(job.id).status,'completed');assert.equal(fs.readFileSync(job.outputFile,'utf8'),'complete-fixture-export');assert.equal(fs.existsSync(path.dirname(f.outputs[0])),true)}finally{mock.mock.restore();await f.cleanup()}});
test('persistent progress-state write failure is visible and terminates only the owned export',async t=>{const f=await fixture(t);const rename=fs.renameSync;let blocked=false;const mock=t.mock.method(fs,'renameSync',((a:any,b:any)=>{if(blocked&&String(b).includes('export-jobs')&&String(b).endsWith('.json'))throw Object.assign(Error('state sharing lock'),{code:'EBUSY'});return rename(a,b)}) as any);try{f.mode('wait');const job=f.start();blocked=true;await f.terminal(job.id);await until(()=>activeOpenScreenExports()===0);assert.equal(f.read(job.id).status,'failed');assert.match(f.read(job.id).error||'',/保存导出状态失败/);assert.equal(fs.existsSync(job.outputFile),false);assert.ok(f.children[0].exitCode!==null||f.children[0].signalCode!==null)}finally{mock.mock.restore();await f.cleanup()}});

test('a copied export job cannot cancel the original project worker',async t=>{
 const f=await fixture(t);try{
  f.mode('wait');const job=f.start();await until(()=>fs.existsSync(f.outputs[0]));
  const copy=createScreenProject('旧副本 中文'),folder=projectFolder(copy.id);
  const jobs=path.join(folder,'analysis/openscreen/qa_document/export-jobs');fs.mkdirSync(jobs,{recursive:true});
  fs.writeFileSync(path.join(jobs,job.id+'.json'),JSON.stringify(job));
  await assert.rejects(cancelOpenScreenExport(copy.id,'qa_document',job.id),/不属于当前工程/);
  assert.equal(f.read(job.id).status,'running');assert.equal(f.children[0].exitCode,null);assert.equal(f.children[0].signalCode,null);
  await cancelOpenScreenExport(f.project.id,'qa_document',job.id);assert.equal(f.read(job.id).status,'cancelled');
 }finally{await f.cleanup()}
});
