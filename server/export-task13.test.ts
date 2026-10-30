import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {ExportSettingsSchema} from '../src/types/editor.ts';
import {exportSettingsForPreset,createExportDialogSettings,updateExportDialogSettings,switchExportDialogPreset,exportDialogSubmission,exportDialogPreferences} from '../src/studio/export-settings.ts';
import {readExportPreferences,writeExportPreferences} from './export-preferences.ts';
import {videoEncodeArgs} from './editor/video-encode.ts';
import {exportResolution} from './editor/export-resolution.ts';

test('旧口播 quick 默认保留原分辨率、原时钟、H264 和原音频交付选择',()=>{
 const settings=exportSettingsForPreset('quick');
 assert.equal(settings.fps,undefined);assert.equal(settings.resolution,'original');
 assert.deepEqual(settings.video,{container:'mp4',codec:'h264',quality:'fast',encoder:'auto'});
 assert.equal(settings.audioFormat,'aac');assert.equal(settings.selection.mixedVideo,true);assert.equal(settings.selection.subtitleSrt,true);
 assert.deepEqual(videoEncodeArgs(settings.video,{width:1920,height:1080,fps:30}),['-c:v','h264_videotoolbox','-b:v','6000000','-maxrate','6000000','-bufsize','12000000','-g','60','-prio_speed','1','-profile:v','high','-pix_fmt','yuv420p']);
 const old=ExportSettingsSchema.parse({...settings,video:{container:'mov',codec:'prores422',quality:'high',encoder:'software'}});
 assert.equal(old.video.codec,'prores422');assert.equal(old.fps,undefined);
});

test('导出偏好按工程持久保存，读坏数据不覆盖成空设置',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'task13-prefs-'));
 try {
  const a=path.join(root,'a'),b=path.join(root,'b');
  assert.equal(readExportPreferences(a),null);
  const value={...exportSettingsForPreset('quick'),fps:60 as const,resolution:'720p' as const,video:{container:'mov' as const,codec:'prores422' as const,quality:'fast' as const,encoder:'auto' as const}};
  writeExportPreferences(a,value);assert.deepEqual(readExportPreferences(a),value);assert.equal(readExportPreferences(b),null);
  const file=path.join(a,'exports','.preferences.json');fs.writeFileSync(file,'broken');assert.throws(()=>readExportPreferences(a));assert.equal(fs.readFileSync(file,'utf8'),'broken');
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('三组选项的参数契约与纵横画幅上限',()=>{
 for(const resolution of ['original','4k','1080p','720p'] as const)for(const codec of ['h264','h265','prores422'] as const)for(const fps of ['project',24,60] as const) {
  const s=ExportSettingsSchema.parse({...exportSettingsForPreset('quick'),resolution,fps,video:{codec,container:codec==='prores422'?'mov':'mp4'}});
  const size=exportResolution({width:1080,height:1920},s.resolution);assert.ok(size.width<=1080&&size.height<=1920);assert.equal(size.width/size.height,9/16);
  const args=videoEncodeArgs(s.video,{...size,fps:typeof s.fps==='number'?s.fps:30});assert.equal(args[1],codec==='prores422'?'prores_ks':codec==='h265'?'hevc_videotoolbox':'h264_videotoolbox');
 }
 for(const fps of [0,25,'60',120])assert.equal(ExportSettingsSchema.safeParse({fps}).success,false);
});

test('成片切换到其他方式逐字段恢复原预设，返回成片保留三组选项',()=>{
 for(const preset of ['jianying','standard','motion','archive'] as const)for(const filmPreset of ['quick','custom'] as const) {
  const initial=exportSettingsForPreset(filmPreset);
  let state=createExportDialogSettings(initial);
  assert.deepEqual(exportDialogSubmission(switchExportDialogPreset(state,preset)),exportSettingsForPreset(preset,initial));
  const selected={...initial,resolution:'720p' as const,fps:60 as const,video:{...initial.video,codec:'prores422' as const,container:'mov' as const}};
  state=updateExportDialogSettings(state,selected);
  const draft=switchExportDialogPreset(state,preset);
  const submitted=exportDialogSubmission(draft);
  assert.deepEqual(submitted,exportSettingsForPreset(preset,selected));
  assert.equal(Object.hasOwn(submitted,'fps'),false);
  assert.deepEqual(exportDialogPreferences(draft),selected);
  assert.deepEqual(exportDialogSubmission(switchExportDialogPreset(draft,filmPreset)),selected);
 }
});

test('剪映提交不覆盖工程成片偏好，旧非成片偏好不再被当成成片选择',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'task13-film-prefs-'));
 try {
  const selected={...exportSettingsForPreset('quick'),fps:60 as const,video:{container:'mov' as const,codec:'prores422' as const,quality:'fast' as const,encoder:'auto' as const}};
  const state=switchExportDialogPreset(createExportDialogSettings(selected),'jianying');
  writeExportPreferences(root,exportDialogPreferences(state));
  const file=path.join(root,'exports','.preferences.json'),before=fs.readFileSync(file,'utf8');
  // 通用剪辑/录屏的后端在启动草稿任务时仍可能尝试保存该任务。
  writeExportPreferences(root,exportDialogSubmission(state));
  assert.equal(fs.readFileSync(file,'utf8'),before);
  assert.deepEqual(readExportPreferences(root),selected);
  const empty=path.join(root,'empty');writeExportPreferences(empty,exportDialogSubmission(state));
  assert.equal(fs.existsSync(path.join(empty,'exports','.preferences.json')),false);
  const legacy={...exportSettingsForPreset('jianying'),video:selected.video,fps:60};
  fs.writeFileSync(file,JSON.stringify(legacy));
  assert.equal(readExportPreferences(root),null);
  assert.deepEqual(exportDialogSubmission(createExportDialogSettings(ExportSettingsSchema.parse(legacy))),exportSettingsForPreset('jianying',legacy));
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
