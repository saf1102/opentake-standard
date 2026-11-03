import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {createWindowsUpdater} from './standard/windows-update.ts';
import metadata from '../desktop/windows-version.json' with {type:'json'};
import pkg from '../package.json' with {type:'json'};
const {windowsRelease,newerWindows,endpoint,repository}=createRequire(import.meta.url)('../desktop/windows-update-manifest.cjs');
function release(version=pkg.version,windowsBuild=metadata.windowsBuild+1){return {schemaVersion:1,product:'opentake-standard',platform:'win32',arch:'x64',channel:'stable',version,windowsBuild,revision:'qa',notes:'修订说明',url:`https://github.com/${repository}/releases/download/desktop-v${version}-${windowsBuild}/OpenTake-Standard-Setup-${version}-x64.exe`,sha256:'ab'.repeat(32),size:123456};}
test('Windows manifest rejects foreign products, platforms, prereleases and unpinned or unsafe downloads',()=>{
  assert.ok(windowsRelease(release()));
  for(const change of [{product:'other'},{platform:'darwin'},{arch:'arm64'},{channel:'preview'},{version:'1.1.0-beta'},{windowsBuild:0},{windowsBuild:1.5},{size:-1},{sha256:'z'.repeat(64)},{url:'file:///C:/bad.exe'},{url:'https://github.com/other/repo/releases/download/v1/setup.exe'},{url:release().url+'?token=secret'},{url:release().url.replace('.exe','.zip')},{url:release().url.replace('/download/','/latest/download/')}])assert.equal(windowsRelease({...release(),...change}),null,JSON.stringify(change));
  assert.equal(newerWindows(release(),pkg.version,metadata.windowsBuild),true);
  assert.equal(newerWindows(release(pkg.version,metadata.windowsBuild),pkg.version,metadata.windowsBuild),false);
  assert.equal(newerWindows(release('1.0.2',9999999999),pkg.version,metadata.windowsBuild),false);
  assert.equal(newerWindows(release('1.2.0',1),pkg.version,metadata.windowsBuild),true);
});
test('Windows checks persist daily preferences and skips; failed checks clear stale downloads and remain retryable',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'windows-update-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  fs.writeFileSync(path.join(root,'standard-update.json'),JSON.stringify({release:{version:'99.0.0',url:'https://example.com/source.zip'}}));
  let calls=0,status=200,value=release(),today=new Date('2026-11-03T10:00:00Z');
  const updater=createWindowsUpdater({root:()=>root,now:()=>today,fetcher:async(input,init)=>{calls++;assert.equal(input,endpoint);assert.deepEqual(init?.headers,{Accept:'application/json'});assert.equal(init?.credentials,'omit');return new Response(JSON.stringify(value),{status})}});
  assert.equal(updater.view().release,null);
  assert.equal((await updater.check()).clientUpdate?.available,true);assert.equal(calls,1);
  assert.equal((await updater.check()).skipped,true);assert.equal(calls,1);
  updater.dismiss('skip');assert.equal(updater.view().notify,false);
  assert.equal((await updater.check(true)).clientUpdate?.notify,true);
  updater.setDaily(false);today=new Date('2026-11-04T10:00:00Z');assert.equal((await updater.check()).skipped,true);
  assert.equal(createWindowsUpdater({root:()=>root}).preferences().daily,false);
  status=404;const missing=(await updater.check(true)).clientUpdate!;assert.equal(missing.offline,true);assert.match(missing.message,/尚未发布/);assert.equal(missing.release,null);assert.equal(missing.available,false);assert.equal(missing.notify,false);
  updater.setDaily(true);status=200;value=release(pkg.version,metadata.windowsBuild);assert.equal((await updater.check()).clientUpdate?.available,false);
  value={...release(),platform:'darwin'};const invalid=(await updater.check(true)).clientUpdate!;assert.equal(invalid.offline,true);assert.equal(invalid.release,null);assert.match(invalid.message,/清单无效/);
  value=release();assert.equal((await updater.check()).clientUpdate?.available,true);
  updater.dismiss('later');assert.equal(updater.view().notify,false);
});
test('Windows manifest rejects oversized responses and network errors without reporting latest',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'windows-update-size-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  for(const fetcher of [async()=>new Response('x'.repeat(65537)),async()=>{throw new TypeError('network unavailable')}]){
    const updater=createWindowsUpdater({root:()=>root,fetcher});const result=(await updater.check(true)).clientUpdate!;assert.equal(result.offline,true);assert.equal(result.available,false);assert.equal(result.release,null);
  }
});
