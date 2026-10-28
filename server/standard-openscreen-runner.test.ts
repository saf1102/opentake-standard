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


test('recording candidates deduplicate filesystem aliases without collapsing distinct files',async()=>{
 const {uniqueRecordingFiles}=await import('./editor/openscreen-host.ts');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'standard-recording-alias-'));
 try {
  const source=path.join(root,'source.openscreen'),alias=path.join(root,'alias.openscreen'),link=path.join(root,'link.openscreen'),other=path.join(root,'other.openscreen');
  fs.writeFileSync(source,'same content');fs.linkSync(source,alias);fs.symlinkSync(source,link);fs.writeFileSync(other,'same content');
  assert.deepEqual(uniqueRecordingFiles([source,alias,link,source,other,path.join(root,'missing')]),[source,other]);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});


test('isolated OpenScreen profile requires an absolute path and passes it to native launches', async()=>{
 const {openScreenProfile,openScreenProfileArgs}=await import('./editor/openscreen.ts');
 assert.equal(openScreenProfile({}),undefined);
 assert.deepEqual(openScreenProfileArgs({}),[]);
 assert.throws(()=>openScreenProfile({OPENSCREEN_USER_DATA_DIR:'relative'}),/绝对路径/);
 assert.deepEqual(openScreenProfileArgs({OPENSCREEN_USER_DATA_DIR:'/tmp/isolated screen'}),['--user-data-dir=/tmp/isolated screen']);
});

test('cursor sidecar accompanies staged video without mutating original media',async()=>{
 const {stageCursorSidecars}=await import('./editor/openscreen-export.ts');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'screen-cursor-'));
 try {
  const video=path.join(root,'original.mp4'),cursor=path.join(root,'cursor.json'),stage=path.join(root,'stage');fs.mkdirSync(stage);fs.writeFileSync(video,'video');fs.writeFileSync(cursor,'{"samples":[]}');
  const project={media:[{id:'a',capture:{cursorDataFile:'cursor.json'}}]} as any;
  const doc={assets:[{id:'a',originalPath:video}]};
  const staged=stageCursorSidecars(doc,project,root,stage) as any;
  assert.equal(doc.assets[0].originalPath,video);assert.equal(fs.existsSync(video+'.cursor.json'),false);
  assert.equal(fs.readFileSync(staged.assets[0].originalPath+'.cursor.json','utf8'),fs.readFileSync(cursor,'utf8'));
  assert.equal(fs.readFileSync(staged.assets[0].originalPath,'utf8'),'video');
  fs.unlinkSync(cursor);assert.throws(()=>stageCursorSidecars(doc,project,root,stage),/鼠标数据缺失/);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
