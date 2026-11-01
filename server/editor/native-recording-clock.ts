import fs from 'node:fs';
import {cleanupPathSync} from '../file-ops.ts';
import path from 'node:path';
import crypto from 'node:crypto';

type Box = {type:string; at:number; body:number; end:number};
type Patch = {at:number; bytes:Buffer};
export type RecordingClock = {
  schemaVersion:1; unitsPerSecond:10000000; videoBytes:number;
  nominalFrameDurationHns:number; endTimeHns:number; timestampsHns:number[];
};
function fail(message:string):never {throw Error(`录制时间校验失败：${message}；原始视频和时钟文件已保留。`)}

export function parseRecordingClock(value:unknown,bytes:number):RecordingClock {
  const v=value as RecordingClock;
  const finalization=(value as {nativeFinalization?:{status?:unknown;error?:unknown}})?.nativeFinalization;
  if(finalization?.status!==undefined&&finalization.status!=='complete')
    fail(`采集器未完成视频保存${typeof finalization.error==='string'?'：'+finalization.error.slice(0,500):''}`);
  if(!v||v.schemaVersion!==1||v.unitsPerSecond!==10_000_000||v.videoBytes!==bytes)
    fail('时钟版本或视频大小不匹配');
  if(!Array.isArray(v.timestampsHns)||!v.timestampsHns.length||v.timestampsHns.length>1_000_000)
    fail('缺少逐帧时间戳');
  let previous=-1;
  for(const t of v.timestampsHns){
    if(!Number.isSafeInteger(t)||t<=previous||t>72_000_000_000)fail('时间戳不递增或超出录制范围');
    previous=t;
  }
  if(v.timestampsHns[0]!==0||!Number.isSafeInteger(v.endTimeHns)||v.endTimeHns<=previous||v.endTimeHns>72_000_000_000)
    fail('录制起止时钟无效');
  if(!Number.isSafeInteger(v.nominalFrameDurationHns)||v.nominalFrameDurationHns<1||v.nominalFrameDurationHns>10_000_000)
    fail('帧周期无效');
  return v;
}

function boxes(b:Buffer,start=0,end=b.length):Box[]{
  const result:Box[]=[];
  while(start<end){
    if(start+8>end)fail('MP4 元数据不完整');
    let size=b.readUInt32BE(start);let header=8;
    if(size===1){if(start+16>end)fail('MP4 长度字段不完整');size=Number(b.readBigUInt64BE(start+8));header=16;}
    if(size===0)size=end-start;
    if(!Number.isSafeInteger(size)||size<header||start+size>end)fail('MP4 元数据长度无效');
    result.push({type:b.toString('ascii',start+4,start+8),at:start,body:start+header,end:start+size});
    start+=size;
  }
  return result;
}
function one(b:Buffer,parent:Box,type:string){
  const found=boxes(b,parent.body,parent.end).filter(x=>x.type===type);
  if(found.length!==1)fail(`MP4 ${type} 结构不受支持`);
  return found[0];
}
function integer(b:Buffer,at:number,wide=false){
  const v=wide?Number(b.readBigUInt64BE(at)):b.readUInt32BE(at);
  if(!Number.isSafeInteger(v))fail('MP4 时间字段超出精确范围');
  return v;
}
function put(b:Buffer,at:number,value:number,wide=false){
  if(!Number.isSafeInteger(value)||value<0||(!wide&&value>0xffffffff))fail('MP4 时间字段溢出');
  if(wide)b.writeBigUInt64BE(BigInt(value),at);else b.writeUInt32BE(value,at);
}
const flags=(b:Buffer,x:Box)=>b.readUIntBE(x.body+1,3);
const scaled=(hns:number,scale:number)=>Math.round(hns*scale/10_000_000);

/** Patch metadata only. mdat bytes, sample order and byte offsets never change.
 * Reads moov/moof/mfra separately rather than loading a long take into memory. */
export function planRecordingClockRepair(read:(at:number,length:number)=>Buffer,size:number,clock:RecordingClock){
  const top:Box[]=[];
  for(let at=0;at<size;){
    if(at+8>size)fail('MP4 文件尾不完整');
    const h=read(at,Math.min(16,size-at));let length=h.readUInt32BE(0);let header=8;
    if(length===1){if(h.length<16)fail('MP4 文件头不完整');length=Number(h.readBigUInt64BE(8));header=16;}
    if(length===0)length=size-at;
    if(!Number.isSafeInteger(length)||length<header||at+length>size)fail('MP4 文件长度无效');
    top.push({type:h.toString('ascii',4,8),at,body:at+header,end:at+length});
    if(top.length>2_000_000)fail('MP4 分段过多');
    at+=length;
  }
  const load=(x:Box)=>{if(x.end-x.at>8_000_000)fail('MP4 元数据过大');return read(x.at,x.end-x.at)};
  const moovs=top.filter(x=>x.type==='moov');if(moovs.length!==1)fail('MP4 主索引缺失');
  const moov=load(moovs[0]);const originalMoov=Buffer.from(moov);const root=boxes(moov)[0];const mvhd=one(moov,root,'mvhd');
  const movieWide=moov[mvhd.body]===1;
  const movieScale=integer(moov,mvhd.body+(movieWide?20:12));
  if(!movieScale)fail('MP4 主时基无效');
  const tracks=boxes(moov,root.body,root.end).filter(x=>x.type==='trak').map(trak=>{
    const tkhd=one(moov,trak,'tkhd');const wide=moov[tkhd.body]===1;
    const id=integer(moov,tkhd.body+(wide?20:12));const mdia=one(moov,trak,'mdia');
    const mdhd=one(moov,mdia,'mdhd');const mdWide=moov[mdhd.body]===1;
    const scale=integer(moov,mdhd.body+(mdWide?20:12));
    const handler=one(moov,mdia,'hdlr');
    if(!scale)fail('MP4 轨道时基无效');
    return {id,scale,trak,tkhd,wide,mdhd,mdWide,mdia,video:moov.toString('ascii',handler.body+8,handler.body+12)==='vide'};
  });
  const videos=tracks.filter(t=>t.video);if(videos.length!==1)fail('必须是单视频轨道的原生录制');
  const video=videos[0];const ticks=clock.timestampsHns.map(t=>scaled(t,video.scale));
  const end=scaled(clock.endTimeHns,video.scale);
  if(ticks.some((t,i)=>i>0&&t<=ticks[i-1])||end<=ticks.at(-1)!)fail('视频时基无法表达逐帧时钟');
  const patches:Patch[]=[];let sampleIndex=0;let oldVideoEnd=0;let movieEndSeconds=end/video.scale;
  const fragments=new Map<number,Map<string,{first:number;count:number}>>();
  const implicitDecodeTime=new Map<number,number>();
  const moofs=top.filter(x=>x.type==='moof');
  if(!moofs.length){
    // The native sink's plain-MP4 fallback already preserves time. Verify every
    // stts sample; an unknown/incorrect table is refused, never ratio-scaled.
    const minf=one(moov,video.mdia,'minf');const stbl=one(moov,minf,'stbl');const stts=one(moov,stbl,'stts');
    const entries=integer(moov,stts.body+4);let pts=0;
    if(stts.body+8+entries*8!==stts.end)fail('非分段 MP4 时间表无效');
    for(let e=0;e<entries;e++){
      const n=integer(moov,stts.body+8+e*8);const delta=integer(moov,stts.body+12+e*8);
      if(sampleIndex+n>ticks.length)fail('视频帧数与时钟数量不符');
      for(let j=0;j<n;j++){if(Math.abs(pts-ticks[sampleIndex++])>2)fail('非分段 MP4 时间戳不匹配');pts+=delta;}
    }
    if(sampleIndex!==ticks.length||Math.abs(pts-end)>video.scale/10)fail('非分段 MP4 结束时间不匹配');
    return {patches,samples:sampleIndex,fragments:0,originalDurationSec:pts/video.scale,durationSec:clock.endTimeHns/10_000_000,mode:'verified-unfragmented'};
  }
  for(const box of moofs){
    const b=load(box);const original=Buffer.from(b);const parent=boxes(b)[0];let trafNumber=0;
    const runs=new Map<string,{first:number;count:number}>();fragments.set(box.at,runs);
    for(const traf of boxes(b,parent.body,parent.end).filter(x=>x.type==='traf')){
      trafNumber++;const tfhd=one(b,traf,'tfhd');const id=integer(b,tfhd.body+4);
      const track=tracks.find(t=>t.id===id);if(!track)fail('分段轨道不存在');
      let p=tfhd.body+8;const f=flags(b,tfhd);if(f&1)p+=8;if(f&2)p+=4;
      let defaultDuration=0;if(f&8){defaultDuration=integer(b,p);p+=4;}
      const bases=boxes(b,traf.body,traf.end).filter(x=>x.type==='tfdt');
      if(bases.length>1)fail('分段解码时间重复');
      const tfdt=bases[0];const wide=tfdt?b[tfdt.body]===1:false;
      // Media Foundation also emits fragments without tfdt; their decode
      // times are the cumulative sample durations, including boundary frames.
      let runEnd=tfdt?integer(b,tfdt.body+4,wide):(implicitDecodeTime.get(id)??0);let runNumber=0;
      if(track.video){if(sampleIndex>=ticks.length)fail('视频帧数多于时钟');if(tfdt)put(b,tfdt.body+4,ticks[sampleIndex],wide);}
      for(const trun of boxes(b,traf.body,traf.end).filter(x=>x.type==='trun')){
        runNumber++;const f=flags(b,trun);const count=integer(b,trun.body+4);let p=trun.body+8;
        if(f&1)p+=4;if(f&4)p+=4;
        if(count>1_000_000||(track.video&&sampleIndex+count>ticks.length))fail('视频帧数与时钟数量不符');
        if(track.video)runs.set(`${trafNumber}:${runNumber}`,{first:sampleIndex,count});
        for(let i=0;i<count;i++){
          let duration=defaultDuration;
          if(f&0x100){
            duration=integer(b,p);
            if(track.video)put(b,p,(ticks[sampleIndex+1]??end)-ticks[sampleIndex]);
            p+=4;
          }else if(track.video)fail('视频分段缺少独立帧时长');
          // A zero video duration emitted by the MFT is repairable from the
          // exact capture clock. Audio has no independent clock here.
          if(!duration&&!track.video)fail('分段帧时长无效');
          runEnd+=duration;
          if(f&0x200)p+=4;if(f&0x400)p+=4;
          if(f&0x800){if(track.video&&integer(b,p)!==0)fail('不支持带重排偏移的原生视频');p+=4;}
          if(track.video)sampleIndex++;
        }
        if(p!==trun.end)fail('分段采样表不完整');
      }
      if(track.video)oldVideoEnd=Math.max(oldVideoEnd,runEnd);
      else movieEndSeconds=Math.max(movieEndSeconds,runEnd/track.scale);
      implicitDecodeTime.set(id,runEnd);
    }
    if(!b.equals(original))patches.push({at:box.at,bytes:b});
  }
  if(sampleIndex!==ticks.length)fail('视频帧数少于时钟，拒绝猜测时间');
  put(moov,video.mdhd.body+(video.mdWide?24:16),end,video.mdWide);
  put(moov,video.tkhd.body+(video.wide?28:20),scaled(clock.endTimeHns,movieScale),video.wide);
  put(moov,mvhd.body+(movieWide?24:16),Math.round(movieEndSeconds*movieScale),movieWide);
  const mvex=boxes(moov,root.body,root.end).find(x=>x.type==='mvex');
  if(mvex){const mehd=boxes(moov,mvex.body,mvex.end).find(x=>x.type==='mehd');if(mehd)put(moov,mehd.body+4,Math.round(movieEndSeconds*movieScale),moov[mehd.body]===1);}
  if(!moov.equals(originalMoov))patches.push({at:moovs[0].at,bytes:moov});
  // Keep random-access seek indexes on the same repaired clock as tfdt/trun.
  for(const box of top.filter(x=>x.type==='mfra')){
    const b=load(box);const original=Buffer.from(b);const root=boxes(b)[0];
    for(const tfra of boxes(b,root.body,root.end).filter(x=>x.type==='tfra')){
      if(integer(b,tfra.body+4)!==video.id)continue;
      const wide=b[tfra.body]===1;const packed=integer(b,tfra.body+8);
      const lengths=[((packed>>4)&3)+1,((packed>>2)&3)+1,(packed&3)+1];
      const count=integer(b,tfra.body+12);let p=tfra.body+16;
      for(let i=0;i<count;i++){
        const timeAt=p;p+=wide?8:4;const offset=integer(b,p,wide);p+=wide?8:4;
        const ns=lengths.map(n=>{const value=b.readUIntBE(p,n);p+=n;return value;});
        const run=fragments.get(offset)?.get(`${ns[0]}:${ns[1]}`);
        if(!run||ns[2]<1||ns[2]>run.count)fail('MP4 随机访问索引不匹配');
        put(b,timeAt,ticks[run.first+ns[2]-1],wide);
      }
      if(p!==tfra.end)fail('MP4 随机访问索引长度无效');
    }
    if(!b.equals(original))patches.push({at:box.at,bytes:b});
  }
  return {patches,samples:sampleIndex,fragments:moofs.length,originalDurationSec:oldVideoEnd/video.scale,
    durationSec:clock.endTimeHns/10_000_000,mode:patches.length?'repaired-fragmented':'verified-fragmented'};
}

export function correctNativeRecordingTime(video:string){
  const clockFile=video+'.clock.json';
  if(!path.isAbsolute(video)||!video.toLowerCase().endsWith('.mp4'))fail('原生视频路径无效');
  if(!fs.existsSync(clockFile))
    fail(fs.existsSync(clockFile+'.pending')
      ?'本次录制未完成收尾，逐帧时钟检查点已保留；请重试录制并保留本次诊断文件'
      :'本次采集器未保存逐帧时钟，无法验证录制时间；请重试录制并保留本次诊断文件');
  if(fs.statSync(clockFile).size>32_000_000)fail('逐帧时钟文件过大');
  const before=fs.statSync(video);const clock=parseRecordingClock(JSON.parse(fs.readFileSync(clockFile,'utf8')),before.size);
  const input=fs.openSync(video,'r');
  let plan:ReturnType<typeof planRecordingClockRepair>;
  try{plan=planRecordingClockRepair((at,length)=>{const b=Buffer.alloc(length);if(fs.readSync(input,b,0,length,at)!==length)fail('读取视频元数据失败');return b;},before.size,clock);}
  finally{fs.closeSync(input);}
  if(plan.mode==='verified-unfragmented'||plan.mode==='verified-fragmented')return {video,...plan,patches:undefined};
  const output=video.slice(0,-4)+'.clock-fixed.mp4';
  const temporary=output+'.'+crypto.randomUUID()+'.tmp';
  if(fs.existsSync(output)||fs.existsSync(output+'.cursor.json'))fail('本次校时输出已存在，未覆盖文件');
  fs.copyFileSync(video,temporary,fs.constants.COPYFILE_EXCL);
  const after=fs.statSync(video);if(after.size!==before.size||after.mtimeMs!==before.mtimeMs)fail('原始视频在校验期间发生变化');
  const handle=fs.openSync(temporary,'r+');
  try{for(const p of plan.patches){if(fs.writeSync(handle,p.bytes,0,p.bytes.length,p.at)!==p.bytes.length)fail('写入视频元数据失败');}fs.fsyncSync(handle);}
  finally{fs.closeSync(handle);}
  // A hard link publishes exclusively: even a racing retry cannot overwrite
  // an earlier result. Raw video and the exact cursor file stay untouched.
  fs.copyFileSync(video+'.cursor.json',output+'.cursor.json',fs.constants.COPYFILE_EXCL);
  fs.linkSync(temporary,output);cleanupPathSync(temporary);
  const result={video:output,sourceVideo:video,samples:plan.samples,fragments:plan.fragments,
    originalDurationSec:plan.originalDurationSec,durationSec:plan.durationSec,mode:plan.mode,
    method:'Exact per-sample recording clock; container metadata only; cursor timestamps unchanged'};
  fs.writeFileSync(output+'.sync.json',JSON.stringify(result,null,2)+'\n',{flag:'wx'});
  return result;
}
