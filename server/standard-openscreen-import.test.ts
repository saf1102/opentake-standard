import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createScreenProject, findProject, save} from './editor/store.ts';
import {createOpenScreenDocument, readOpenScreenDocument} from './editor/openscreen-documents.ts';

test('official v8 Auto handoff uses probed recording dimensions and preserves upstream input', () => {
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'standard-screen-import-'));
 const oldRoot=process.env.LINK_READER_PROJECTS_DIR;
 const oldSettings=process.env.LINKREADER_SYSTEM_SETTINGS_FILE;
 process.env.LINK_READER_PROJECTS_DIR=root;
 process.env.LINKREADER_SYSTEM_SETTINGS_FILE=path.join(root,'isolated-settings.json');
 try {
  const project=createScreenProject('Official GUI handoff');
  const found=findProject(project.id);
  found.project.media.push({id:'recording',name:'screen.mp4',type:'video',mimeType:'video/mp4',
   originalFile:'media/originals/recording.mp4',duration:15.020033,width:1086,height:714,fps:60,
   size:1143349,createdAt:Date.now(),status:'ready',origin:'screen-recording',parentAssetIds:[]} as any);
  save(found.dir,found.project);
  const raw={schemaVersion:8,project:{id:'native-gui',title:'Official recording'},
   assets:[{id:'recording',kind:'video',originalPath:'/api/editor/recording',durationSec:15.020033}],
   timeline:{clips:[{id:'clip',assetId:'recording',sourceStartSec:0,sourceEndSec:15.020033,
    timelineStartSec:0,timelineEndSec:15.020033}]},legacyEditor:{aspectRatio:'auto',padding:50},
   zoomRanges:[],audioTracks:[],shaderEffectRanges:[]};
  const before=structuredClone(raw);
  const created=createOpenScreenDocument(project.id,{document:raw});
  assert.deepEqual(raw,before);
  const reopened=readOpenScreenDocument(project.id,created.ref.id);
  assert.equal(reopened.document.schemaVersion,7);
  const assets=reopened.document.assets as any[];
  assert.deepEqual(assets[0].video,{width:1086,height:714,fps:60});
  const editor=reopened.document.legacyEditor as any;
  const aspect=.8*(1086/714)+.2;
  assert.ok(Math.abs(Number(editor.aspectRatio.split(':')[0])-aspect)<1e-12);
  assert.ok(Math.abs(editor.padding-50/aspect)<1e-12);
  assert.equal(created.ref.duration,15.020033);
  assert.throws(()=>createOpenScreenDocument(project.id,{document:{...raw,
   project:{id:'unknown-media',title:'Missing recording'},assets:[{...raw.assets[0],id:'unknown'}]}}),/缺少素材尺寸/);
  assert.throws(()=>createOpenScreenDocument(project.id,{document:{...raw,
   project:{id:'unsupported',title:'Unsupported effect'},shaderEffectRanges:[{id:'effect'}]}}),/尚不支持/);
 } finally {
  if(oldRoot===undefined)delete process.env.LINK_READER_PROJECTS_DIR;else process.env.LINK_READER_PROJECTS_DIR=oldRoot;
  if(oldSettings===undefined)delete process.env.LINKREADER_SYSTEM_SETTINGS_FILE;else process.env.LINKREADER_SYSTEM_SETTINGS_FILE=oldSettings;
  fs.rmSync(root,{recursive:true,force:true});
 }
});
