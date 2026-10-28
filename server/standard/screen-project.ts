import type {ScreenProject} from './legacy-screen.ts';
/** Public project v5 + OpenScreen v7. The small Standard edit cache is not the interchange format. */
export function screenDocuments(p:ScreenProject,sourceFile:string,size:number){
 const assetId=p.id+'-source',clipId=p.id+'-clip',documentId=p.id+'-screen';
 const duration=p.edit.trimEnd-p.edit.trimStart;
 const relativePath=`analysis/openscreen/${documentId}/project.openscreen`;
 const ref={id:documentId,schemaVersion:7,relativePath,title:p.name,duration,previewAssetId:assetId,sourceAssetIds:[assetId],publishedAssetIds:[],revision:p.revision,createdAt:p.createdAt,updatedAt:p.updatedAt};
 const timeline={duration:0,fps:p.fps,playhead:0,tracks:[]};
 const project={schemaVersion:5,id:p.id,name:p.name,createdAt:p.createdAt,updatedAt:p.updatedAt,revision:p.revision,
  settings:{width:p.width,height:p.height,fps:p.fps,canvasMode:'custom'},
  media:[{id:assetId,name:'source.mp4',type:'video',mimeType:'video/mp4',originalFile:'source.mp4',duration:p.duration,width:p.width,height:p.height,fps:p.fps,size,createdAt:p.createdAt,status:'ready',origin:'screen-recording',importRole:'screen',openScreenDocumentId:documentId}],
  timeline,transcript:[],timelineVersions:[{id:'main',kind:'a-roll',name:'主时间线',timeline,createdAt:p.createdAt,updatedAt:p.updatedAt,revision:0}],activeTimelineVersionId:'main',openScreenDocuments:[ref]};
 const document={schemaVersion:7,project:{id:documentId,title:p.name,createdAt:new Date(p.createdAt).toISOString(),updatedAt:new Date(p.updatedAt).toISOString(),primaryAssetId:assetId},
  assets:[{id:assetId,kind:'video',label:'source.mp4',originalPath:sourceFile,durationSec:p.duration,sizeBytes:size,video:{codec:'h264',width:p.width,height:p.height,fps:p.fps},cameraTrack:null}],transcript:null,transcripts:[],
  timeline:{clips:[{id:clipId,assetId,sourceStartSec:p.edit.trimStart,sourceEndSec:p.edit.trimEnd,timelineStartSec:0,timelineEndSec:duration,wordRefs:[],origin:'user',reason:''}],gaps:[],trimRanges:[],muteRanges:[],speedRanges:[],captionRanges:[]},
  zoomRanges:p.edit.zoomRanges.filter(r=>r.endMs>p.edit.trimStart*1000&&r.startMs<p.edit.trimEnd*1000).map(r=>({...r,depth:1,customScale:r.scale,focusMode:'manual',source:'manual',clipId,sourceStartSec:Math.max(p.edit.trimStart,r.startMs/1000),sourceEndSec:Math.min(p.edit.trimEnd,r.endMs/1000),startMs:Math.max(0,r.startMs-p.edit.trimStart*1000),endMs:Math.min(duration*1000,r.endMs-p.edit.trimStart*1000)})),annotations:[],legacyEditor:null};
 return {project,document,ref};
}
