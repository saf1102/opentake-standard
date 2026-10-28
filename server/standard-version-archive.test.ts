import {resolvePython,pythonCandidates} from './general/python-runtime.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {quarantineSoftware} from './general/net-guard.ts';
test('only byte-matched saved version archives survive the software guard',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'version-guard-'));
 try{
  const work=path.join(root,'work'),snapshot=path.join(root,'versions/v1/work');fs.mkdirSync(path.join(work,'versions'),{recursive:true});fs.mkdirSync(snapshot,{recursive:true});fs.writeFileSync(path.join(snapshot,'index.html'),'<p>saved version</p>');
  const zip=(name:string,body:string,entry='index.html')=>execFileSync(resolvePython(),['-c','import zipfile,sys\nwith zipfile.ZipFile(sys.argv[1],"w") as z:z.writestr(sys.argv[3],sys.argv[2])',path.join(work,name),body,entry]);
  zip('versions/v1.zip','<p>saved version</p>');zip('versions/v2.zip','<p>saved version</p>');zip('download.zip','<p>saved version</p>');
  assert.deepEqual(quarantineSoftware(work,path.join(root,'blocked')).sort(),['download.zip','versions/v2.zip']);
  assert.ok(fs.existsSync(path.join(work,'versions/v1.zip')));
  zip('versions/v1.zip','changed content');assert.deepEqual(quarantineSoftware(work,path.join(root,'blocked2')),['versions/v1.zip']);
  zip('versions/v1.zip','<p>saved version</p>','../index.html');assert.deepEqual(quarantineSoftware(work,path.join(root,'blocked3')),['versions/v1.zip']);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('Windows Python discovery supports python.exe without python3',()=>{
 assert.deepEqual(pythonCandidates('win32',{Path:'C:\\Python;C:\\Tools'}),['C:\\Python\\python3.exe','C:\\Python\\python.exe','C:\\Tools\\python3.exe','C:\\Tools\\python.exe']);
});
test('missing interpreter preserves version ZIP instead of quarantining it',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'version-no-python-'));const old=process.env.LINKREADER_PYTHON;
 try{const work=path.join(root,'work');fs.mkdirSync(path.join(work,'versions'),{recursive:true});fs.writeFileSync(path.join(work,'versions/v1.zip'),'PK fake fixture');process.env.LINKREADER_PYTHON=path.join(root,'missing');
 assert.throws(()=>quarantineSoftware(work,path.join(root,'blocked')),/Python/);assert.ok(fs.existsSync(path.join(work,'versions/v1.zip')));
 }finally{if(old===undefined)delete process.env.LINKREADER_PYTHON;else process.env.LINKREADER_PYTHON=old;fs.rmSync(root,{recursive:true,force:true});}
});
