import test from 'node:test';
import assert from 'node:assert/strict';
import {mergeSnapshot,report,repository} from './repository-stats.mjs';
const repo='saf1102/opentake-standard';
const day=(date,n,u=1)=>({timestamp:`2026-10-${date}T00:00:00Z`,count:n,uniques:u});
const snapshot=(rows,total=rows.reduce((n,r)=>n+r.count,0),uniques=1)=>({count:total,uniques,clones:rows});
const t='2026-10-27T12:00:00Z';
test('overlapping windows replace days rather than double-counting',()=>{
 const first=mergeSnapshot(null,snapshot([day('25',4),day('26',6)]),repo,t);
 const next=mergeSnapshot(first,snapshot([day('26',7),day('27',3)]),repo,'2026-10-27T13:00:00Z');
 assert.deepEqual(next.days.map(x=>x.count),[4,7,3]);
 assert.equal(next.latestWindow.count,10);assert.equal(next.latestWindow.uniqueCloners,1);
 assert.equal(next.sourceArchiveDownloads,null);assert.match(report(next),/\| 已留存日期的完整 git clone 次数之和 \| 14 \|/);
});
test('repeat snapshot is idempotent and downward corrections replace old counts',()=>{
 const s=snapshot([day('26',4)]);const a=mergeSnapshot(null,s,repo,t),b=mergeSnapshot(a,s,repo,t);
 assert.deepEqual(a,b);assert.equal(mergeSnapshot(b,snapshot([day('26',2)]),repo,t).days[0].count,2);
});
test('missing dates remain unknown, no invented zero history',()=>{
 const a=mergeSnapshot(null,snapshot([day('25',4),day('27',3)]),repo,t);
 assert.equal(a.days.length,2);assert.equal(a.days.some(x=>x.timestamp.startsWith('2026-10-26')),false);
 assert.match(report(a),/未返回的日期不补成零/);
});
test('rejects malformed counts, dates, repository changes and stale snapshots',()=>{
 for(const bad of [null,{},snapshot([day('25',-1)]),snapshot([day('25',1,2)]),snapshot([day('25',1),day('25',2)]),snapshot([{...day('25',1),timestamp:'oops'}])]) assert.throws(()=>mergeSnapshot(null,bad,repo,t));
 const first=mergeSnapshot(null,snapshot([day('25',2)]),repo,t);
 assert.throws(()=>mergeSnapshot(first,snapshot([]),repo,'2026-10-26T12:00:00Z'));
 assert.throws(()=>mergeSnapshot(first,snapshot([]),'other/repo',t));
 assert.throws(()=>repository('x/y?token=secret'));
});
test('zero clone result is distinct from missing/failed response',()=>{
 const a=mergeSnapshot(null,{count:0,uniques:0,clones:[]},repo,t);
 assert.equal(a.latestWindow.count,0);assert.equal(a.days.length,0);assert.equal(a.sourceArchiveDownloads,null);
});

import {mergeRepositorySnapshot,collectReleaseAssets,SOURCE_ZIP_NAME} from './repository-stats.mjs';
const asset=(id,n,releaseId=id)=>({id,releaseId,tag:`source-${id}`,name:SOURCE_ZIP_NAME,downloadCount:n});
const observed=(assets,clones={status:'unavailable'})=>({sourceZip:{status:'ok',assets},clones});
const time=(day,hour='05')=>`2026-10-${day}T${hour}:17:00.000Z`;
test('ZIP first observation is a baseline, not same-day new downloads',()=>{
 const a=mergeRepositorySnapshot(null,observed([asset(1,15)]),repo,time('24'));
 assert.equal(a.schemaVersion,2);assert.equal(a.sourceZip.intervals[0].firstSeenBaseline,15);
 assert.equal(a.sourceZip.intervals[0].increase,0);assert.equal(a.sourceZip.intervals[0].utcDate,null);
 assert.equal(a.clones.status,'unavailable');assert.equal(a.automaticSourceArchiveDownloads,null);
 assert.match(report(a),/未知（无权限/);
});
test('repeated ZIP snapshot is idempotent; repeated counts next hour add zero',()=>{
 const a=mergeRepositorySnapshot(null,observed([asset(1,15)]),repo,time('24'));
 assert.deepEqual(mergeRepositorySnapshot(a,observed([asset(1,15)]),repo,time('24')),a);
 const b=mergeRepositorySnapshot(a,observed([asset(1,15)]),repo,time('24','06'));
 assert.equal(b.sourceZip.intervals[1].increase,0);
 assert.throws(()=>mergeRepositorySnapshot(a,observed([asset(1,16)]),repo,time('24')));
});
test('UTC boundaries and missed collection gaps are intervals, not invented daily events',()=>{
 const a=mergeRepositorySnapshot(null,observed([asset(1,15)]),repo,time('24','23'));
 const b=mergeRepositorySnapshot(a,observed([asset(1,20)]),repo,time('25','00'));
 assert.equal(b.sourceZip.intervals[1].increase,5);assert.equal(b.sourceZip.intervals[1].kind,'cross-utc-day');assert.equal(b.sourceZip.intervals[1].utcDate,null);
 const c=mergeRepositorySnapshot(b,observed([asset(1,23)]),repo,time('27','02'));
 assert.equal(c.sourceZip.intervals[2].kind,'collection-gap');assert.equal(c.sourceZip.intervals[2].increase,3);assert.equal(c.sourceZip.intervals[2].utcDate,null);
 assert.match(report(c),/漏采区间/);
});
test('deletion preserves observed cumulative count; replacement ID starts separate baseline',()=>{
 const a=mergeRepositorySnapshot(null,observed([asset(1,15)]),repo,time('24'));
 const b=mergeRepositorySnapshot(a,observed([]),repo,time('25'));
 assert.equal(b.sourceZip.assets[0].active,false);assert.equal(b.sourceZip.assets[0].lastCount,15);
 const c=mergeRepositorySnapshot(b,observed([asset(2,4)]),repo,time('26'));
 assert.equal(c.sourceZip.assets.length,2);assert.equal(c.sourceZip.assets.reduce((n,a)=>n+a.lastCount,0),19);
 assert.equal(c.sourceZip.intervals[2].increase,0);assert.equal(c.sourceZip.intervals[2].firstSeenBaseline,4);
});
test('clone failure preserves legacy history while ZIP still progresses',()=>{
 const legacy=mergeSnapshot(null,snapshot([day('24',5)]),repo,time('24'));
 const a=mergeRepositorySnapshot(legacy,observed([asset(1,2)]),repo,time('25'));
 assert.equal(a.clones.status,'unavailable');assert.equal(a.clones.history.days[0].count,5);
 assert.equal(a.sourceZip.status,'ok');assert.equal(a.sourceZip.assets[0].lastCount,2);
 const b=mergeRepositorySnapshot(a,{clones:{status:'unavailable'},sourceZip:{status:'unavailable'}},repo,time('26'));
 assert.deepEqual(b.sourceZip.assets,a.sourceZip.assets);assert.equal(b.sourceZip.intervals.length,1);assert.equal(b.sourceZip.status,'unavailable');assert.match(report(b),/不是本次实时数据/);
});
test('counter correction is explicit and not represented as negative new downloads',()=>{
 const a=mergeRepositorySnapshot(null,observed([asset(1,15)]),repo,time('24'));
 const b=mergeRepositorySnapshot(a,observed([asset(1,12)]),repo,time('25'));
 assert.equal(b.sourceZip.intervals[1].increase,0);assert.equal(b.sourceZip.intervals[1].correction,-3);
 assert.equal(b.sourceZip.assets[0].lastCount,12);
});
test('all release pages and all asset pages are fetched; built-in source archives ignored',async()=>{
 const calls=[];
 const request=async endpoint=>{
  calls.push(endpoint);
  if(endpoint.endsWith('/releases?per_page=100&page=1'))return Array.from({length:100},(_,i)=>({id:i+1,tag_name:`source-${i+1}`,draft:false,assets:[{name:'truncated embedded list'}]}));
  if(endpoint.endsWith('/releases?per_page=100&page=2'))return [{id:101,tag_name:'source-101',draft:false}];
  if(endpoint.includes('/releases/1/assets?')&&endpoint.endsWith('page=1'))return Array.from({length:100},(_,i)=>({id:1000+i,name:i===0?SOURCE_ZIP_NAME:'unrelated.zip',download_count:2,state:'uploaded'}));
  if(endpoint.includes('/releases/1/assets?')&&endpoint.endsWith('page=2'))return [{id:1100,name:SOURCE_ZIP_NAME,download_count:3,state:'uploaded'}];
  if(endpoint.includes('/releases/101/assets?'))return [{id:1101,name:SOURCE_ZIP_NAME,download_count:4,state:'uploaded'}];
  return [];
 };
 const result=await collectReleaseAssets(repo,request);
 assert.deepEqual(result.map(x=>x.id),[1000,1100,1101]);assert.equal(calls.length,104);
 assert.ok(calls.some(x=>x.includes('/releases/1/assets?per_page=100&page=2')));
});
test('partial pagination failure does not produce a deletion snapshot',async()=>{
 await assert.rejects(collectReleaseAssets(repo,async endpoint=>{
  if(endpoint.includes('/releases?'))return [{id:1,tag_name:'source-1'}];
  if(endpoint.endsWith('page=1'))return Array.from({length:100},(_,i)=>({id:i+1,name:SOURCE_ZIP_NAME,state:'uploaded',download_count:1}));
  throw new Error('page unavailable');
 }));
});
import {dailyZipRows} from './repository-stats.mjs';
test('reappearing assets measure from last observation, not last empty collection',()=>{
 const a=mergeRepositorySnapshot(null,observed([asset(1,15)]),repo,time('24'));
 const b=mergeRepositorySnapshot(a,observed([]),repo,time('27','05'));
 const c=mergeRepositorySnapshot(b,observed([asset(1,20)]),repo,time('27','06'));
 const interval=c.sourceZip.intervals.at(-1);
 assert.equal(interval.from,time('24'));assert.equal(interval.kind,'collection-gap');
 assert.equal(interval.changes[0].from,time('24'));assert.equal(interval.utcDate,null);
 assert.equal(dailyZipRows(c.sourceZip)[0].increase,null);
});
test('daily rows only include within-day intervals and expose adjustments and boundary gaps',()=>{
 let a=mergeRepositorySnapshot(null,observed([asset(1,15)]),repo,time('24','22'));
 a=mergeRepositorySnapshot(a,observed([asset(1,18)]),repo,time('24','23'));
 a=mergeRepositorySnapshot(a,observed([asset(1,20)]),repo,time('25','00'));
 a=mergeRepositorySnapshot(a,observed([asset(1,19)]),repo,time('25','01'));
 a=mergeRepositorySnapshot(a,observed([asset(1,21)]),repo,time('25','02'));
 const rows=dailyZipRows(a.sourceZip);
 assert.equal(rows[0].increase,2);assert.equal(rows[0].correction,-1);assert.equal(rows[0].unallocated,1);
 assert.equal(rows[1].increase,3);assert.equal(rows[1].unallocated,1);
});
