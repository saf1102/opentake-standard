import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createGeneral, findGeneral, updateGeneral} from './general/store.ts';
import {isLive, postMessage, readSession, setGeneralRuntime, stopRun} from './general/runner.ts';

// Hold the actual runner immediately before agent launch. These tests exercise
// postMessage and real filesystem persistence without spawning an agent/model.
async function fixture(run: (dir: string, id: string) => void) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(),'standard-revision-'));
  const old = process.env.LINK_READER_PROJECTS_DIR;
  process.env.LINK_READER_PROJECTS_DIR=root;
  let release!: (value: {executable:string;model:string;effort:string})=>void;
  const gate = new Promise<{executable:string;model:string;effort:string}>(resolve=>{release=resolve;});
  setGeneralRuntime({style: id=>({id,name_zh:'测试'}) as any,resolveCodex:()=>gate});
  const {dir,project}=createGeneral({styleId:'whiteboard',inputs:{kind:'topic',text:'保留原文案'}},'测试');
  updateGeneral(project.id,p=>{p.versions.push({n:1,createdAt:p.createdAt,duration:15,videoUrl:'/v1.mp4',posterUrl:'/v1.jpg',segments:[]});p.current=1;});
  try {run(dir,project.id);}
  finally {
    stopRun(project.id);
    release({executable:process.execPath,model:'test',effort:'low'});
    for(let i=0;i<20&&isLive(project.id);i++)await new Promise(resolve=>setImmediate(resolve));
    assert.equal(isLive(project.id),false);
    if(old===undefined)delete process.env.LINK_READER_PROJECTS_DIR;else process.env.LINK_READER_PROJECTS_DIR=old;
    fs.rmSync(root,{recursive:true,force:true});
  }
}

test('imported saved project without session starts revision and never archives its work',()=>fixture((dir,id)=>{
  const work=path.join(dir,'work');
  const files={'index.html':'<main data-composition-id="main">原工程</main>','font.ttc':'original font bytes','versions/v1.zip':'original ZIP bytes'};
  for(const [name,body] of Object.entries(files)){fs.mkdirSync(path.dirname(path.join(work,name)),{recursive:true});fs.writeFileSync(path.join(work,name),body);}
  assert.equal(readSession(dir).threadId,undefined);
  const out=postMessage(id,{text:'只检查样张，不重新生成'});
  assert.equal(out.run?.purpose,'revision');
  assert.equal(readSession(dir).pending,'revise');
  assert.equal(readSession(dir).revision?.version,1);
  for(const [name,body] of Object.entries(files))assert.equal(fs.readFileSync(path.join(work,name),'utf8'),body);
  assert.equal(fs.readdirSync(path.join(dir,'agent')).some(name=>name.startsWith('work-')),false);
  assert.equal(findGeneral(id).project.versions.length,1);
}));

test('missing work restores selected version snapshot without changing snapshot or ZIP',()=>fixture((dir,id)=>{
  fs.rmdirSync(path.join(dir,'work'));
  const snapshot=path.join(dir,'versions/v1/work');fs.mkdirSync(path.join(snapshot,'versions'),{recursive:true});
  fs.writeFileSync(path.join(snapshot,'index.html'),'saved source');fs.writeFileSync(path.join(snapshot,'versions/v1.zip'),'saved zip');
  const out=postMessage(id,{text:'继续修改'});
  assert.equal(out.run?.purpose,'revision');
  assert.equal(fs.readFileSync(path.join(dir,'work/index.html'),'utf8'),'saved source');
  assert.equal(fs.readFileSync(path.join(dir,'work/versions/v1.zip'),'utf8'),'saved zip');
  assert.equal(fs.readFileSync(path.join(snapshot,'index.html'),'utf8'),'saved source');
  assert.equal(fs.readFileSync(path.join(snapshot,'versions/v1.zip'),'utf8'),'saved zip');
}));

test('partial work is retained and rejects revision instead of mixing in an old snapshot',()=>fixture((dir,id)=>{
  fs.writeFileSync(path.join(dir,'work/unsaved.txt'),'unsaved edits');
  const snapshot=path.join(dir,'versions/v1/work');fs.mkdirSync(snapshot,{recursive:true});fs.writeFileSync(path.join(snapshot,'index.html'),'old source');
  assert.throws(()=>postMessage(id,{text:'继续'}),/已保留工程.*没有重新生成/);
  assert.equal(fs.readFileSync(path.join(dir,'work/unsaved.txt'),'utf8'),'unsaved edits');
  assert.equal(fs.existsSync(path.join(dir,'work/index.html')),false);
  assert.equal(findGeneral(id).project.run,undefined);
  assert.equal(findGeneral(id).project.messages.length,0);
}));

test('empty work with no source snapshot cannot become a new first cut',()=>fixture((dir,id)=>{
  assert.throws(()=>postMessage(id,{text:'继续'}),/源码快照均不可用/);
  assert.deepEqual(fs.readdirSync(path.join(dir,'work')),[]);
  assert.equal(findGeneral(id).project.run,undefined);
}));

test('empty work restores a snapshot atomically, but non-file snapshot entries are refused',()=>fixture((dir,id)=>{
  const snapshot=path.join(dir,'versions/v1/work');fs.mkdirSync(snapshot,{recursive:true});
  fs.writeFileSync(path.join(snapshot,'index.html'),'saved source');
  fs.symlinkSync(path.join(dir,'general-project.json'),path.join(snapshot,'link.json'));
  assert.throws(()=>postMessage(id,{text:'继续'}),/非普通文件/);
  assert.deepEqual(fs.readdirSync(path.join(dir,'work')),[]);
  fs.unlinkSync(path.join(snapshot,'link.json'));
  const out=postMessage(id,{text:'继续'});
  assert.equal(out.run?.purpose,'revision');
  assert.equal(fs.readFileSync(path.join(dir,'work/index.html'),'utf8'),'saved source');
  assert.equal(fs.readdirSync(dir).some(name=>name.startsWith('.revision-work-')),false);
}));
