import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createInterface} from 'node:readline';
import test from 'node:test';
import {fakeNodeCli} from './test-support/fake-cli.ts';

test('假 CLI 保留首字节，输入保持打开时逐次应答，EOF 后返回完整 stderr 和退出码',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fixture-stdio-'));
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const file=fakeNodeCli(path.join(dir,'fixture'),`
let bytes=Buffer.alloc(0);
process.stdin.on('data',chunk=>{
 bytes=Buffer.concat([bytes,chunk]);
 let end;
 while((end=bytes.indexOf(10))!==-1){
  process.stdout.write(bytes.subarray(0,end).toString('hex')+'\\n');
  bytes=bytes.subarray(end+1);
 }
});
process.stdin.on('end',()=>{
 process.stderr.write(Buffer.alloc(128*1024,0x71));
 process.exitCode=bytes.length?1:37;
});
`);
 const child=spawn(file,[],{stdio:'pipe',windowsHide:true,timeout:15_000});
 const closed=once(child,'close');
 const replies=createInterface({input:child.stdout})[Symbol.asyncIterator]();
 const errors:Buffer[]=[];
 child.stderr.on('data',chunk=>errors.push(chunk));
 try{
  for(const frame of ['{"method":"initialize"}','第二条消息'.repeat(1024)]){
   const raw=Buffer.from(frame);
   child.stdin.write(raw.subarray(0,1));
   child.stdin.write(Buffer.concat([raw.subarray(1),Buffer.from('\n')]));
   const {done,value}=await replies.next();
   assert.equal(done,false,'假 CLI 在回复之前关闭了 stdout');
   assert.equal(value,raw.toString('hex'),'收到的字节必须与发送的完全相同');
  }
  child.stdin.end();
  assert.deepEqual(await closed,[37,null]);
  assert.deepEqual(Buffer.concat(errors),Buffer.alloc(128*1024,0x71));
 }finally{
  if(child.exitCode===null&&child.signalCode===null)child.kill();
  await closed;
 }
});
