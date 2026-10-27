import { describe, it, expect } from "vitest";
import { computeRegionStrength } from "./zoomRegionUtils";
import { computeZoomTransform } from "./zoomTransform";
import type { ZoomRegion } from "@/components/video-editor/types";
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
});
