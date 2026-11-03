import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {parseRecordingClock,planRecordingClockRepair,correctNativeRecordingTime} from './editor/native-recording-clock.ts';

const u32=(v:number)=>{const b=Buffer.alloc(4);b.writeUInt32BE(v);return b};
const u64=(v:number)=>{const b=Buffer.alloc(8);b.writeBigUInt64BE(BigInt(v));return b};
const atom=(type:string,...parts:Buffer[])=>{const body=Buffer.concat(parts);return Buffer.concat([u32(body.length+8),Buffer.from(type),body])};
const full=(version=0,f=0)=>Buffer.from([version,(f>>16)&255,(f>>8)&255,f&255]);
function track(id:number,type:string){
  return atom('trak',atom('tkhd',full(),u32(0),u32(0),u32(id),u32(0),u32(0)),
    atom('mdia',atom('mdhd',full(),u32(0),u32(0),u32(1000),u32(0)),
      atom('hdlr',full(),u32(0),Buffer.from(type)),
      atom('minf',atom('stbl',atom('stts',full(),u32(2),u32(2),u32(100),u32(1),u32(200))))));
}
function fixture(options:{tfdt?:boolean;audio?:boolean;compositionOffset?:number;sampleCount?:number}={}){
  const moov=atom('moov',atom('mvhd',full(),u32(0),u32(0),u32(1000),u32(0)),track(1,'vide'),...(options.audio?[track(2,'soun')]:[]));
  function traf(id:number,durations:number[],base:number){
    return atom('traf',atom('tfhd',full(0,0x20000),u32(id)),
      ...(options.tfdt?[atom('tfdt',full(1),u64(base))]:[]),
      atom('trun',full(0,0x301|(options.compositionOffset!==undefined?0x800:0)),u32(options.sampleCount??durations.length),u32(0),
        ...durations.flatMap(n=>[u32(n),u32(3),...(options.compositionOffset!==undefined?[u32(options.compositionOffset)]:[])])));
  }
  const first=atom('moof',atom('mfhd',full(),u32(1)),traf(1,[100,16],0),...(options.audio?[traf(2,[100,100],0)]:[]));
  const mdat1=atom('mdat',Buffer.from('abcdef'));
  const secondAt=moov.length+first.length+mdat1.length;
  const second=atom('moof',atom('mfhd',full(),u32(2)),traf(1,[100,16],116),...(options.audio?[traf(2,[100,100],200)]:[]));
  const index=atom('mfra',atom('tfra',full(1),u32(1),u32(0),u32(1),u64(116),u64(secondAt),Buffer.from([1,1,1])));
  const data=Buffer.concat([moov,first,mdat1,second,atom('mdat',Buffer.from('ghijkl')),index]);
  const clock={schemaVersion:1,unitsPerSecond:10_000_000,videoBytes:data.length,nominalFrameDurationHns:166666,
    endTimeHns:5_000_000,timestampsHns:[0,1_000_000,2_000_000,4_000_000]};
  return {data,clock,moov,first,second,secondAt,index};
}
function plan(f:ReturnType<typeof fixture>){return planRecordingClockRepair((p,n)=>Buffer.from(f.data.subarray(p,p+n)),f.data.length,parseRecordingClock(f.clock,f.data.length))}
function apply(f:ReturnType<typeof fixture>,p:ReturnType<typeof plan>){const b=Buffer.from(f.data);for(const x of p.patches)x.bytes.copy(b,x.at);return b;}
function durations(b:Buffer){const out:number[]=[];for(let p=0;p<b.length-4;p++){if(b.toString('ascii',p,p+4)==='trun'){const n=b.readUInt32BE(p+8);for(let i=0;i<n;i++)out.push(b.readUInt32BE(p+16+i*8));}}return out;}

test('fragment ends retain their actual gaps even when Media Foundation omits tfdt',()=>{
  const f=fixture();const p=plan(f);const b=apply(f,p);
  assert.equal(p.originalDurationSec,0.232);assert.equal(p.durationSec,0.5);
  assert.deepEqual(durations(b),[100,100,200,100]);
  assert.equal(b.length,f.data.length);
  assert.equal(b.subarray(f.moov.length+f.first.length+8,f.secondAt).toString(),'abcdef');
});
test('explicit fragment decode bases and random-access indexes use the same exact clock',()=>{
  const f=fixture({tfdt:true});const b=apply(f,plan(f));
  const base=b.indexOf(Buffer.from('tfdt'),f.secondAt);
  assert.equal(Number(b.readBigUInt64BE(base+8)),200);
  const index=b.indexOf(Buffer.from('tfra'));
  assert.equal(Number(b.readBigUInt64BE(index+20)),200);
  assert.equal(Number(b.readBigUInt64BE(index+28)),f.secondAt);
});
test('audio fragment durations stay byte-identical while video durations are repaired',()=>{
  const f=fixture({audio:true,tfdt:true});const b=apply(f,plan(f));
  assert.deepEqual(durations(b),[100,100,100,100,200,100,100,100]);
});
test('zero video duration at a fragment boundary is repaired from exact clock and converges',()=>{
  const f=fixture({tfdt:true});const run=f.data.indexOf(Buffer.from('trun'));
  f.data.writeUInt32BE(0,run+24);
  const repaired=apply(f,plan(f));
  assert.deepEqual(durations(repaired),[100,100,200,100]);
  f.data=repaired;assert.equal(plan(f).patches.length,0);
});
test('zero audio duration remains a failure rather than guessing audio time',()=>{
  const f=fixture({tfdt:true,audio:true});
  const audioRun=f.data.indexOf(Buffer.from('trun'),f.data.indexOf(Buffer.from('trun'))+4);
  f.data.writeUInt32BE(0,audioRun+16);
  assert.throws(()=>plan(f),/分段帧时长无效/);
});
test('the final held frame ends at stop time rather than a nominal frame period',()=>{
  const f=fixture();f.clock.endTimeHns=8_000_000;
  assert.deepEqual(durations(apply(f,plan(f))),[100,100,200,400]);
});
test('bad clocks are refused instead of scaling mouse timestamps',()=>{
  const f=fixture();
  for(const change of [{videoBytes:1},{schemaVersion:9},{unitsPerSecond:1000},
    {timestampsHns:[0,1,1]},{timestampsHns:[1,2,3]},{endTimeHns:3},{timestampsHns:[0,NaN]}]){
    assert.throws(()=>parseRecordingClock({...f.clock,...change},f.data.length),/时间校验失败/);
  }
});
test('pending and failed native finalization cannot be imported as saved recordings',()=>{
  const f=fixture();
  for(const status of ['pending','failed','unknown'])
    assert.throws(()=>parseRecordingClock({...f.clock,nativeFinalization:{version:1,status,error:'fixture finalization failure'}},f.data.length),/采集器未完成视频保存/);
  assert.equal(parseRecordingClock({...f.clock,nativeFinalization:{version:1,status:'complete'}},f.data.length).timestampsHns.length,4);
});
test('packet count mismatch is a failure, never a ratio-based guess',()=>{
  const f=fixture({sampleCount:3});assert.throws(()=>plan(f));
  const more=fixture();more.clock.timestampsHns.push(4_500_000);assert.throws(()=>plan(more),/帧数少于/);
});
test('a frame order requiring nonzero composition offsets is refused',()=>{
  assert.throws(()=>plan(fixture({compositionOffset:1})),/重排偏移/);
});
test('truncated metadata fails without producing a patch plan',()=>{
  const f=fixture();f.data=f.data.subarray(0,f.data.length-1);f.clock.videoBytes=f.data.length;
  assert.throws(()=>plan(f),/长度无效|不完整/);
});
test('already correct unfragmented fallback is verified sample by sample',()=>{
  const f=fixture();const data=Buffer.from(f.moov);
  const clock=parseRecordingClock({...f.clock,videoBytes:data.length,timestampsHns:[0,1_000_000,2_000_000],endTimeHns:4_000_000},data.length);
  const p=planRecordingClockRepair((at,n)=>Buffer.from(data.subarray(at,at+n)),data.length,clock);
  assert.equal(p.mode,'verified-unfragmented');assert.equal(p.patches.length,0);
});
test('a natively finalized fragmented MP4 needs no second repair',()=>{
  const f=fixture({tfdt:true,audio:true});
  f.data=apply(f,plan(f));
  const verified=plan(f);
  assert.equal(verified.mode,'verified-fragmented');
  assert.equal(verified.patches.length,0);
  assert.equal(verified.originalDurationSec,verified.durationSec);
});
test('native finalization metadata cannot bypass actual MP4 timing verification',()=>{
  const f=fixture();
  const clock=parseRecordingClock({...f.clock,nativeFinalization:{version:1,changed:true}},f.data.length);
  const checked=planRecordingClockRepair((at,n)=>Buffer.from(f.data.subarray(at,at+n)),f.data.length,clock);
  assert.equal(checked.mode,'repaired-fragmented');
  assert.ok(checked.patches.length>0);
});
test('already finalized native files can be imported repeatedly without another video copy',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'standard-clock-test-'));
  try{
    const f=fixture({tfdt:true});const data=apply(f,plan(f));
    const video=path.join(dir,'原生 中文 已校时.mp4');
    fs.writeFileSync(video,data);
    fs.writeFileSync(video+'.clock.json',JSON.stringify({...f.clock,nativeFinalization:{version:1,changed:true}}));
    const cursor='{"samples":[{"timeMs":153,"cx":0.2}]}';
    fs.writeFileSync(video+'.cursor.json',cursor);
    const modified=fs.statSync(video).mtimeMs;
    const before=fs.readdirSync(dir);
    for(let i=0;i<2;i++){
      const result=correctNativeRecordingTime(video);
      assert.equal(result.video,video);
      assert.equal(result.mode,'verified-fragmented');
    }
    assert.deepEqual(fs.readdirSync(dir),before);
    assert.equal(fs.statSync(video).mtimeMs,modified);
    assert.equal(fs.readFileSync(video).equals(data),true);
    assert.equal(fs.readFileSync(video+'.cursor.json','utf8'),cursor);
  }finally{
    assert.equal(path.dirname(path.resolve(dir)),path.resolve(os.tmpdir()));
    assert.ok(path.basename(dir).startsWith('standard-clock-test-'));
    fs.rmSync(dir,{recursive:true,force:true});
  }
});
test('filesystem publication preserves raw/cursor bytes and refuses to overwrite an earlier result',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'standard-clock-test-'));
  try{
    const f=fixture({tfdt:true});const video=path.join(dir,'中文 录制.mp4');
    fs.writeFileSync(video,f.data);fs.writeFileSync(video+'.clock.json',JSON.stringify(f.clock));
    const cursor='{"samples":[{"timeMs":153,"cx":0.2}]}';fs.writeFileSync(video+'.cursor.json',cursor);
    const result=correctNativeRecordingTime(video);
    assert.equal(fs.readFileSync(video).equals(f.data),true);
    assert.equal(fs.readFileSync(result.video+'.cursor.json','utf8'),cursor);
    assert.deepEqual(durations(fs.readFileSync(result.video)),[100,100,200,100]);
    assert.throws(()=>correctNativeRecordingTime(video),/未覆盖/);
    const legacy=path.join(dir,'legacy.mp4');fs.writeFileSync(legacy,f.data);
    assert.throws(()=>correctNativeRecordingTime(legacy),/未保存逐帧时钟/);
    fs.writeFileSync(legacy+'.clock.json.pending','{"diagnostic":"retained exact capture clock"}');
    assert.throws(()=>correctNativeRecordingTime(legacy),/时钟检查点已保留/);
    assert.equal(fs.existsSync(legacy+'.clock.json.pending'),true);
    assert.equal(fs.existsSync(legacy.replace('.mp4','.clock-fixed.mp4')),false);
  }finally{
    assert.equal(path.dirname(path.resolve(dir)),path.resolve(os.tmpdir()));
    assert.ok(path.basename(dir).startsWith('standard-clock-test-'));
    fs.rmSync(dir,{recursive:true,force:true});
  }
});
