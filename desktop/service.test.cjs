const test=require('node:test');const assert=require('node:assert/strict');const {fork}=require('node:child_process');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');const {once}=require('node:events');
test('owned service starts, rejects cross-origin access, and closes its listener on exit', {timeout:30000}, async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'standard-desktop-'));
 const child=fork(path.join(__dirname,'service.mjs'),['development'],{env:{...process.env,LINK_READER_PROJECTS_DIR:path.join(dir,'projects'),LINKREADER_SYSTEM_SETTINGS_FILE:path.join(dir,'settings.json')},stdio:['ignore','ignore','pipe','ipc']});
 let exited=false;child.once('exit',()=>{exited=true});let stderr='';child.stderr.on('data',b=>stderr+=b);
 try {
  const message=await Promise.race([once(child,'message').then(([m])=>m),once(child,'exit').then(()=>{throw Error(stderr)})]);
  assert.match(message.ready,/^http:\/\/127\.0\.0\.1:\d+$/);
  const good=await fetch(message.ready+'/api/editor/projects');assert.equal(good.status,200);assert.deepEqual((await good.json()).result,[]);
  const bad=await fetch(message.ready+'/api/editor/projects',{headers:{Origin:'https://example.com'}});assert.equal(bad.status,403);
  const exit=once(child,'exit');child.kill('SIGTERM');await exit;
  await assert.rejects(fetch(message.ready+'/api/editor/projects'));
 } finally {if(!exited)child.kill('SIGKILL');fs.rmSync(dir,{recursive:true,force:true})}
});
