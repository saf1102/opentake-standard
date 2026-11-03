import { describe, it, expect } from "vitest";
import { computeRegionStrength } from "./zoomRegionUtils";
import { computeZoomTransform } from "./zoomTransform";
import type { ZoomRegion } from "@/components/video-editor/types";
import { browserCursorFocusAt, computeBrowserZoomPreviewTransform, computeZoomPreviewTransform } from "@/lib/ai-edition/timeline/zoom-preview";
import { screenPreviewRect } from "../../../../../shared/openscreen-preview-geometry";
import { createBrowserCameraTrack } from "@/lib/cursor/browserCameraFollow";
const region: ZoomRegion = {id:"zoom",startMs:2504,endMs:3508,depth:3,focus:{cx:0.5,cy:0.5}};
describe("installed OpenScreen 2.1.2 camera parity", () => {
 it("starts at the scale-dependent lead-in and holds exactly over the region", () => {
  const window = 600 + 550 * Math.log(1.8);
  expect(computeRegionStrength(region,2504-window-1)).toBe(0);
  expect(computeRegionStrength(region,1600)).toBeLessThan(0.011);
  expect(computeRegionStrength(region,2504)).toBe(1);
  expect(computeRegionStrength(region,3508)).toBe(1);
  expect(computeRegionStrength(region,3508+window+1)).toBe(0);
  expect(computeRegionStrength(region,2504-window/2)).toBeCloseTo(0.8704618422447373,6);
 });
 it("scales transition duration with playback rate", () => {
  expect(computeRegionStrength(region,2000,2)).toBeCloseTo(computeRegionStrength(region,2252,1),10);
 });
 it("interpolates scale exponentially while preserving focus and identity", () => {
  const input = {stageSize:{width:1920,height:1080},baseMask:{x:0,y:0,width:1920,height:1080},zoomScale:1.8,focusX:0.3,focusY:0.7};
  expect(computeZoomTransform({...input,zoomProgress:0})).toEqual({scale:1,x:0,y:0});
  const mid=computeZoomTransform({...input,zoomProgress:0.5});
  expect(mid.scale).toBeCloseTo(Math.sqrt(1.8),10);
  const end=computeZoomTransform({...input,zoomProgress:1});
  expect(end.x+1920*0.3*end.scale).toBeCloseTo(960);
  expect(end.y+1080*0.7*end.scale).toBeCloseTo(540);
 });
 it("global Auto-Focus follows the pointer in the padded screen rather than the full canvas", () => {
  const canvas={width:1000,height:800},screen={x:100,y:80,width:800,height:640};
  const options={autoFocusAll:true,cursorFocus:{cx:0.95,cy:0.95},crop:{x:0,y:0,width:1,height:1},screen,canvas,sourceSize:{width:1920,height:1080}};
  const zoom=computeBrowserZoomPreviewTransform([region as any],3000,options);
  const rect=screenPreviewRect(screen,canvas,zoom);
  expect(rect.width).toBeCloseTo(1440);
  expect(rect.x+rect.width).toBeCloseTo(900);
  expect(rect.y+rect.height).toBeCloseTo(720);
  const manual=computeBrowserZoomPreviewTransform([region as any],3000,{...options,autoFocusAll:false});
  expect(manual).toEqual(computeZoomPreviewTransform([region as any],3000));
  expect(computeBrowserZoomPreviewTransform([{...region,focusMode:'auto'} as any],3000,{...options,autoFocusAll:false})).toEqual(zoom);
  expect(computeBrowserZoomPreviewTransform([region as any],3000,{...options,cursorFocus:null})).toEqual(manual);
 });
 it("applies the installed renderer's source-resolution cap independently of preview size", () => {
  const options={autoFocusAll:false,cursorFocus:null,crop:{x:0,y:0,width:1,height:1},
   screen:{x:108,y:108,width:1314,height:864},canvas:{width:1530,height:1080},sourceSize:{width:1086,height:714}};
  expect(computeBrowserZoomPreviewTransform([region as any],3000,options).scale).toBe(1.65);
  const smaller={...options,screen:{x:36,y:36,width:438,height:288},canvas:{width:510,height:360}};
  expect(computeBrowserZoomPreviewTransform([region as any],3000,smaller).scale).toBe(1.65);
  expect(computeBrowserZoomPreviewTransform([region as any],3000,{...smaller,
   screen:{x:35,y:35,width:439,height:288},reference:{screen:options.screen,canvas:options.canvas}}).scale).toBe(1.65);
  expect(computeBrowserZoomPreviewTransform([region as any],3000,{...options,crop:{x:0,y:0,width:0.5,height:0.5}}).scale).toBe(1);
 });
 it("samples the active recording in source time after a trim, without reusing another asset", () => {
  const clips=[{id:'trim',assetId:'second',sourceStartSec:8,sourceEndSec:10,timelineStartSec:0,timelineEndSec:2}] as any;
  let sampled=-1;
  const path={sampleAt:(time:number)=>{sampled=time;return {cx:0.75,cy:0.25};}};
  expect(browserCursorFocusAt(clips,'second',1000,path)).toEqual({cx:0.75,cy:0.25});
  expect(sampled).toBe(9000);
  expect(browserCursorFocusAt(clips,'first',1000,path)).toBeNull();
 });
 it("holds the camera inside its dead zone and eases toward a large cursor movement", () => {
  const recording=(position:(t:number)=>number)=>({version:2,provider:'native',assets:[],samples:
   Array.from({length:301},(_,i)=>({timeMs:i*1000/30,cx:position(i/30),cy:0.5}))} as any);
  const jitter=createBrowserCameraTrack(recording(t=>0.5+0.08*Math.sin(t*7)),null,0)!;
  for(let i=0;i<=90;i++) expect(jitter.focusAt(0,i*100,9000,2)?.cx).toBeCloseTo(0.5,6);
  const jump=createBrowserCameraTrack(recording(t=>t<2?0.5:0.8),null,0)!;
  const settled=jump.focusAt(0,9000,9000,2)!.cx, early=jump.focusAt(0,2100,9000,2)!.cx;
  expect(settled).toBeCloseTo(0.675,3);
  expect(early).toBeGreaterThan(0.5);
  expect(early).toBeLessThan(settled);
  expect(jump.focusAt(0,2100,9000,2)?.cx).toBe(early);
 });
 it("replays the same camera after out-of-order seeks and stops at the region boundary", () => {
  const recording={version:2,provider:'native',assets:[],samples:Array.from({length:151},(_,i)=>({
   timeMs:i*1000/30,cx:0.5+0.3*Math.sin(i/30*1.3),cy:0.5+0.2*Math.cos(i/30*0.7)}))} as any;
  const track=createBrowserCameraTrack(recording,null,0)!;
  const times=[4900,200,3300,0,2710,4000];
  for(const time of times) track.focusAt(400,time,5000,2);
  for(const time of times) expect(track.focusAt(400,time,5000,2)).toEqual(createBrowserCameraTrack(recording,null,0)!.focusAt(400,time,5000,2));
  expect(track.focusAt(400,9000,5000,2)).toEqual(track.focusAt(400,5000,5000,2));
 });
});
