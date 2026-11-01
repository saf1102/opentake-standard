import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {PageExecutionError} from './frame-render/page-execution.ts';
import {renderHyperframes} from './general/hf-render.ts';
import {createGeneral,findGeneral,updateGeneral} from './general/store.ts';
import {initialSteps} from './general/events.ts';
import {isLive,readSession,resumeRun,setGeneralRuntime,stopRun,writeSession} from './general/runner.ts';

async function fixture(error: string, attempted: boolean, body: (ctx: {dir:string;id:string;counts:{renders:number;agents:number}})=>Promise<void>) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'opentake-page-failure-'));
  const old=process.env.LINK_READER_PROJECTS_DIR;process.env.LINK_READER_PROJECTS_DIR=root;
  let release!: (value:{executable:string;model:string;effort:string})=>void;
  const gate=new Promise<{executable:string;model:string;effort:string}>(resolve=>{release=resolve});
  const counts={renders:0,agents:0};
  setGeneralRuntime({style:id=>({id,name_zh:'合成测试',input_type:'any'}),resolveCodex:()=>{counts.agents++;return gate},agentReview:false,
    renderFilm:async()=>{counts.renders++;throw new PageExecutionError('seek',new Error('Maximum call stack size exceeded\n at window.seek (http://ot-render.localhost/index.html:8:22)'),255)}});
  const {dir,project}=createGeneral({styleId:'whiteboard',settings:{aspect:'16:9',length:15},inputs:{kind:'topic',text:'仅测试副本',note:''}},'页面执行回归');
  fs.writeFileSync(path.join(dir,'work/index.html'),'<main data-composition-id="main">preserve source</main>');
  writeSession(dir,{...readSession(dir),pending:'review',pageRepairAttempted:attempted});
  updateGeneral(project.id,p=>{p.run={id:'prior-run',state:'failed',agent:'codex',purpose:'first',steps:initialSteps('topic','first'),startedAt:new Date().toISOString(),error,queued:0}});
  try {await body({dir,id:project.id,counts});}
  finally {
    stopRun(project.id);release({executable:process.execPath,model:'synthetic',effort:'low'});
    for(let i=0;i<100&&isLive(project.id);i++)await delay(5);
    assert.equal(isLive(project.id),false);
    setGeneralRuntime({renderFilm:renderHyperframes});
    if(old===undefined)delete process.env.LINK_READER_PROJECTS_DIR;else process.env.LINK_READER_PROJECTS_DIR=old;
    assert.equal(path.dirname(path.resolve(root)),path.resolve(os.tmpdir()));assert.ok(path.basename(root).startsWith('opentake-page-failure-'));fs.rmSync(root,{recursive:true,force:true});
  }
}
async function until(ok:()=>boolean){const deadline=Date.now()+3000;while(!ok()){assert.ok(Date.now()<deadline,'runner did not settle');await delay(5)}}

test('old stack-overflow project resumes through a source repair, without re-rendering or replacing its work',()=>fixture('page.evaluate: Maximum call stack size exceeded',false,async({dir,id,counts})=>{
  resumeRun(id);await until(()=>counts.agents===1);
  assert.equal(readSession(dir).pending,'polish');assert.equal(counts.renders,0);
  assert.match(readSession(dir).review!,/window\.seek/);assert.match(readSession(dir).review!,/不要重建工程/);
  assert.equal(fs.readFileSync(path.join(dir,'work/index.html'),'utf8'),'<main data-composition-id="main">preserve source</main>');
  assert.equal(findGeneral(id).project.versions.length,0);
}));

test('new page failure requests one automatic authored repair and persists the browser stack',()=>fixture('interrupted check',false,async({dir,id,counts})=>{
  resumeRun(id);await until(()=>counts.agents===1);
  assert.equal(counts.renders,1);assert.equal(readSession(dir).pending,'polish');assert.equal(readSession(dir).pageRepairAttempted,true);
  assert.equal(readSession(dir).pageFailure?.file,'index.html');assert.equal(readSession(dir).pageFailure?.line,8);
  const files=fs.readdirSync(path.join(dir,'agent/diagnostics'));assert.equal(files.length,1);
  const diagnostic=JSON.parse(fs.readFileSync(path.join(dir,'agent/diagnostics',files[0]),'utf8'));assert.match(diagnostic.stack,/window\.seek/);assert.equal(diagnostic.frame,255);
  assert.match(findGeneral(id).project.messages.at(-1)!.text,/修复已有页面后重试/);assert.equal(findGeneral(id).project.versions.length,0);
}));

test('failed automatic repair stops; an explicit retry repairs source before another render',()=>fixture('interrupted check',true,async({id,counts})=>{
  resumeRun(id);await until(()=>!isLive(id));
  const failed=findGeneral(id).project.run!;assert.equal(failed.state,'failed');assert.equal(failed.failure?.kind,'generated-page');assert.ok(failed.failure?.diagnosticFile);
  assert.equal(counts.renders,1);assert.equal(counts.agents,0);
  resumeRun(id);await until(()=>counts.agents===1);assert.equal(counts.renders,1);
}));

test('diagnostic write failure cannot leave a page failure running or claim a nonexistent diagnostic',()=>fixture('interrupted check',true,async({dir,id,counts})=>{
  fs.writeFileSync(path.join(dir,'agent/diagnostics'),'occupied');resumeRun(id);await until(()=>!isLive(id));
  const failed=findGeneral(id).project.run!;assert.equal(failed.state,'failed');assert.match(failed.error!,/生成页面执行失败.*Maximum call stack/);
  assert.equal(failed.failure?.diagnosticFile,undefined);assert.equal(counts.renders,1);assert.equal(counts.agents,0);
}));
