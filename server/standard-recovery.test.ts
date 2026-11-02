import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import type {AddressInfo} from 'node:net';
import {createScreenProject,findProject,save} from './editor/store.ts';
import {createGeneral,findGeneral,fileUrl,saveGeneral,trashGeneral} from './general/store.ts';
import {handleEditorApi} from './standard/openscreen-api.ts';
import {handleGeneralApi} from './general/api.ts';
import {handleSystemSettingsApi} from './editor/api/system-settings.ts';
import {backupProjectFile,listBackups,restoreBackup} from './editor/project-backups.ts';
import {checkedGeneralDocuments} from './general/backups.ts';
async function fixture(t:any){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'standard-recovery-'));const previous=new Map<string,string|undefined>();
  for(const [key,value] of Object.entries({OPENTAKE_STANDARD_USER_DATA:path.join(root,'profile'),LINK_READER_PROJECTS_DIR:root,LINKREADER_SYSTEM_SETTINGS_FILE:path.join(root,'settings.json')})){previous.set(key,process.env[key]);process.env[key]=value}
  const server=http.createServer((req,res)=>{void(async()=>{if(req.url?.startsWith('/api/general/')){req.url=req.url.slice('/api/general'.length);return handleGeneralApi(req,res)}if(req.url?.startsWith('/api/editor/system-settings'))return handleSystemSettingsApi(req,res,req.url.slice('/api/editor/'.length).split('/'));return handleEditorApi(req,res)})().catch(e=>{res.statusCode=e.status||500;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({ok:false,error:e.message}))})});
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));for(const[key,value]of previous){if(value===undefined)delete process.env[key];else process.env[key]=value}assert.equal(path.dirname(path.resolve(root)),path.resolve(os.tmpdir()));fs.rmSync(root,{recursive:true,force:true})});
  const api=async(route:string,method='GET',body?:unknown)=>{const response=await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}${route}`,{method,...(body?{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});return {status:response.status,...await response.json()}};
  return {root,api};
}
test('Windows screen trash restores new and legacy in-place deletions; purge requires explicit matching confirmation',async t=>{
  const {root,api}=await fixture(t),project=createScreenProject('录屏 中文 空格'),dir=findProject(project.id).dir,route=`/api/editor/projects/${project.id}`;
  fs.writeFileSync(path.join(dir,'media','fixture.bin'),'original');
  assert.equal((await api('/api/editor/storage')).ok,true);
  assert.equal((await api(route+'/archive','POST',{archived:true})).ok,true);
  assert.ok(findProject(project.id).project.archivedAt);
  assert.equal((await api(route,'PATCH',{name:'blocked'})).status,423);
  assert.equal((await api(route+'/archive','POST',{archived:false})).ok,true);
  assert.equal((await api(route+'/purge','POST',{confirmProjectId:project.id})).ok,false);
  assert.equal((await api(route,'DELETE')).ok,true);assert.equal(path.basename(path.dirname(findProject(project.id,true).dir)),'.Trash');
  assert.equal((await api('/api/editor/projects?includeDeleted=1')).result[0].deletedAt>0,true);
  assert.equal((await api(route+'/restore','POST')).ok,true);assert.equal(fs.readFileSync(path.join(findProject(project.id).dir,'media','fixture.bin'),'utf8'),'original');
  const legacy=findProject(project.id);legacy.project.deletedAt=Date.now();save(legacy.dir,legacy.project);
  assert.equal((await api(route+'/restore','POST')).ok,true);
  assert.equal((await api(route,'DELETE')).ok,true);assert.equal((await api(route+'/purge','POST',{confirmProjectId:'wrong'})).ok,false);
  const trash=findProject(project.id,true).dir;assert.equal((await api(route+'/purge','POST',{confirmProjectId:project.id})).ok,true);assert.equal(fs.existsSync(trash),false);assert.ok(fs.existsSync(root));
});
test('general trash is visible with deletion state and supports restore and guarded purge through HTTP',async t=>{
  const {api}=await fixture(t),{project,dir}=createGeneral({styleId:'free'},'通用'),route=`/api/general/projects/${project.id}`;
  fs.writeFileSync(path.join(dir,'media','keep.bin'),'keep');
  assert.equal((await api(route,'DELETE')).ok,true);
  assert.equal((await api('/api/general/projects')).result.length,0);
  const rows=(await api('/api/general/projects?includeDeleted=1')).result;assert.equal(rows.length,1);assert.ok(rows[0].deletedAt);
  assert.equal((await api(route+'/restore','POST')).ok,true);assert.equal(fs.readFileSync(path.join(findGeneral(project.id).dir,'media','keep.bin'),'utf8'),'keep');
  assert.equal((await api(route+'/purge','POST',{confirmProjectId:project.id})).ok,false);
  await api(route,'DELETE');assert.equal((await api(route+'/purge','POST',{})).status,400);assert.equal((await api(route+'/purge','POST',{confirmProjectId:project.id})).ok,true);
  assert.equal((await api('/api/general/projects?includeDeleted=1')).result.length,0);
});
test('backup-now includes both project kinds; general restoration preserves snapshot edits and copies media independently',async t=>{
  const {api}=await fixture(t);createScreenProject('录屏备份');const {project,dir}=createGeneral({styleId:'free'},'通用备份');
  fs.writeFileSync(path.join(dir,'media','input.mp4'),'input bytes');fs.writeFileSync(path.join(dir,'versions','v1.mp4'),'video bytes');
  fs.mkdirSync(path.join(dir,'versions','v1'));const edited=path.join(dir,'versions','v1','edited.json');fs.writeFileSync(edited,JSON.stringify({text:'备份时字幕'}));
  project.inputs.media.push({id:'input',name:'原素材',file:'input.mp4',width:100,height:100,duration:1});project.versions.push({n:1,createdAt:project.createdAt,duration:1,videoUrl:fileUrl(project.id,'versions/v1.mp4'),posterUrl:'',segments:[]});project.current=1;saveGeneral(dir,project);
  const result=await api('/api/editor/system-settings/backup-now','POST');assert.equal(result.ok,true);assert.equal(result.result.count,2);
  const backup=listBackups().find(row=>row.projectId===project.id)!;assert.ok(backup);
  fs.writeFileSync(edited,JSON.stringify({text:'后来修改'}));trashGeneral(project.id);
  const restored=await restoreBackup(backup.id);assert.notEqual(restored.id,project.id);assert.equal(restored.kind,'general');
  const copy=findGeneral(restored.id).dir;assert.equal(JSON.parse(fs.readFileSync(path.join(copy,'versions/v1/edited.json'),'utf8')).text,'备份时字幕');
  assert.match(restored.versions[0].videoUrl,new RegExp(restored.id));assert.equal(fs.readFileSync(path.join(copy,'media/input.mp4'),'utf8'),'input bytes');
  const original=findGeneral(project.id,true).dir;fs.unlinkSync(path.join(original,'media/input.mp4'));assert.equal(fs.readFileSync(path.join(copy,'media/input.mp4'),'utf8'),'input bytes');
  await assert.rejects(restoreBackup(backup.id),/缺失/);
});
test('automatic general backup is taken before overwriting metadata and rejects document traversal',async t=>{
  await fixture(t);const {project,dir}=createGeneral({styleId:'free'},'旧名称');project.name='新名称';saveGeneral(dir,project);
  const entries=listBackups().filter(row=>row.projectId===project.id);assert.equal(entries.length,1);assert.match(entries[0].name,/旧名称/);
  assert.throws(()=>checkedGeneralDocuments([{path:'versions/../../outside',text:'x',sha256:'x'}]),/校验失败/);
  assert.ok(backupProjectFile(dir,true,'general'));
});
