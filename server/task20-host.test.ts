import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { compatibleOpenScreenDocument as convert } from '../shared/openscreen-compat.ts';
import { supportedOpenScreenVersion, openScreenProfileArgs } from './editor/openscreen.ts';
import { uniqueRecordingFiles } from './editor/openscreen-host.ts';

const fixture = () => ({schemaVersion:8, project:{id:'doc',title:'录屏'}, assets:[{id:'a',kind:'video',video:{width:2054,height:2160}}], timeline:{clips:[{id:'c',assetId:'a',timelineStartSec:0,sourceStartSec:0,sourceEndSec:8.54}]},legacyEditor:{wallpaper:'linear-gradient(135deg, #6b7280, #16171d)'},zoomRanges:[],audioTracks:[],shaderEffectRanges:[]});

test('P09 基础 v8 转 v7 保留素材和时间线，冻结 Auto 几何且不修改原文档', () => {
  const raw=fixture(), before=structuredClone(raw), out=convert(raw);
  assert.deepEqual(raw,before); assert.equal(out.schemaVersion,7);
  assert.deepEqual(out.timeline,raw.timeline); assert.deepEqual(out.assets,raw.assets);
  const aspect=Number(out.legacyEditor.aspectRatio.split(':')[0]);
  assert.ok(Math.abs(aspect-(1/(.8*(2160/2054)+.2)))<1e-12);
  assert.ok(out.legacyEditor.padding<50); assert.deepEqual(convert(out),out);
  const fixed={...raw,legacyEditor:{aspectRatio:'16:9',padding:32}};
  assert.deepEqual(convert(fixed).legacyEditor,fixed.legacyEditor);
});

test('P09 不可无损转换的 v8 特性和未知版本明确拒绝', () => {
  for(const key of ['audioTracks','shaderEffects','shaderEffectRanges']) {
    assert.throws(()=>convert({...fixture(),[key]:[{id:'new'}]}),/尚不支持/);
    assert.throws(()=>convert({...fixture(),[key]:{id:'malformed'}}),/尚不支持/);
  }
  assert.throws(()=>convert({...fixture(),schemaVersion:9}),/不支持/);
  assert.throws(()=>convert({...fixture(),assets:[]}),/缺少素材尺寸/);
  assert.throws(()=>convert({...fixture(),assets:[{id:'sound',kind:'audio'}]}),/独立音频/);
  assert.throws(()=>convert({...fixture(),zoomRanges:[{rotationPreset:'orbit'}]}),/三维运镜/);
  assert.throws(()=>convert({...fixture(),annotations:[{space:'frame'}]}),/画布坐标/);
  assert.throws(()=>convert({...fixture(),annotations:{id:'bad'}}),/必须是列表/);
});

test('P10 录屏版本与部署 ≥2.1 一致，2.1.2 通过，旧版与未知版拒绝', () => {
  for(const v of ['2.1','2.1.2','2.2.0','10.0.0']) assert.equal(supportedOpenScreenVersion(v),true,v);
  for(const v of [undefined,'','1.10.0','2.0.9','unknown']) assert.equal(supportedOpenScreenVersion(v),false,String(v));
});

test('P11 录屏按 inode 去重，内容相同的不同文件仍分别保留', () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'task20-recording-'));
  try {
    const source=path.join(root,'source'),hard=path.join(root,'hard'),link=path.join(root,'link'),other=path.join(root,'other');
    fs.writeFileSync(source,'same'); fs.linkSync(source,hard); fs.symlinkSync(source,link); fs.writeFileSync(other,'same');
    assert.deepEqual(uniqueRecordingFiles([source,hard,link,source,other,path.join(root,'missing')]),[source,other]);
    assert.throws(()=>openScreenProfileArgs({OPENSCREEN_USER_DATA_DIR:'relative'}),/绝对路径/);
  } finally { fs.rmSync(root,{recursive:true,force:true}); }
});

test('P11 实际检测路径、工程隔离 profile、启动失败落盘与取消保护', async () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'task20-host-'));
  const previous=process.env.OPENSCREEN_USER_DATA_DIR;
  process.env.OPENSCREEN_USER_DATA_DIR=path.join(root,'profiles');
  try {
    // Only process launch and project discovery are faked; session persistence,
    // failure transitions and profile selection execute the production module.
    const built=await build({entryPoints:['server/editor/openscreen-host.ts'],bundle:true,write:false,format:'cjs',platform:'node',packages:'external',plugins:[{name:'host-boundaries',setup(b){
      // Standard's platform adapter uses import.meta.url to locate its real CJS
      // implementation. Keep that module native; bundling it as CJS erases the URL.
      b.onResolve({filter:/^\.\.\/platform\.ts$/},args=>({path:path.resolve(path.dirname(args.importer),args.path),external:true}));
      b.onResolve({filter:/^node:child_process$/},()=>({path:'spawn',namespace:'fixture'}));
      b.onResolve({filter:/^\.\/store\.ts$/},()=>({path:'store',namespace:'fixture'}));
      b.onResolve({filter:/^\.\/media\.ts$/},()=>({path:'media',namespace:'fixture'}));
      b.onResolve({filter:/^\.\/openscreen-documents\.ts$/},()=>({path:'documents',namespace:'fixture'}));
      b.onResolve({filter:/^\.\/openscreen-capture\.ts$/},()=>({path:'capture',namespace:'fixture'}));
      b.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:args.path==='spawn' ? `import {EventEmitter} from 'node:events'; export let calls=[]; export let child; export function spawn(command,args,options){child=new EventEmitter();child.unref=()=>{};calls.push({command,args,options,child});return child;} export const spawnSync=()=>({status:0,stdout:'2.1.2'});` : args.path==='store' ? `import fs from 'node:fs';import path from 'node:path'; export const findProject=(id)=>({dir:path.join(${JSON.stringify(root)},id),project:{}}); export const atomicJson=(file,value)=>{fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(value));}; export const save=()=>{};` : args.path==='media' ? 'export const processMedia=async()=>{};' : args.path==='documents' ? 'export const createOpenScreenDocument=()=>{};' : 'export const activeCaptureJobs=()=>0;'}));
    }}],stdin:undefined});
    // Expose the injected process boundary alongside the actual host exports.
    const source=built.outputFiles[0].text.replace(/var calls = \[\];/, 'var calls = []; globalThis.__task20Calls = calls;');
    const mod={exports:{} as any}; new Function('require','module','exports',source)(createRequire(import.meta.url),mod,mod.exports);
    const api=mod.exports;
    const executable=path.join(root,'Detected OpenScreen.app','Contents','MacOS','Openscreen');
    fs.mkdirSync(path.dirname(executable),{recursive:true});fs.writeFileSync(executable,'#!/bin/sh\nexit 0\n');fs.chmodSync(executable,0o755);
    const oldBin=process.env.OPENSCREEN_BIN,oldNode=process.env.ELECTRON_RUN_AS_NODE;
    process.env.OPENSCREEN_BIN=executable;process.env.ELECTRON_RUN_AS_NODE='1';
    try {
      const a=api.launchOpenScreenHud('a'), b=api.launchOpenScreenHud('b');
      const calls=(globalThis as any).__task20Calls;
      assert.equal(calls.length,2);
      assert.deepEqual(calls[0].args,process.platform==='darwin' ? ['-n','-a',fs.realpathSync(path.join(root,'Detected OpenScreen.app')),'--args',`--user-data-dir=${path.join(root,'profiles','a')}`] : [`--user-data-dir=${path.join(root,'profiles','a')}`]);
      assert.equal(calls[0].options.env.ELECTRON_RUN_AS_NODE,undefined);
      assert.notEqual(api.openScreenProjectProfile('a'),api.openScreenProjectProfile('b'));
      calls[0].child.emit('spawn');calls[0].child.emit('close',7);
      assert.equal(api.readOpenScreenHostSession('a',a.id).status,'failed');
      assert.match(api.readOpenScreenHostSession('a',a.id).error,/启动失败（7）/);
      calls[1].child.emit('error',new Error('ENOENT injected'));
      assert.equal(api.readOpenScreenHostSession('b',b.id).status,'failed');
      const cancelled=api.launchOpenScreenHud('cancelled');
      api.cancelOpenScreenHostSession('cancelled',cancelled.id);
      calls[2].child.emit('spawn');calls[2].child.emit('close',7);calls[2].child.emit('error',new Error('late error'));
      assert.equal(api.readOpenScreenHostSession('cancelled',cancelled.id).status,'cancelled');
    } finally {
      if(oldBin===undefined)delete process.env.OPENSCREEN_BIN;else process.env.OPENSCREEN_BIN=oldBin;
      if(oldNode===undefined)delete process.env.ELECTRON_RUN_AS_NODE;else process.env.ELECTRON_RUN_AS_NODE=oldNode;
      delete (globalThis as any).__task20Calls;
    }
  } finally {if(previous===undefined)delete process.env.OPENSCREEN_USER_DATA_DIR;else process.env.OPENSCREEN_USER_DATA_DIR=previous;fs.rmSync(root,{recursive:true,force:true});}
});

test('P09 文档保存往返：保留 v8 原件、写入 v7、revision 备份和 HTTP 素材路径', async () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'task20-documents-'));
  try {
    const project={id:'p',revision:0,sourceTranscripts:[],media:[{id:'a'}],timeline:{tracks:[]},openScreenDocuments:[]};
    const built=await build({entryPoints:['server/editor/openscreen-documents.ts'],bundle:true,write:false,format:'cjs',platform:'node',packages:'external',plugins:[{name:'document-project-boundary',setup(b){
      b.onResolve({filter:/^\.\/store\.ts$/},()=>({path:'store',namespace:'fixture'}));
      b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:`import fs from 'node:fs'; import path from 'node:path'; const project=${JSON.stringify(project)}; export const findProject=()=>({dir:${JSON.stringify(root)},project}); export const atomicJson=(file,value)=>{fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(value));}; export const save=()=>{};`}));
    }}]});
    const mod={exports:{} as any};new Function('require','module','exports',built.outputFiles[0].text)(createRequire(import.meta.url),mod,mod.exports);
    const api=mod.exports,raw=fixture();
    const created=api.createOpenScreenDocument('p',{document:raw});
    assert.equal(created.document.schemaVersion,7);
    const folder=path.join(root,'analysis','openscreen','doc');
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(folder,'native-source.openscreen'),'utf8')),raw);
    const current=api.readOpenScreenDocument('p','doc');
    assert.equal(current.document.assets[0].originalPath,'/api/editor/projects/p/media/a/file?kind=original');
    current.document.project.title='编辑后';
    const saved=api.saveOpenScreenDocument('p','doc',{document:current.document,revision:0});
    assert.equal(saved.revision,1);
    assert.equal(JSON.parse(fs.readFileSync(path.join(folder,'backups','revision-0.openscreen'),'utf8')).project.title,'录屏');
    assert.throws(()=>api.saveOpenScreenDocument('p','doc',{document:raw,revision:0}),/其他位置更新/);
    assert.throws(()=>api.createOpenScreenDocument('p',{document:{...raw,shaderEffects:[{id:'effect'}]},documentId:'unsupported'}),/尚不支持/);
    assert.equal(fs.existsSync(path.join(root,'analysis','openscreen','unsupported')),false);
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});
