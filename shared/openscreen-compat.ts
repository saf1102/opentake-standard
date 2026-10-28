type Obj = Record<string, any>;
const object = (v:unknown): v is Obj => Boolean(v && typeof v === 'object' && !Array.isArray(v));
/** Import the basic v8 recording contract into the embedded v7 editor.
 * v8 changes the default frame to Auto. Freeze that geometry explicitly rather
 * than merely changing schemaVersion (official 2.1.2 schema/outputFormat).
 * Unsupported newer editing features are rejected, never silently discarded.
 * The host retains native-source.openscreen; saves also preserve revision backups.
 */
export function compatibleOpenScreenDocument(input:unknown): Obj {
 if(!object(input))throw Error('OpenScreen 文档必须是对象');
 if(input.schemaVersion===7)return structuredClone(input);
 if(input.schemaVersion!==8)throw Error(`不支持 OpenScreen 工程版本 ${input.schemaVersion}；当前支持 v7 和基础 v8 录屏，原文件已保留`);
 const d=structuredClone(input);
 for(const key of ['audioTracks','shaderEffects','shaderEffectRanges'])if(Array.isArray(d[key])&&d[key].length)throw Error(`此 v8 工程含尚不支持的 ${key}，请在官方 OpenScreen 中编辑；原文件已保留`);
 if(!Array.isArray(d.assets)||!Array.isArray(d.timeline?.clips))throw Error('OpenScreen 素材或时间线无效');
 if(d.assets.some((a:Obj)=>a.kind!=='video'))throw Error('此 v8 工程含独立音频素材，当前不能无损导入');
 if((d.zoomRanges||[]).some((z:Obj)=>z.rotationPreset&&!['iso','left','right'].includes(z.rotationPreset)))throw Error('此 v8 工程含尚不支持的三维运镜');
 if((d.annotations||[]).some((a:Obj)=>a.space==='frame'))throw Error('此 v8 工程含画布坐标标注，当前不能无损导入');
 const editor=d.legacyEditor={...(d.legacyEditor||{})};
 if(editor.aspectRatio==null||editor.aspectRatio==='auto'){
  const clips=[...d.timeline.clips].sort((a:Obj,b:Obj)=>a.timelineStartSec-b.timelineStartSec);
  const clip=clips[0],asset=d.assets.find((a:Obj)=>a.id===clip?.assetId),crop=clip?.cropRegion;
  if(asset?.cameraTrack?.sourcePath || (editor.frame&&editor.frame!=='none'))throw Error('带摄像头或设备边框的 v8 Auto 工程请先在官方 OpenScreen 选择固定画幅');
  const w=Number(asset?.video?.width)*(crop?.width??1),h=Number(asset?.video?.height)*(crop?.height??1);
  if(!(w>0&&h>0&&Number.isFinite(w/h)))throw Error('v8 Auto 工程缺少素材尺寸，无法保留画幅');
  const padding=Number(editor.padding??50);
  if(!Number.isFinite(padding)||padding<0||padding>100)throw Error('录屏留白数值无效');
  const ratio=w/h,elongation=Math.max(ratio,1/ratio),fit=1-padding*.004;
  const framed=fit*elongation+(1-fit),aspect=ratio>=1?framed:1/framed;
  editor.aspectRatio=`${aspect}:1`;
  // Auto has equal margins on all sides; fixed format measures each axis.
  editor.padding=padding*Math.min(aspect,1/aspect);
 }
 d.schemaVersion=7;
 return d;
}
