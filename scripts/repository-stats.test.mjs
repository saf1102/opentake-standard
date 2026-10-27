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
