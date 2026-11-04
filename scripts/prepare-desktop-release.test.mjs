import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {prepareDesktopRelease} from './prepare-desktop-release.mjs';
import {macInstallerPlan} from '../desktop/build-mac-installer.mjs';
import release from '../desktop/release-contract.cjs';
const metadata=JSON.parse(fs.readFileSync(new URL('../desktop/windows-version.json',import.meta.url),'utf8'));
const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
function fixture(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'opentake-desktop-release-')),source=path.join(root,'source'),artifacts=path.join(root,'artifacts'),out=path.join(root,'bundle');
 fs.mkdirSync(source);fs.mkdirSync(artifacts);
 const commit='a'.repeat(40),version='1.1.0',tag=release.desktopTag(version,metadata.windowsBuild),zip=Buffer.from('source zip fixture'),filename='OpenTake-Standard-source.zip';
 fs.writeFileSync(path.join(source,filename),zip);fs.writeFileSync(path.join(source,filename+'.sha256'),`${sha(zip)}  ${filename}\n`);
 fs.writeFileSync(path.join(source,'source-release.json'),JSON.stringify({repository:release.REPOSITORY,commit,version,tag,filename,bytes:zip.length,sha256:sha(zip)}));
 fs.writeFileSync(path.join(source,'upgrade.json'),'{}');
 const receipts=[];
 for(const [platform,arch,name] of [['darwin','arm64','OpenTake-Standard-1.1.0-mac-arm64.dmg'],['darwin','x64','OpenTake-Standard-1.1.0-mac-x64.dmg'],['win32','x64','OpenTake-Standard-Setup-1.1.0-x64.exe']]){
  const bytes=Buffer.from(platform+' fixture'),receipt={schemaVersion:1,repository:release.REPOSITORY,commit,version,tag,desktopBuild:metadata.windowsBuild,modified:false,platform,arch,filename:name,bytes:bytes.length,sha256:sha(bytes)};
  fs.writeFileSync(path.join(artifacts,name),bytes);fs.writeFileSync(path.join(artifacts,name+'.build.json'),JSON.stringify(receipt));receipts.push(receipt);
 }
 return {root,source,artifacts,out,commit,receipts,cleanup:()=>fs.rmSync(root,{recursive:true,force:true})};
}
test('combined release contains three installers, source, official update feed and checksums',async()=>{
 const f=fixture();try{
  const result=await prepareDesktopRelease(f);assert.equal(result.tag,release.desktopTag('1.1.0',metadata.windowsBuild));
  const feed=JSON.parse(fs.readFileSync(path.join(f.out,'windows-update.json'),'utf8'));
  assert.equal(feed.url,`https://github.com/${release.REPOSITORY}/releases/download/${result.tag}/OpenTake-Standard-Setup-1.1.0-x64.exe`);
  assert.equal(feed.windowsBuild,2026110401);
  assert.match(feed.notes,/极少量额度/);assert.match(feed.notes,/mac-x64\.dmg/);assert.match(feed.notes,/mac-arm64\.dmg/);assert.match(feed.notes,/x64\.exe/);assert.match(feed.notes,/仍要打开/);assert.match(feed.notes,/仍要运行/);assert.doesNotMatch(feed.notes,/发布负责人|候选安装包验收|最终 QA/);
  for(const line of fs.readFileSync(path.join(f.out,'SHA256SUMS.txt'),'utf8').trim().split('\n')){const [hash,name]=line.split('  ');assert.equal(sha(fs.readFileSync(path.join(f.out,name))),hash,name)}
  await assert.rejects(prepareDesktopRelease(f),/replace/);
 }finally{f.cleanup();}
});
test('mixed commits, dirty builds, foreign repositories, wrong platforms and tampered installers cannot form a release',async()=>{
 for(const mutation of [{commit:'b'.repeat(40)},{modified:true},{repository:'steven90s/opentake-standard'},{platform:'win32'},{desktopBuild:1}]){
  const f=fixture();try{const receipt={...f.receipts[0],...mutation};fs.writeFileSync(path.join(f.artifacts,receipt.filename+'.build.json'),JSON.stringify(receipt));await assert.rejects(prepareDesktopRelease(f),/Installer identity/);assert.equal(fs.existsSync(f.out),false)}finally{f.cleanup()}
 }
 const f=fixture();try{fs.writeFileSync(path.join(f.artifacts,f.receipts[1].filename),'different');await assert.rejects(prepareDesktopRelease(f),/checksum/);assert.equal(fs.existsSync(f.out),false)}finally{f.cleanup()}
});
test('Mac artifact plan retains Apple Silicon support and app version and adds Intel support',()=>{
 const root=path.resolve('fixture');const plan=macInstallerPlan(root,'1.1.0','arm64');
 assert.equal(plan.app,path.join(root,'release/mac-arm64/OpenTake Standard.app'));assert.equal(path.basename(plan.installer),'OpenTake-Standard-1.1.0-mac-arm64.dmg');
 assert.equal(path.basename(macInstallerPlan(root,'1.1.0','x64').installer),'OpenTake-Standard-1.1.0-mac-x64.dmg');
 assert.throws(()=>macInstallerPlan(root,'1.1.0','ia32'));
 assert.throws(()=>release.desktopTag('1.1.0-beta',1),/Invalid/);assert.throws(()=>release.desktopTag('1.1.0',1.5),/Invalid/);
});
