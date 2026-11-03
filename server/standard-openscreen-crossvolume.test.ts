import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import cp from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import {setTimeout as delay} from 'node:timers/promises';
import {recordingDocument} from '../shared/openscreen-recording.ts';
import {createScreenProject,projectFolder,save} from './editor/store.ts';
import {createOpenScreenDocument} from './editor/openscreen-documents.ts';
import {startOpenScreenExport,readOpenScreenExport,cancelOpenScreenExport,activeOpenScreenExports,createOpenScreenExportTarget} from './editor/openscreen-export.ts';
import {ffmpegPath,ffprobePath} from './general/kit-env.ts';

// Real filesystem/draft regression with actual FFmpeg processes. The installed
// OpenScreen renderer is a copying child; a test-only encoder adapter replaces
// VideoToolbox with MPEG-4. No browser or user project is opened. CI without a
// second volume reports an explicit skip; this does not validate native rendering.
const secondVolume=process.env.OPENTAKE_CROSS_VOLUME_TEST_ROOT || '/Volumes/CreativeWorkspaceStorage/development';
const firstVolume=process.platform==='darwin'?'/private/tmp':os.tmpdir();
const available=fs.existsSync(secondVolume)&&fs.statSync(firstVolume).dev!==fs.statSync(secondVolume).dev;
const skip=available?false:'需要不同 st_dev 的第二卷；可设置 OPENTAKE_CROSS_VOLUME_TEST_ROOT';
const hash=(file:string)=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
async function until(check:()=>boolean){const deadline=Date.now()+30_000;while(!check()){if(Date.now()>deadline)throw Error('跨卷导出测试超时');await delay(20)}}
const worker=`const fs=require('node:fs');const [source,out,mode]=process.argv.slice(2);fs.copyFileSync(source,out);process.stdout.write(JSON.stringify({event:'progress',progress:0.4})+'\\n');if(mode==='wait'){setInterval(()=>{},100)}else{process.stdout.write(JSON.stringify({event:'done',success:true})+'\\n');}`;

async function fixture(t:any){
 const sourceRoot=fs.mkdtempSync(path.join(firstVolume,'opentake-crossvolume-source-'));
 const destination=fs.mkdtempSync(path.join(secondVolume,'opentake-crossvolume-target-'));
 assert.notEqual(fs.statSync(sourceRoot).dev,fs.statSync(destination).dev);
 const keys=['LINK_READER_PROJECTS_DIR','LINKREADER_SYSTEM_SETTINGS_FILE','OPENSCREEN_BIN','OPENSCREEN_USER_DATA_DIR','LINKREADER_BIN_DIR'];
 const old=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
 Object.assign(process.env,{LINK_READER_PROJECTS_DIR:sourceRoot,LINKREADER_SYSTEM_SETTINGS_FILE:path.join(sourceRoot,'settings.json'),OPENSCREEN_BIN:process.execPath,OPENSCREEN_USER_DATA_DIR:path.join(sourceRoot,'profile')});
 // VideoToolbox cannot create a compression session inside the macOS sandbox.
 // Keep the real FFmpeg process, filters and output path, but use its built-in
 // MPEG-4 encoder in this filesystem regression. This is NOT H.264/VT acceptance.
 const actualFfmpeg=ffmpegPath(),actualFfprobe=ffprobePath(),bin=path.join(sourceRoot,'test-bin');
 fs.mkdirSync(bin);
 fs.writeFileSync(path.join(bin,'ffmpeg'),`#!${process.execPath}
const cp=require('node:child_process');let args=process.argv.slice(2);if(args.includes('h264_videotoolbox')){const drop=new Set(['-allow_sw','-prio_speed','-profile:v','-q:v']);const out=[];for(let i=0;i<args.length;i++){if(drop.has(args[i])){i++;continue}out.push(args[i]==='h264_videotoolbox'?'mpeg4':args[i])}args=out}const child=cp.spawn(${JSON.stringify(actualFfmpeg)},args,{stdio:'inherit'});process.on('SIGTERM',()=>child.kill('SIGTERM'));child.on('error',()=>process.exit(1));child.on('close',code=>process.exit(code??1));`,{mode:0o755});
 fs.symlinkSync(actualFfprobe,path.join(bin,'ffprobe'));
 process.env.LINKREADER_BIN_DIR=bin;
 const children:ReturnType<typeof cp.spawn>[]=[],outputs:string[]=[],stagingDevices:number[]=[];
 let mode='success';
 const originalSpawn=cp.spawn;
 let spawnMock:any;
 const cleanup=async()=>{
  spawnMock?.mock.restore();syncBuiltinESMExports();
  for(const child of children)if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');
  await until(()=>children.every(c=>c.exitCode!==null||c.signalCode!==null)&&activeOpenScreenExports()===0);
  for(const key of keys){if(old[key]===undefined)delete process.env[key];else process.env[key]=old[key]}
  fs.rmSync(sourceRoot,{recursive:true,force:true});fs.rmSync(destination,{recursive:true,force:true});
 };
 t.after(cleanup);
 const project=createScreenProject('跨卷 中文 空格'),folder=projectFolder(project.id),media=path.join(folder,'media/source.mp4');
 fs.mkdirSync(path.dirname(media),{recursive:true});
 cp.execFileSync(ffmpegPath(),['-v','error','-y','-f','lavfi','-i','color=c=blue:s=160x90:r=30','-t','0.2','-c:v','mpeg4',media],{timeout:20_000});
 const document=recordingDocument({version:2,media:{screenVideoPath:media},editor:{}},{duration:0.2,width:160,height:90,fps:30},{id:'qa_crossvolume',title:'跨卷测试',createdAt:new Date().toISOString()});
 project.media.push({id:'asset_qa_crossvolume',name:'跨卷源片',type:'video',mimeType:'video/mp4',originalFile:'media/source.mp4',duration:0.2,width:160,height:90,fps:30,status:'ready',createdAt:Date.now(),size:fs.statSync(media).size} as any);
 save(folder,project);createOpenScreenDocument(project.id,{document});
 const script=path.join(sourceRoot,'worker.cjs');fs.writeFileSync(script,worker);
 spawnMock=t.mock.method(cp,'spawn',(command:any,args:any[],options:any)=>{
  if(!args.includes('export'))return originalSpawn(command,args,options);
  const output=args[args.indexOf('-o')+1];outputs.push(output);
  stagingDevices.push(fs.statSync(path.dirname(output)).dev);
  const child=originalSpawn(process.execPath,[script,media,output,mode],{...options,env:{...options.env,ELECTRON_RUN_AS_NODE:'1'}});children.push(child);return child;
 });syncBuiltinESMExports();
 const start=(preset:'quick'|'jianying')=>startOpenScreenExport(project.id,'qa_crossvolume',{settings:{preset,destinationDir:destination,conflictPolicy:'versioned',folderName:'相同名称',video:{codec:'h264',encoder:'software'}}});
 const read=(id:string)=>readOpenScreenExport(project.id,'qa_crossvolume',id);
 const terminal=async(id:string)=>{await until(()=>!['queued','running'].includes(read(id).status)&&activeOpenScreenExports()===0);return read(id)};
 const assertClean=()=>{
  assert.equal(fs.readdirSync(path.join(folder,'analysis/openscreen/qa_crossvolume/export-jobs')).some(name=>name.startsWith('.staging-')),false);
  for(const device of stagingDevices)assert.equal(device,fs.statSync(destination).dev,'交付暂存必须位于目标卷');
  for(const output of outputs)assert.equal(fs.existsSync(path.dirname(output)),false,'本次暂存已清理');
  assert.equal(hash(media),sourceHash,'源素材未改动');
 };
 const sourceHash=hash(media);
 return {sourceRoot,destination,folder,project,media,outputs,children,start,read,terminal,assertClean,mode:(value:string)=>{mode=value}};
}

for(const preset of ['quick','jianying'] as const){
 test(`真实跨卷 ${preset==='quick'?'MP4':'剪映目录'} 导出成功，重复导出保留旧版本`,{skip},async t=>{
  const f=await fixture(t);
  const first=f.start(preset),done=await f.terminal(first.id);
  assert.equal(done.status,'completed',done.error);
  assert.ok(fs.existsSync(done.outputFile));
  const media=preset==='quick'?done.outputFile:path.join(done.outputFile,'Resources/成片.mp4');
  const previousHash=hash(media);
  const info=JSON.parse(cp.execFileSync(ffprobePath(),['-v','error','-show_streams','-of','json',media],{encoding:'utf8'}));
  assert.equal(info.streams[0].width,160);assert.equal(info.streams[0].height,90);
  if(preset==='jianying'){
   assert.ok(fs.existsSync(path.join(done.outputFile,'draft_content.json')));
   assert.ok(fs.existsSync(path.join(done.outputFile,'handoff.json')));
   assert.equal(previousHash,hash(f.media));
  }
  const second=f.start(preset),secondDone=await f.terminal(second.id);
  assert.equal(secondDone.status,'completed',secondDone.error);
  assert.notEqual(first.outputDir,second.outputDir,'versioned 输出目录保持唯一');
  assert.equal(hash(media),previousHash,'再次导出保留首个成品');
  f.assertClean();
  t.diagnostic(JSON.stringify({sourceDevice:fs.statSync(f.folder).dev,targetDevice:fs.statSync(f.destination).dev,preset,encoderFixture:preset==='quick'?'mpeg4 replaces VideoToolbox only':'real Python draft builder',mediaSha256:previousHash,probe:info.streams.map((v:any)=>({codec:v.codec_name,width:v.width,height:v.height,fps:v.avg_frame_rate}))}));
 });
 test(`真实跨卷 ${preset} 中途取消清理两边暂存且保留旧成品`,{skip},async t=>{
  const f=await fixture(t),old=path.join(f.destination,'原有成品.mp4');fs.writeFileSync(old,'original-complete');
  f.mode('wait');const job=f.start(preset);await until(()=>fs.existsSync(f.outputs[0]));
  const cancelled=await cancelOpenScreenExport(f.project.id,'qa_crossvolume',job.id);
  assert.equal(cancelled.status,'cancelled');await f.terminal(job.id);
  assert.equal(fs.existsSync(job.outputFile),false);assert.equal(fs.existsSync(job.outputDir!),false);
  assert.deepEqual(fs.readdirSync(f.destination),['原有成品.mp4']);assert.equal(fs.readFileSync(old,'utf8'),'original-complete');f.assertClean();
 });
 test(`真实跨卷 ${preset} 提升失败清理两边暂存且保留旧成品`,{skip},async t=>{
  const f=await fixture(t),old=path.join(f.destination,'原有成品.mp4');fs.writeFileSync(old,'original-complete');
  const rename=fs.renameSync;let blocked=false;
  const mock=t.mock.method(fs,'renameSync',((from:any,to:any)=>{
   if(String(from).includes('.staging-')&&path.dirname(String(to)).startsWith(f.destination)){
    blocked=true;assert.ok(fs.statSync(from).size>0||fs.statSync(from).isDirectory());
    throw Object.assign(Error('目标写入失败测试'),{code:'EACCES'});
   }
   return rename(from,to);
  }) as any);
  try{
   const job=f.start(preset),done=await f.terminal(job.id);assert.equal(done.status,'failed');assert.equal(blocked,true);
   assert.equal(fs.existsSync(job.outputFile),false);assert.equal(fs.existsSync(job.outputDir!),false);
   assert.deepEqual(fs.readdirSync(f.destination),['原有成品.mp4']);assert.equal(fs.readFileSync(old,'utf8'),'original-complete');f.assertClean();
  }finally{mock.mock.restore()}
 });
}

test('编码信息写入失败保留目标原成品并清理部分 sidecar 与暂存',{skip},async t=>{
 const f=await fixture(t),write=fs.writeFileSync;let blocked=false;
 const mock=t.mock.method(fs,'writeFileSync',((file:any,data:any,options:any)=>{
  if(typeof file==='number'){blocked=true;write(file,'partial-json');throw Object.assign(Error('磁盘写满测试'),{code:'ENOSPC'})}
  return write(file,data,options);
 }) as any);
 try{
  const job=f.start('quick');write(job.outputFile,'original-complete');
  const done=await f.terminal(job.id);assert.equal(done.status,'failed');assert.equal(blocked,true);
  assert.equal(fs.readFileSync(job.outputFile,'utf8'),'original-complete');
  assert.deepEqual(fs.readdirSync(job.outputDir!),['成片.mp4']);f.assertClean();
 }finally{mock.mock.restore()}
});

test('旧入口 uniqueOutput 保留已有文件并分配后缀',{skip},async t=>{
 const f=await fixture(t),RealDate=Date,now=new Date();
 const dateMock=t.mock.method(globalThis,'Date',class extends RealDate{constructor(...args:any[]){super(...(args.length?args:[now]) as [any])}} as any);
 try{
  const first=createOpenScreenExportTarget(f.project.id,'qa_crossvolume',{suggested:'已有成品.mp4'});
  fs.writeFileSync(first.path,'original-complete');
  const second=createOpenScreenExportTarget(f.project.id,'qa_crossvolume',{suggested:'已有成品.mp4'});
  assert.equal(second.path,first.path.replace(/\.mp4$/,'-2.mp4'));
  assert.equal(fs.readFileSync(first.path,'utf8'),'original-complete');
 }finally{dateMock.mock.restore()}
});
