type ObjectValue = Record<string, any>;
const object=(value:unknown):value is ObjectValue=>Boolean(value&&typeof value==='object'&&!Array.isArray(value));

/** Official 2.1.2 `record --project` writes the v2 recording envelope, whereas
 * the GUI saves document v8. Convert only a fresh recording; keep the original
 * file and reject edited/unknown envelopes rather than dropping edits. */
export function recordingDocument(input:unknown, metadata:{duration:number;width:number;height:number;fps:number},
 options:{id:string;title:string;createdAt:string}) {
 if(!object(input))throw Error('OpenScreen 录制工程不是对象，原文件已保留。');
 if(input.schemaVersion===7||input.schemaVersion===8)return structuredClone(input);
 if(input.version!==2||!object(input.media)||typeof input.media.screenVideoPath!=='string'||!object(input.editor))
  throw Error('不支持此 OpenScreen 录制工程格式，原文件已保留。');
 if(input.media.webcamVideoPath)throw Error('此入口尚不支持摄像头录制工程，原文件已保留。');
 for(const key of ['trimRegions','speedRegions','annotationRegions','cameraFullscreenRegions','shaderEffectRegions'])
  if(Array.isArray(input.editor[key])&&input.editor[key].length)throw Error(`新录制含尚不支持的 ${key}，原文件已保留。`);
 if(!(metadata.duration>0&&metadata.width>0&&metadata.height>0&&metadata.fps>0)
  || !Object.values(metadata).every(Number.isFinite))throw Error('无法读取录制视频的真实时长和尺寸，原文件已保留。');
 const assetId=`asset_${options.id}`,clipId=`clip_${options.id}`;
 const regions=input.editor.zoomRegions??[];
 if(!Array.isArray(regions))throw Error('录制工程运镜数据无效，原文件已保留。');
 const zoomRanges=regions.map((region:unknown)=>{
  if(!object(region)||typeof region.id!=='string'||!Number.isFinite(region.startMs)||!Number.isFinite(region.endMs)
   ||region.startMs<0||region.endMs<=region.startMs||!object(region.focus)
   ||![region.focus.cx,region.focus.cy].every(value=>Number.isFinite(value)&&value>=0&&value<=1))
   throw Error('录制工程运镜数据无效，原文件已保留。');
  return {...structuredClone(region),clipId,sourceStartSec:region.startMs/1000,sourceEndSec:region.endMs/1000};
 });
 return {schemaVersion:8,project:{id:options.id,title:options.title,createdAt:options.createdAt,updatedAt:options.createdAt,primaryAssetId:assetId},
  assets:[{id:assetId,kind:'video',label:input.media.screenVideoPath.split(/[\\/]/).pop(),originalPath:input.media.screenVideoPath,
   durationSec:metadata.duration,video:{width:metadata.width,height:metadata.height,fps:metadata.fps,codec:'unknown'},cameraTrack:null}],
  transcript:null,transcripts:[],timeline:{clips:[{id:clipId,assetId,sourceStartSec:0,sourceEndSec:metadata.duration,timelineStartSec:0,
   timelineEndSec:metadata.duration,wordRefs:[],origin:'system',reason:'Official OpenScreen CLI recording'}],gaps:[],trimRanges:[],muteRanges:[],speedRanges:[],captionRanges:[]},
  annotations:[],zoomRanges,audioTracks:[],shaderEffectRanges:[],legacyEditor:structuredClone(input.editor)};
}
