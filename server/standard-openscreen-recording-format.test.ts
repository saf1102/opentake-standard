import test from 'node:test';
import assert from 'node:assert/strict';
import {recordingDocument} from '../shared/openscreen-recording.ts';
import {compatibleOpenScreenDocument} from '../shared/openscreen-compat.ts';
const metadata={duration:15.016,width:1086,height:714,fps:60};
const options={id:'proj_fixture',title:'真实录制',createdAt:'2026-10-29T00:00:00.000Z'};
const recording=()=>({version:2,media:{screenVideoPath:'C:\\QA\\中文 录制.mp4',cursorCaptureMode:'editable-overlay'},
 editor:{aspectRatio:'auto',padding:50,cursorTheme:'default',autoZoomEnabled:true,zoomRegions:[],trimRegions:[],speedRegions:[],annotationRegions:[],cameraFullscreenRegions:[]}});
test('official v2 CLI envelope becomes a full-duration document without changing the upstream file',()=>{
 const raw=recording(),snapshot=structuredClone(raw),doc=recordingDocument(raw,metadata,options);
 assert.deepEqual(raw,snapshot);assert.equal(doc.schemaVersion,8);assert.equal(doc.assets[0].originalPath,raw.media.screenVideoPath);
 assert.equal(doc.timeline.clips[0].sourceEndSec,15.016);assert.equal(doc.timeline.clips[0].timelineEndSec,15.016);
 const editor=compatibleOpenScreenDocument(doc);assert.equal(editor.schemaVersion,7);assert.notEqual(editor.legacyEditor.aspectRatio,'auto');
 assert.equal(editor.legacyEditor.cursorTheme,'default');
});
test('CLI recording zoom retains source timing, focus mode and focus through document import',()=>{
 const raw=recording() as any;raw.editor.zoomRegions=[{id:'zoom_click',startMs:3200,endMs:5200,depth:3,focus:{cx:.8,cy:.4},focusMode:'auto'}];
 const doc=recordingDocument(raw,metadata,options),zoom=doc.zoomRanges[0];
 assert.equal(zoom.clipId,doc.timeline.clips[0].id);assert.equal(zoom.sourceStartSec,3.2);assert.equal(zoom.sourceEndSec,5.2);
 assert.deepEqual(zoom.focus,{cx:.8,cy:.4});assert.equal(zoom.focusMode,'auto');assert.equal(compatibleOpenScreenDocument(doc).zoomRanges[0].startMs,3200);
});
test('unknown or edited CLI envelopes and invalid media metadata fail instead of discarding changes',()=>{
 assert.throws(()=>recordingDocument({...recording(),version:3},metadata,options),/不支持/);
 const edited=recording() as any;edited.editor.trimRegions=[{startMs:1,endMs:2}];
 assert.throws(()=>recordingDocument(edited,metadata,options),/trimRegions/);
 assert.throws(()=>recordingDocument(recording(),{...metadata,duration:NaN},options),/真实时长/);
});
