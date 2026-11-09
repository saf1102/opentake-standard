import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import release from '../desktop/release-contract.cjs';
import {prepareMacIntelRelease} from './prepare-mac-intel-release.mjs';
import {publishMacIntelDraft} from './publish-mac-intel-draft.mjs';
async function fixture(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'intel-draft-')),artifacts=path.join(root,'artifacts'),out=path.join(root,'out');
 fs.mkdirSync(artifacts);fs.mkdirSync(path.join(root,'desktop'));
 const commit='a'.repeat(40),tag=release.macIntelTag('1.1.2','2026110401'),filename='OpenTake-Standard-1.1.2-mac-x64.dmg';
 fs.writeFileSync(path.join(root,'package.json'),JSON.stringify({version:'1.1.2'}));
 fs.writeFileSync(path.join(root,'desktop/windows-version.json'),JSON.stringify({windowsBuild:2026110306}));
 fs.writeFileSync(path.join(root,'release-source.json'),JSON.stringify({commit,tag}));
 fs.writeFileSync(path.join(artifacts,filename),'fake DMG for contract tests');
 const receipt=await release.writeInstallerReceipt(root,path.join(artifacts,filename),'darwin','x64');
 return {root,artifacts,out,commit,tag,receipt,cleanup:()=>fs.rmSync(root,{recursive:true,force:true})};
}
test('Intel receipt records x64 and independent tag without incrementing Windows build',async()=>{
 const f=await fixture();try{assert.equal(f.receipt.arch,'x64');assert.equal(f.receipt.tag,'desktop-mac-x64-v1.1.2-2026110401');assert.equal(f.receipt.desktopBuild,2026110306);await assert.rejects(release.writeInstallerReceipt(f.root,path.join(f.artifacts,f.receipt.filename),'darwin','arm64'),/Intel-only/);}finally{f.cleanup()}
 assert.throws(()=>release.macIntelTag('1.1.2','1'),/date/);assert.equal(release.isMacIntelTag('desktop-v1.1.2-2026110306','1.1.2'),false);
});
test('Intel bundle excludes update manifests and draft creation explicitly preserves Latest',async()=>{
 const f=await fixture();try{
  await prepareMacIntelRelease(f);let created=false;const calls=[];
  const run=(args)=>{calls.push(args);if(args[0]==='release'){created=true;return ''}if(args[1].includes('/git/ref/'))return null;return JSON.stringify(created?[{tag_name:f.tag,draft:true,target_commitish:f.commit}]:[])};
  assert.deepEqual(await publishMacIntelDraft({folder:f.out,repo:release.REPOSITORY,run}),{tag:f.tag,draft:true,makeLatest:false});
  const create=calls.find(args=>args[0]==='release');assert.ok(create.includes('--draft'));assert.ok(create.includes('--latest=false'));assert.ok(!calls.some(args=>args.includes('PATCH')));
  assert.equal(fs.existsSync(path.join(f.out,'windows-update.json')),false);assert.equal(fs.existsSync(path.join(f.out,'upgrade.json')),false);
  await assert.rejects(publishMacIntelDraft({folder:f.out,repo:release.REPOSITORY,makeLatest:true,run}),/Latest/);
  await assert.rejects(publishMacIntelDraft({folder:f.out,repo:release.REPOSITORY,run}),/已有/);
  fs.writeFileSync(path.join(f.out,'windows-update.json'),'{}');await assert.rejects(publishMacIntelDraft({folder:f.out,repo:release.REPOSITORY,run}),/禁止/);
 }finally{f.cleanup()}
});
test('Intel aggregation refuses arm64, dirty source, wrong tag and tampered DMG',async()=>{
 for(const mutation of [{arch:'arm64'},{modified:true},{tag:'desktop-v1.1.2-2026110306'},{sha256:'0'.repeat(64)}]){
  const f=await fixture();try{fs.writeFileSync(path.join(f.artifacts,f.receipt.filename+'.build.json'),JSON.stringify({...f.receipt,...mutation}));await assert.rejects(prepareMacIntelRelease(f));assert.equal(fs.existsSync(f.out),false)}finally{f.cleanup()}
 }
});


test('Intel CI runs tests and DMG build; separate workflow creates only a Latest-preserving draft',()=>{
 const read=name=>fs.readFileSync(new URL('../.github/workflows/'+name,import.meta.url),'utf8');
 const compatibility=read('compatibility.yml'),full=read('desktop-release.yml'),intel=read('mac-intel-release.yml');
 assert.match(compatibility,/macos-15-intel/);assert.match(compatibility,/npm test/);assert.match(compatibility,/npm run build:installer/);
 assert.match(full,/platform: darwin-x64/);assert.match(intel,/runs-on: macos-15-intel/);assert.match(intel,/workflow_dispatch:/);
 assert.match(intel,/publish-mac-intel-draft.mjs --bundle release\/intel-bundle --latest=false/);
 assert.doesNotMatch(intel,/prepare-desktop-release\.mjs|publish-source-release\.mjs --|windows-update\.json|npm version/);
});


test('supplemental Intel Git tag never changes the native Apple Silicon receipt',()=>{
 const tag=release.macIntelTag('1.1.2','2026110401');
 assert.equal(release.macSourceTag('1.1.2',2026110306,[tag],'arm64'),undefined);
 assert.equal(release.macSourceTag('1.1.2',2026110306,[tag],'x64'),tag);
 for(const normal of ['v1.1.2','desktop-v1.1.2-2026110306'])assert.equal(release.macSourceTag('1.1.2',2026110306,[tag,normal],'x64'),undefined);
});
