import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {execFileAsync} from './proc.ts';
import platform from './platform.ts';
const require=createRequire(import.meta.url);
const {retrySync,atomicWriteFileSync}=require('../desktop/file-ops.cjs');

test('Windows 分享锁仅重试限定错误，并保留最终错误与次数上限',()=>{
 const waits:number[]=[];let attempts=0;
 assert.equal(retrySync(()=>{if(++attempts<3)throw Object.assign(Error('locked'),{code:'EBUSY'});return 'saved';},'win32',(n:number)=>waits.push(n)),'saved');
 assert.deepEqual(waits,[15,30]);assert.equal(attempts,3);
 attempts=0;const denied=Object.assign(Error('locked'),{code:'EPERM'});
 assert.throws(()=>retrySync(()=>{attempts++;throw denied},'win32',()=>{}),error=>error===denied);assert.equal(attempts,7);
 attempts=0;assert.throws(()=>retrySync(()=>{attempts++;throw denied},'darwin',()=>{}));assert.equal(attempts,1);
 const space=Object.assign(Error('full'),{code:'ENOSPC'});attempts=0;
 assert.throws(()=>retrySync(()=>{attempts++;throw space},'win32',()=>{}),error=>error===space);assert.equal(attempts,1);
});
test('原子替换失败保留旧文件和可恢复新字节',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'task44-atomic-'));const file=path.join(dir,'中文 工程.json');fs.writeFileSync(file,'old');
 const original=fs.renameSync;
 try{fs.renameSync=(()=>{throw Object.assign(Error('occupied'),{code:'EPERM'})}) as typeof fs.renameSync;
  assert.throws(()=>atomicWriteFileSync(file,'new'),(error:any)=>{assert.equal(fs.readFileSync(error.recoveryFile,'utf8'),'new');return error.code==='EPERM'});
  assert.equal(fs.readFileSync(file,'utf8'),'old');
 }finally{fs.renameSync=original;fs.rmSync(dir,{recursive:true,force:true})}
});
test('平台路径保留 Mac 历史位置，Windows 使用 Standard 独立目录',()=>{
 assert.equal(platform.desktopDataRoot('darwin',{},'/fixture/home'),'/fixture/home/Library/Application Support/linkreader-desktop');
 assert.equal(platform.desktopDataRoot('win32',{APPDATA:'C:\\Users\\test\\AppData\\Roaming'},'C:\\Users\\test'),'C:\\Users\\test\\AppData\\Roaming\\OpenTake Standard');
 assert.equal(platform.cacheRoot('LinkReader','win32',{LOCALAPPDATA:'D:\\缓存'},'C:\\Users\\test'),'D:\\缓存\\LinkReader');
 assert.equal(platform.projectsRoot('darwin',{},'/fixture/home'),'/fixture/home/Movies/LinkReader Projects');
});
test('Windows 工具搜索和 PATH 不注入 Mac 目录',()=>{
 const dirs=platform.runtimeBinaryCandidates('ffmpeg',{platform:'win32',env:{LINKREADER_BIN_DIR:'D:\\本地 工具',Path:'C:\\Windows;C:\\Node'}});
 assert.equal(dirs[0],'D:\\本地 工具\\ffmpeg.exe');assert.ok(dirs.every(p=>!p.includes('/opt/')&&!p.endsWith('.app')));
 assert.equal(platform.runtimePath({Path:'C:\\Windows;C:\\Node'},['D:\\工具'],'win32'),'D:\\工具;C:\\Windows;C:\\Node');
});
test('Windows 结束进程使用带 PID 的树清理；Mac 分组不存在才退单进程',()=>{
 const calls:any[]=[];
 (platform.killTree as any)(456,'SIGTERM','win32',(...args:any[])=>calls.push(args),()=>{throw Error('unexpected')});
 assert.equal(calls[0][0],'taskkill.exe');assert.deepEqual(calls[0][1],['/PID','456','/T','/F']);
 const pids:number[]=[];(platform.killTree as any)(456,'SIGTERM','darwin',()=>{},(pid:number)=>{pids.push(pid);if(pid<0)throw Error('not group')});assert.deepEqual(pids,[-456,456]);
});
test('共用执行边界给真实 Node 子进程传入 UTF8 环境并保留调用者环境',async()=>{
 const result=await execFileAsync(process.execPath,['-e','process.stdout.write(JSON.stringify([process.env.PYTHONUTF8,process.env.TASK44_SYNTHETIC]))'],{env:{...process.env,PYTHONUTF8:'0',TASK44_SYNTHETIC:'中文'}});
 assert.deepEqual(JSON.parse(result.stdout),['1','中文']);
});
