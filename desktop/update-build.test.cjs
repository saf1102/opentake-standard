const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {buildUpdateSource}=require('./update-build.cjs');
for(const arch of ['arm64','x64'])test('源码更新按 '+arch+' 选择产物并准备两份依赖',async()=>{
 const source=fs.mkdtempSync(path.join(os.tmpdir(),'standard-update-arch-'));
 const app=path.join(source,'release',arch==='arm64'?'mac-arm64':'mac','OpenTake Standard.app');
 const other=path.join(source,'release',arch==='arm64'?'mac':'mac-arm64','OpenTake Standard.app');
 const calls=[],steps=[];
 const run=async(cmd,args,cwd)=>{calls.push({cmd,args,cwd});if(args[0]==='run')fs.mkdirSync(app,{recursive:true});};
 try{
  fs.mkdirSync(other,{recursive:true});
  assert.equal(await buildUpdateSource({source,npm:'/native/npm',arch,run,progress:n=>steps.push(n)}),app);
  assert.deepEqual(steps,[2,3]);
  assert.deepEqual(calls.map(c=>c.args),[['ci'],['--prefix','vendor/openscreen','ci','--ignore-scripts'],['run','build:app']]);
  assert.ok(calls.every(c=>c.cmd==='/native/npm'&&c.cwd===source));
  fs.rmSync(app,{recursive:true});
  await assert.rejects(buildUpdateSource({source,npm:'/native/npm',arch,run:async()=>{},progress:()=>{}}),/匹配本机芯片/);
 }finally{fs.rmSync(source,{recursive:true,force:true});}
});
