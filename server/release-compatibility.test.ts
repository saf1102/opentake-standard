import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import {videoEncodeArgs,runVideoEncode} from './editor/video-encode.ts';
import fixtures from './test-support/macos-1.1.0-encoding.json' with {type:'json'};
import type {ExportVideoSettings} from '../src/types/editor.ts';

test('macOS encoder arguments preserve the official 1.1.0 quality/codec/encoder contracts',()=>{
 for(const fixture of fixtures.cases)assert.deepEqual(videoEncodeArgs(fixture.video as ExportVideoSettings,fixture.canvas,'darwin'),fixture.args,JSON.stringify(fixture.video));
});

test('Windows MFT failure handling never introduces a retry or replaces a macOS encoder',async()=>{
 let calls=0;const failure=Error('Error while opening encoder');
 await assert.rejects(runVideoEncode({codec:'h264',container:'mp4',quality:'balanced',encoder:'auto'},{width:1920,height:1080},async args=>{calls++;assert.equal(args[1],'h264_videotoolbox');throw failure},'darwin'),error=>error===failure);
 assert.equal(calls,1);
});

test('a macOS host skips Windows native compilation before looking up toolchains or runtime files',()=>{
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'opentake-mac-native-skip-'));
 try{
  const shim=path.join(folder,'platform.cjs');fs.writeFileSync(shim,"Object.defineProperty(process,'platform',{value:'darwin'});\n");
  for(const name of ['build-windows-recording.mjs','build-windows-compositor.mjs']){
   const file=path.join(folder,name);fs.copyFileSync(fileURLToPath(new URL('../scripts/'+name,import.meta.url)),file);
   const result=execFileSync(process.execPath,['--require',shim,file],{encoding:'utf8',timeout:15000});
   assert.match(result,/当前平台无需构建/,name);
  }
  assert.equal(fs.existsSync(path.join(folder,'native')),false);assert.equal(fs.existsSync(path.join(folder,'.build')),false);
 }finally{fs.rmSync(folder,{recursive:true,force:true})}
});

test('macOS agent work retains system commands when a launcher has no inherited PATH',()=>{
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'opentake-mac-agent-path-'));
 try{
  const module=pathToFileURL(fileURLToPath(new URL('./general/kit-env.ts',import.meta.url))).href;
  const script=`Object.defineProperty(process,'platform',{value:'darwin'});const {prepareWork}=await import(${JSON.stringify(module)});const tool=process.execPath;const env=prepareWork(process.argv[1],{PATH:''},false,{python:tool,ffmpeg:tool,ffprobe:tool,chromium:tool,codex:tool});console.log(JSON.stringify({path:env.PATH,zdot:env.ZDOTDIR}));`;
  const result=JSON.parse(execFileSync(process.execPath,['--experimental-strip-types','--input-type=module','-e',script,folder],{encoding:'utf8',timeout:15000}));
  assert.ok(result.path.endsWith('/usr/bin:/bin:/usr/sbin:/sbin'));assert.equal(result.zdot,path.join(folder,'work/.opentake/zsh'));
 }finally{fs.rmSync(folder,{recursive:true,force:true})}
});
