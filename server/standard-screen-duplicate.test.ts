import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createScreenProject,projectFolder} from './editor/store.ts';
import {handleEditorApi} from './standard/openscreen-api.ts';
test('duplicate keeps source/edit files and drops Windows locks, export jobs and capture ownership',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'opentake-duplicate-'));
 const oldRoot=process.env.LINK_READER_PROJECTS_DIR,oldSettings=process.env.LINKREADER_SYSTEM_SETTINGS_FILE;
 process.env.LINK_READER_PROJECTS_DIR=dir;process.env.LINKREADER_SYSTEM_SETTINGS_FILE=path.join(dir,'settings.json');
 try{
  const project=createScreenProject('中文录屏'),folder=projectFolder(project.id);
  const files=['lock.json','exports/partial.mp4','exports/done.mp4','analysis/openscreen/host-sessions/session.json','analysis/openscreen/doc/export-jobs/job.json','analysis/openscreen/doc/project.openscreen','media/source.mp4'];
  for(const rel of files){const file=path.join(folder,rel);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,'fixture '+rel)}
  let body='';const res={statusCode:200,setHeader(){},end(value:string){body=value}};
  await handleEditorApi({url:`/api/editor/projects/${project.id}/duplicate`,method:'POST'} as any,res as any);
  const result=JSON.parse(body);assert.equal(result.ok,true);assert.notEqual(result.result.id,project.id);
  const copy=projectFolder(result.result.id);
  for(const rel of files){const retained=rel.startsWith('media/')||rel.endsWith('project.openscreen');assert.equal(fs.existsSync(path.join(copy,rel)),retained,rel);assert.equal(fs.readFileSync(path.join(folder,rel),'utf8'),'fixture '+rel)}
 }finally{if(oldRoot===undefined)delete process.env.LINK_READER_PROJECTS_DIR;else process.env.LINK_READER_PROJECTS_DIR=oldRoot;if(oldSettings===undefined)delete process.env.LINKREADER_SYSTEM_SETTINGS_FILE;else process.env.LINKREADER_SYSTEM_SETTINGS_FILE=oldSettings;assert.equal(path.dirname(path.resolve(dir)),path.resolve(os.tmpdir()));assert.ok(path.basename(dir).startsWith('opentake-duplicate-'));fs.rmSync(dir,{recursive:true,force:true})}
});
