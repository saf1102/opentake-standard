import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {lockedDownload,safeArchivePaths,verifyRuntimeTree} from './prepare-windows-runtimes.mjs';
const sha=data=>crypto.createHash('sha256').update(data).digest('hex');

test('locked downloads verify SHA-256, reuse the offline cache, and preserve differing files',async t=>{
 const folder=await fs.mkdtemp(path.join(os.tmpdir(),'opentake-runtime-cache-'));t.after(()=>fs.rm(folder,{recursive:true,force:true}));
 const bytes=Buffer.from('locked archive'),item={url:'https://example.invalid/archive.zip',sha256:sha(bytes)};let calls=0;
 const fetcher=async()=>{calls++;return new Response(bytes)};
 const file=await lockedDownload(item,folder,fetcher);assert.deepEqual(await fs.readFile(file),bytes);
 await lockedDownload(item,folder,()=>{throw Error('offline')});assert.equal(calls,1);
 await fs.writeFile(file,'preserved old archive');await assert.rejects(lockedDownload(item,folder,fetcher),/Existing cache differs/);
 assert.equal(await fs.readFile(file,'utf8'),'preserved old archive');
 await assert.rejects(lockedDownload({...item,url:'http://example.invalid/archive.zip'},folder,fetcher),/Invalid locked/);
});

test('a failed archive checksum cannot become a usable cache entry',async t=>{
 const folder=await fs.mkdtemp(path.join(os.tmpdir(),'opentake-runtime-bad-'));t.after(()=>fs.rm(folder,{recursive:true,force:true}));
 await assert.rejects(lockedDownload({url:'https://example.invalid/bad.zip',sha256:sha('expected')},folder,async()=>new Response('different')),/SHA-256 differs/);
 await assert.rejects(fs.access(path.join(folder,'bad.zip')),{code:'ENOENT'});
 assert.ok((await fs.readdir(folder)).some(name=>name.endsWith('.download')));
});

test('archive member validation rejects traversal, absolute paths and links',()=>{
 for(const name of ['../outside','C:\\outside','/outside','folder/../../outside','folder/file:stream'])assert.throws(()=>safeArchivePaths('header\n----------\nPath = '+name+'\n'),/Unsafe/);
 assert.throws(()=>safeArchivePaths('header\n----------\nPath = link\nSymbolic Link = elsewhere\n'),/links/);
 assert.doesNotThrow(()=>safeArchivePaths('header\r\n----------\r\nPath = folder/file\r\n'));
});

test('runtime reuse rejects changed payload bytes and mismatched locked provenance',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'opentake-runtime-tree-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const lock={components:[{name:'fixture',version:'1',url:'https://example.invalid/a.zip',sha256:sha('archive')}]};
 await fs.writeFile(path.join(root,'provenance.json'),JSON.stringify(lock));await fs.writeFile(path.join(root,'tool.exe'),'tool');
 await fs.writeFile(path.join(root,'manifest.json'),JSON.stringify({schema:1,platform:'win32-x64',files:[{path:'tool.exe',bytes:4,sha256:sha('tool')}]}));
 assert.equal((await verifyRuntimeTree(root,lock)).files,1);
 await fs.writeFile(path.join(root,'tool.exe'),'edit');await assert.rejects(verifyRuntimeTree(root,lock),/file differs/);
 await fs.writeFile(path.join(root,'tool.exe'),'tool');await assert.rejects(verifyRuntimeTree(root,{components:[{...lock.components[0],version:'2'}]}),/provenance differs/);
});
