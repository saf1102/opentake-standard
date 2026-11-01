import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {startCodex} from './general/codex.ts';

// A local synthetic worker exercises the real pipe callbacks. No model, login,
// credential file or network request is involved.
for(const kind of ['callback','event-log'])test(`Agent ${kind} I/O failure reports failure and closes its owned worker`,async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'opentake-agent-io-'));
 const script=`process.stdout.write('null\\n42\\n[]\\n'+JSON.stringify({type:'fixture'})+'\\n');setInterval(()=>{},1000);`;
 const task=startCodex(process.execPath,['-e',script],{cwd:root,env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},prompt:'synthetic fixture only',
  eventLog:kind==='event-log'?root:undefined,onEvent:()=>{if(kind==='callback')throw Object.assign(Error('synthetic project-save sharing lock'),{code:'EBUSY'})}});
 let timer:ReturnType<typeof setTimeout>|undefined;
 try{
  const result=await Promise.race([task.done,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('synthetic worker timeout')),5000)})]);
  assert.equal(result.code,-1);assert.match(result.stderr,/记录 Agent 运行失败/);
  assert.ok(task.child.exitCode!==null||task.child.signalCode!==null);
  if(kind==='callback')assert.match(result.stderr,/synthetic project-save sharing lock/);
 }finally{clearTimeout(timer);if(task.child.exitCode===null&&task.child.signalCode===null){task.stop();await task.done}assert.equal(path.dirname(path.resolve(root)),path.resolve(os.tmpdir()));assert.ok(path.basename(root).startsWith('opentake-agent-io-'));fs.rmSync(root,{recursive:true,force:true})}
});
