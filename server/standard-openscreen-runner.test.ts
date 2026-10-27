import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {resolveOpenScreenExportRunner} from './editor/openscreen-export.ts';

test('export uses installed OpenScreen process for v7 and legacy; never mixes native addons',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'standard-installed-screen-'));
 const old=process.env.ELECTRON_RUN_AS_NODE;
 try {
  const executable=path.join(root,'openscreen');
  const lookup={env:{PATH:'',OPENSCREEN_BIN:executable},home:root,binDirs:[],applicationDirs:[]};
  assert.throws(()=>resolveOpenScreenExportRunner({schemaVersion:7},lookup),/未检测到用户安装/);
  fs.writeFileSync(executable,'#!/bin/sh\nexit 0\n');fs.chmodSync(executable,0o644);
  assert.throws(()=>resolveOpenScreenExportRunner({schemaVersion:7},lookup),/未检测到用户安装/);
  fs.chmodSync(executable,0o755);process.env.ELECTRON_RUN_AS_NODE='1';
  for(const schemaVersion of [6,7]){
   const runner=resolveOpenScreenExportRunner({schemaVersion},lookup);
   assert.equal(runner.executable,executable);assert.deepEqual(runner.argsPrefix,['export']);
   assert.equal(runner.kind,'installed-native');assert.equal(runner.env.ELECTRON_RUN_AS_NODE,undefined);
   assert.equal(runner.env.OPENSCREEN_COMPOSITOR_VIEW_NODE,undefined);
  }
 } finally {if(old===undefined)delete process.env.ELECTRON_RUN_AS_NODE;else process.env.ELECTRON_RUN_AS_NODE=old;fs.rmSync(root,{recursive:true,force:true});}
});

test('external export preserves selected fps and refuses unsupported codec',async()=>{
 const {mp4ExportArguments}=await import('./editor/openscreen-export.ts');
 for(const fps of [24,30,60])assert.deepEqual(mp4ExportArguments(fps,'h264'),['--fps',String(fps)]);
 assert.deepEqual(mp4ExportArguments(undefined,undefined),['--fps','30']);
 assert.throws(()=>mp4ExportArguments(29,'h264'),/帧率/);
 assert.throws(()=>mp4ExportArguments(30,'hevc'),/H.264/);
});

test('external export freezes preview defaults and wallpaper without mutating source',async()=>{
 const {stageEditorSettings}=await import('./editor/openscreen-export.ts');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'standard-screen-wallpaper-'));
 try {
  const folder=path.join(root,'public/openscreen/wallpapers');fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(path.join(folder,'wallpaper1.jpg'),'test');
  const doc={schemaVersion:7,legacyEditor:null,zoomRanges:[{depth:3}]};
  const staged=stageEditorSettings(doc,{wallpaper:'/wallpapers/wallpaper1.jpg',padding:50,borderRadius:40},root);
  assert.deepEqual(staged.legacyEditor,{wallpaper:path.join(folder,'wallpaper1.jpg'),padding:50,borderRadius:40});
  assert.deepEqual(staged.zoomRanges,doc.zoomRanges);assert.equal(doc.legacyEditor,null);
  assert.throws(()=>stageEditorSettings(doc,{wallpaper:'/wallpapers/wallpaper2.jpg'},root),/背景资源缺失/);
 }
 finally{fs.rmSync(root,{recursive:true,force:true});}
});
