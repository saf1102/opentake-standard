import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {findProject,save,scan} from './editor/store.ts';
import {listBackups,restoreBackup} from './editor/project-backups.ts';
import {cleanStorage,storageOverview} from './editor/storage.ts';
import {purgeProjectDirectory} from './editor/purge-project.ts';
import {registerProjectLibrary,readSystemSettings,writeSystemSettings} from './system-settings.ts';

function fixture(){
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'task21-storage-')),root=path.join(temp,'projects');fs.mkdirSync(root);
 const old={projects:process.env.LINK_READER_PROJECTS_DIR,settings:process.env.LINKREADER_SYSTEM_SETTINGS_FILE,app:process.env.LINKREADER_STORAGE_APP_DATA,jianying:process.env.LINKREADER_JIANYING_PROJECTS_DIR};
 process.env.LINK_READER_PROJECTS_DIR=root;process.env.LINKREADER_SYSTEM_SETTINGS_FILE=path.join(temp,'settings.json');process.env.LINKREADER_STORAGE_APP_DATA=path.join(temp,'app');process.env.LINKREADER_JIANYING_PROJECTS_DIR=path.join(temp,'drafts');
 const dir=path.join(root,'screen-task21');fs.mkdirSync(path.join(dir,'media'),{recursive:true});fs.mkdirSync(path.join(dir,'analysis/openscreen/doc'),{recursive:true});
 const timeline={duration:0,fps:30,playhead:0,tracks:[]};
 const p={schemaVersion:5,standardKind:'screen',id:'screen-task21',name:'录屏备份验证',createdAt:1,updatedAt:1,revision:0,settings:{width:640,height:360,fps:30,canvasMode:'custom'},media:[],timeline,transcript:[],openScreenDocuments:[],timelineVersions:[{id:'main',kind:'a-roll',name:'主时间线',timeline:structuredClone(timeline),transcript:[],revision:0,frozen:false,createdAt:1,updatedAt:1}],activeTimelineVersionId:'main'};
 fs.writeFileSync(path.join(dir,'project.json'),JSON.stringify(p));fs.writeFileSync(path.join(dir,'.opentake-screen.json'),'{}');fs.writeFileSync(path.join(dir,'analysis/openscreen/doc/project.openscreen'),'{"revision":1}');
 return {temp,root,dir,id:p.id,cleanup(){for(const [key,value] of Object.entries({LINK_READER_PROJECTS_DIR:old.projects,LINKREADER_SYSTEM_SETTINGS_FILE:old.settings,LINKREADER_STORAGE_APP_DATA:old.app,LINKREADER_JIANYING_PROJECTS_DIR:old.jianying}))if(value===undefined)delete process.env[key];else process.env[key]=value;fs.rmSync(temp,{recursive:true,force:true});}};
}
test('S06 保存前自动备份，恢复录屏文档为独立副本',async()=>{
 const f=fixture();try{const initial=JSON.parse(fs.readFileSync(path.join(f.dir,'project.json'),'utf8'));initial.media=[{id:'source',name:'录屏.mp4',type:'video',mimeType:'video/mp4',originalFile:'media/source.mp4',duration:1,size:6,createdAt:1,status:'ready',origin:'screen-recording',parentAssetIds:[]}];fs.writeFileSync(path.join(f.dir,'media/source.mp4'),'source');fs.writeFileSync(path.join(f.dir,'project.json'),JSON.stringify(initial));const {project}=findProject(f.id);project.name='修改后';save(f.dir,project);const backups=listBackups();assert.equal(backups.length,1);assert.equal(backups[0].name,'录屏备份验证');fs.writeFileSync(path.join(f.dir,'analysis/openscreen/doc/project.openscreen'),'{"revision":2}');const restored=await restoreBackup(backups[0].id);assert.notEqual(restored.id,f.id);const copy=findProject(restored.id);assert.ok(copy.project.media[0].originalFile.startsWith('media/'));assert.equal(fs.readFileSync(path.resolve(copy.dir,copy.project.media[0].originalFile),'utf8'),'source');assert.equal(JSON.parse(fs.readFileSync(path.join(copy.dir,'analysis/openscreen/doc/project.openscreen'),'utf8')).revision,1);assert.equal(JSON.parse(fs.readFileSync(path.join(f.dir,'analysis/openscreen/doc/project.openscreen'),'utf8')).revision,2);}finally{f.cleanup();}
});
test('S06 多库读取、离线清理拦截、缓存计划与归档保留原素材',async()=>{
 const f=fixture();try{const second=path.join(f.temp,'second');fs.mkdirSync(second);registerProjectLibrary(second);const secondDir=path.join(second,'second-screen');fs.mkdirSync(secondDir);const raw=JSON.parse(fs.readFileSync(path.join(f.dir,'project.json'),'utf8'));fs.writeFileSync(path.join(secondDir,'project.json'),JSON.stringify({...raw,id:'second-screen',name:'另一个库的录屏'}));fs.writeFileSync(path.join(secondDir,'.opentake-screen.json'),'{}');assert.equal(findProject('second-screen').project.name,'另一个库的录屏');const {project}=findProject(f.id);save(f.dir,project);assert.ok(scan().some(x=>x.project.id===f.id));fs.mkdirSync(path.join(f.dir,'cache/thumbnails'),{recursive:true});fs.writeFileSync(path.join(f.dir,'cache/thumbnails/unused.jpg'),'unused');fs.writeFileSync(path.join(f.dir,'media/source.mp4'),'source');
 const view=await storageOverview(f.id);assert.equal(view.projects.length,1);const plan=await cleanStorage({projectId:f.id,mode:'all',dryRun:true,assertIdle(){}});assert.equal(plan.plannedFiles,1);assert.ok(fs.existsSync(path.join(f.dir,'cache/thumbnails/unused.jpg')));
 await cleanStorage({projectId:f.id,mode:'all',archive:true,assertIdle(){}});assert.ok(findProject(f.id).project.archivedAt);assert.ok(fs.existsSync(path.join(f.dir,'media/source.mp4')));assert.ok(!fs.existsSync(path.join(f.dir,'cache/thumbnails/unused.jpg')));
 fs.renameSync(second,second+'-offline');await assert.rejects(cleanStorage({projectId:f.id,mode:'all',assertIdle(){}}),/工程库离线/);
 }finally{f.cleanup();}
});
test('S06 自动备份关闭生效，彻底删除只接受回收站实体目录',async()=>{
 const f=fixture();try{const settings=readSystemSettings();writeSystemSettings({...settings.preferences,backup:{...settings.preferences.backup,automatic:false}},settings.revision);const p=findProject(f.id).project;save(f.dir,p);assert.equal(listBackups().length,0);const trash=path.join(f.root,'.Trash');fs.mkdirSync(trash);await assert.rejects(purgeProjectDirectory(trash,f.dir,Date.now()),/不在回收站/);const target=path.join(trash,f.id);fs.renameSync(f.dir,target);await purgeProjectDirectory(trash,target,Date.now());assert.ok(!fs.existsSync(target));}finally{f.cleanup();}
});

test('S06 活跃录屏窗口锁阻止清理，备份录屏文件校验失败不恢复',async()=>{
 const f=fixture();try{fs.writeFileSync(path.join(f.dir,'analysis/openscreen/editor-lock.json'),JSON.stringify({clientId:'active',expiresAt:Date.now()+30000}));await assert.rejects(cleanStorage({projectId:f.id,mode:'all',assertIdle(){}}),/关闭正在编辑/);const p=findProject(f.id).project;save(f.dir,p);const [b]=listBackups();const file=path.join(b.root,'snapshots',b.projectId,b.id+'.json'),snapshot=JSON.parse(fs.readFileSync(file,'utf8'));snapshot.recordingFiles[0].text='tampered';fs.writeFileSync(file,JSON.stringify(snapshot));assert.equal(listBackups().length,0);await assert.rejects(restoreBackup(b.id),/校验失败/);}finally{f.cleanup();}
});
