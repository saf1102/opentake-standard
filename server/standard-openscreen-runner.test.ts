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
 assert.deepEqual(mp4ExportArguments(30,'hevc'),['--fps','30']);
 assert.throws(()=>mp4ExportArguments(30,'unknown'),/编码无效/);
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

test('跟工程与显式帧率在原生渲染、统一编码中一致，不继承中间成片平均帧率',async()=>{
 const {build}=await import('esbuild');const {createRequire}=await import('node:module');
 const require=createRequire(import.meta.url);
 const built=await build({entryPoints:['server/editor/openscreen-export.ts'],bundle:true,write:false,format:'cjs',platform:'node',packages:'external',plugins:[{name:'capture-final-encoding',setup(b){
  b.onResolve({filter:/^node:child_process$/},a=>a.importer.endsWith('openscreen-encode.ts')?{path:'capture',namespace:'encode'}:undefined);
  b.onLoad({filter:/.*/,namespace:'encode'},()=>({contents:`export function execFile(...args){globalThis.__task20ClockArgs=args[1];args.at(-1)(null,'','');}`}));
  b.onResolve({filter:/general\/export-media\.ts$/},()=>({path:'media',namespace:'probe'}));
  b.onLoad({filter:/.*/,namespace:'probe'},()=>({contents:`export const probeExportMedia=async()=>({width:1920,height:1080,fps:4500/149});`}));
  b.onResolve({filter:/^\.\.\//},a=>({path:path.resolve(path.dirname(a.importer),a.path),external:true}));
 }}]});
 const mod={exports:{} as any};new Function('require','module','exports',built.outputFiles[0].text)(require,mod,mod.exports);
 const {exportSettingsForPreset}=await import('../src/studio/export-settings.ts');
 const doc={project:{primaryAssetId:'v'},assets:[{id:'v',video:{fps:30}}]};
 for(const selected of [undefined,'project',24,60])for(const codec of ['h264','h265','prores422']){
  const settings={...exportSettingsForPreset('quick'),...(selected===undefined?{}:{fps:selected}),video:{codec,container:codec==='prores422'?'mov':'mp4',quality:'fast',encoder:'auto'}};
  const before=structuredClone(settings),fps=mod.exports.screenExportFrameRate(settings,30,doc);
  assert.equal(fps,typeof selected==='number'?selected:30);
  assert.deepEqual(mod.exports.mp4ExportArguments(fps,'h264'),['--fps',String(fps)]);
  await mod.exports.encodeScreenExportMedia('native.mp4','final',settings,fps,5);
  const argv=(globalThis as any).__task20ClockArgs;
  assert.equal(argv[argv.indexOf('-r')+1],String(fps));assert.equal(argv[argv.indexOf('-fps_mode')+1],'cfr');
  assert.equal(argv[argv.indexOf('-frames:v')+1],String(fps*5));assert.equal(argv[argv.indexOf('-t')+1],'5');
  assert.ok(argv[argv.indexOf('-vf')+1].includes(`fps=${fps}:`));
  delete (globalThis as any).__task20ClockArgs;
  assert.deepEqual(settings,before,'不把解析后的数字写回用户的跟工程偏好');
 }
 assert.equal(mod.exports.screenExportFrameRate(undefined,undefined,doc),30);
 assert.equal(mod.exports.screenExportFrameRate(undefined,24,doc),24);
 assert.throws(()=>mod.exports.screenExportFrameRate(undefined,-1,doc),/帧率/);
});

test('原生原片尺寸遵循保存 Format：2640×1800 素材的 16:9 为 2624×1476',async()=>{
 const {build}=await import('esbuild');const {createRequire}=await import('node:module');
 const built=await build({stdin:{contents:"export {calculateMp4ExportSettings} from './vendor/openscreen/src/lib/exporter/mp4ExportSettings';",resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,format:'cjs',platform:'node'});
 const mod={exports:{} as any};new Function('require','module','exports',built.outputFiles[0].text)(createRequire(import.meta.url),mod,mod.exports);
 const dims=mod.exports.calculateMp4ExportSettings({quality:'source',sourceWidth:2640,sourceHeight:1800,aspectRatioValue:16/9});
 assert.equal(dims.width,2624);assert.equal(dims.height,1476);
});
