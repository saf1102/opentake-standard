import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createScreenProject,findProject} from './editor/store.ts';
import {createOpenScreenDocument,readOpenScreenDocument,saveOpenScreenDocument} from './editor/openscreen-documents.ts';
import {readOpenScreenHostSession} from './editor/openscreen-host.ts';

function fixture(){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'opentake-save-'));
 const keys=['LINK_READER_PROJECTS_DIR','LINKREADER_SYSTEM_SETTINGS_FILE'];
 const old=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
 Object.assign(process.env,{LINK_READER_PROJECTS_DIR:dir,LINKREADER_SYSTEM_SETTINGS_FILE:path.join(dir,'settings.json')});
 const project=createScreenProject('保存失败 中文 空格'),folder=findProject(project.id).dir;
 const document={schemaVersion:7,project:{id:'qa_save',title:'原文档'},assets:[],timeline:{clips:[]}};
 return {project,folder,document,cleanup(){for(const key of keys){if(old[key]===undefined)delete process.env[key];else process.env[key]=old[key]}assert.equal(path.dirname(path.resolve(dir)),path.resolve(os.tmpdir()));assert.ok(path.basename(dir).startsWith('opentake-save-'));fs.rmSync(dir,{recursive:true,force:true})}};
}

for(const target of ['project.json','document.json'])test(`a locked ${target} leaves the saved document, revision and reference consistent`,t=>{
 const f=fixture();let mock:ReturnType<typeof t.mock.method>|undefined;
 try{
  createOpenScreenDocument(f.project.id,{document:f.document});
  const root=path.join(f.folder,'analysis/openscreen/qa_save'),docFile=path.join(root,'project.openscreen'),metaFile=path.join(root,'document.json'),projectFile=path.join(f.folder,'project.json');
  const before=[docFile,metaFile,projectFile].map(file=>fs.readFileSync(file));
  const rename=fs.renameSync;mock=t.mock.method(fs,'renameSync',((a:any,b:any)=>{if(String(b)===(target==='project.json'?projectFile:metaFile))throw Object.assign(Error('fixture lock'),{code:'EBUSY'});return rename(a,b)}) as any);
  const edited={...f.document,project:{...f.document.project,title:'未提交修改'}};
  assert.throws(()=>saveOpenScreenDocument(f.project.id,'qa_save',{document:edited,revision:0}),/保存文件失败/);
  [docFile,metaFile,projectFile].forEach((file,index)=>assert.deepEqual(fs.readFileSync(file),before[index]));
  assert.equal(readOpenScreenDocument(f.project.id,'qa_save').revision,0);
  mock.mock.restore();mock=undefined;
  assert.equal(saveOpenScreenDocument(f.project.id,'qa_save',{document:edited,revision:0}).revision,1);
  assert.equal(readOpenScreenDocument(f.project.id,'qa_save').ref.title,'未提交修改');
 }finally{mock?.mock.restore();f.cleanup()}
});

test('failed creation cannot leave a half-created document that prevents retry',t=>{
 const f=fixture();let mock:ReturnType<typeof t.mock.method>|undefined;
 try{
  const target=path.join(f.folder,'project.json'),rename=fs.renameSync;
  mock=t.mock.method(fs,'renameSync',((a:any,b:any)=>{if(String(b)===target)throw Object.assign(Error('fixture lock'),{code:'EPERM'});return rename(a,b)}) as any);
  assert.throws(()=>createOpenScreenDocument(f.project.id,{document:f.document}),/保存文件失败/);
  assert.equal(findProject(f.project.id).project.openScreenDocuments.length,0);
  assert.equal(fs.existsSync(path.join(f.folder,'analysis/openscreen/qa_save/project.openscreen')),false);
  assert.equal(fs.existsSync(path.join(f.folder,'analysis/openscreen/qa_save/document.json')),false);
  mock.mock.restore();mock=undefined;
  assert.equal(createOpenScreenDocument(f.project.id,{document:f.document}).revision,0);
 }finally{mock?.mock.restore();f.cleanup()}
});

test('a copied recording session cannot mutate the original project',()=>{
 const f=fixture();try{
  const original=createScreenProject('原工程'),copySession={id:'old_session',projectId:original.id,status:'waiting',mode:'native-hud',createdAt:Date.now(),updatedAt:Date.now(),candidateFiles:[],candidates:[],baselineFingerprints:{},observedArtifacts:{}};
  const file=path.join(f.folder,'analysis/openscreen/host-sessions/old_session.json');fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(copySession));
  assert.throws(()=>readOpenScreenHostSession(f.project.id,'old_session'),/不属于当前工程/);
  assert.equal(fs.existsSync(path.join(findProject(original.id).dir,'analysis/openscreen/host-sessions/old_session.json')),false);
  assert.deepEqual(JSON.parse(fs.readFileSync(file,'utf8')),copySession);
 }finally{f.cleanup()}
});
