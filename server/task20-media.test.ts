import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {binary} from './editor/media-binary.ts';
import {processScreenMedia} from './editor/screen-media.ts';
import {getProjectMediaAudioPeaks} from './editor/audio-peaks.ts';
import {findProject,save} from './editor/store.ts';

function fixture() {
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'task20-media-'));
 const old={projects:process.env.LINK_READER_PROJECTS_DIR,settings:process.env.LINKREADER_SYSTEM_SETTINGS_FILE};
 process.env.LINK_READER_PROJECTS_DIR=root;process.env.LINKREADER_SYSTEM_SETTINGS_FILE=path.join(root,'settings.json');
 const id='task20-media',dir=path.join(root,id);fs.mkdirSync(path.join(dir,'media'),{recursive:true});
 const timeline={duration:0,fps:30,playhead:0,tracks:[]};
 const project={schemaVersion:5,standardKind:'screen',id,name:'原名',createdAt:1,updatedAt:1,revision:0,settings:{width:640,height:360,fps:30,canvasMode:'custom'},media:[{id:'source',name:'source.mp4',type:'video',mimeType:'video/mp4',originalFile:'media/source.mp4',duration:0,size:0,createdAt:1,status:'processing',origin:'screen-recording',parentAssetIds:[]}],timeline,transcript:[],openScreenDocuments:[],timelineVersions:[{id:'main',kind:'a-roll',name:'主时间线',timeline:structuredClone(timeline),transcript:[],revision:0,frozen:false,createdAt:1,updatedAt:1}],activeTimelineVersionId:'main'};
 fs.writeFileSync(path.join(dir,'project.json'),JSON.stringify(project));fs.writeFileSync(path.join(dir,'.opentake-screen.json'),'{}');
 return {root,id,dir,file:path.join(dir,'media/source.mp4'),cleanup(){if(old.projects===undefined)delete process.env.LINK_READER_PROJECTS_DIR;else process.env.LINK_READER_PROJECTS_DIR=old.projects;if(old.settings===undefined)delete process.env.LINKREADER_SYSTEM_SETTINGS_FILE;else process.env.LINKREADER_SYSTEM_SETTINGS_FILE=old.settings;fs.rmSync(root,{recursive:true,force:true});}};
}

test('S09 探测失败持久化 error，保留工程当前内容',async()=>{
 const f=fixture();try{fs.writeFileSync(f.file,'broken video');await assert.rejects(processScreenMedia(f.id,'source'));const p=findProject(f.id).project;assert.equal(p.media[0].status,'error');assert.ok(p.media[0].error);assert.equal(p.name,'原名');}finally{f.cleanup();}
});
test('S09 异步导入只合并处理结果，不覆盖同时改名、素材名、画幅及删除标记',async()=>{
 const f=fixture();try{
 const ffmpeg=binary('ffmpeg');assert.ok(ffmpeg,'验收需要真实 ffmpeg');
 execFileSync(ffmpeg,['-v','error','-y','-f','lavfi','-i','color=c=blue:s=320x180:r=30:d=1','-f','lavfi','-i','sine=frequency=440:sample_rate=16000:duration=1','-c:v','mpeg4','-c:a','aac','-shortest',f.file]);
 const pending=processScreenMedia(f.id,'source');
 const {project}=findProject(f.id);project.name='同时改名';project.settings.width=888;project.media[0].name='保留素材名';project.media[0].removedFromLibrary=true;save(f.dir,project);
 await pending;const latest=findProject(f.id).project;
 assert.equal(latest.name,'同时改名');assert.equal(latest.settings.width,888);assert.equal(latest.media[0].name,'保留素材名');assert.equal(latest.media[0].removedFromLibrary,true);assert.equal(latest.media[0].status,'ready');assert.equal(latest.media[0].width,320);assert.equal(latest.media[0].hasAudio,true);
 const peaks=await getProjectMediaAudioPeaks(f.id,'source');const values=new Float32Array(peaks.buffer.slice(peaks.byteOffset,peaks.byteOffset+peaks.byteLength));
 assert.ok(values.length>=400);assert.ok(values.some(v=>v>0.02));assert.ok(values.some(v=>v<-.02));assert.ok(values.every(v=>Number.isFinite(v)&&Math.abs(v)<=1));
 assert.deepEqual(await getProjectMediaAudioPeaks(f.id,'source',0.1),peaks,'S10 缓存使用源素材完整时长');
 }finally{f.cleanup();}
});
test('S10 共用波形模块不再通过口播 media 落轨模块加载',()=>{
 const code=fs.readFileSync(new URL('./editor/audio-peaks.ts',import.meta.url),'utf8');assert.ok(code.includes('./media-binary.ts'));assert.ok(!code.includes('./media.ts'));
});
