import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {publishSourceRelease,findReleaseByTag} from './publish-source-release.mjs';
import {PUBLIC_REPOSITORY as repo} from './prepare-source-release.mjs';
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
function fixture(){
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'source-publish-test-'));
 const commit='a'.repeat(40),tag=`source-${commit}`,filename='OpenTake-Standard-source.zip',zip=Buffer.from('fixture ZIP bytes');
 const checksum=Buffer.from(`${hash(zip)}  ${filename}\n`);
 fs.writeFileSync(path.join(folder,filename),zip);fs.writeFileSync(path.join(folder,filename+'.sha256'),checksum);fs.writeFileSync(path.join(folder,'release-notes.md'),'notes');
 fs.writeFileSync(path.join(folder,'source-release.json'),JSON.stringify({repository:repo,commit,tag,filename,sha256:hash(zip),bytes:zip.length}));
 const release={id:51,draft:true,tag_name:tag,target_commitish:commit,html_url:'https://github.com/example/untagged-fixture'};
 const assets=[{id:61,name:filename,size:zip.length,state:'uploaded',digest:`sha256:${hash(zip)}`},{id:62,name:filename+'.sha256',size:checksum.length,state:'uploaded',digest:`sha256:${hash(checksum)}`}];
 return {folder,release,assets,zip,checksum,cleanup:()=>fs.rmSync(folder,{recursive:true,force:true})};
}
function runner(f,{existing=false,missingDigest=false}={}){
 let created=existing,published=false;const calls=[];
 const run=(args,options)=>{
  calls.push({args,options});const endpoint=args[1];
  if(args[0]==='release'&&args[1]==='create'){assert.equal(created,false);created=true;return '';}
  assert.equal(args[0],'api');
  assert.ok(!endpoint.includes('/releases/tags/'),'must not look up draft through tag endpoint');
  if(endpoint.includes('/releases?'))return JSON.stringify(created?[{...f.release,draft:!published}]:[]);
  if(endpoint.includes('/git/ref/tags/'))return null;
  if(endpoint.endsWith('/releases/51/assets?per_page=100&page=1'))return JSON.stringify(f.assets.map(a=>missingDigest?{...a,digest:null}:a));
  if(endpoint.endsWith('/releases/assets/61'))return f.zip;
  if(endpoint.endsWith('/releases/assets/62'))return f.checksum;
  if(endpoint.endsWith('/releases/51')){
   if(args.includes('PATCH')){assert.ok(args.includes('draft=false'));assert.ok(args.includes('make_latest=true'));published=true;}
   return JSON.stringify({...f.release,draft:published?false:f.release.draft});
  }
  throw new Error(`Unexpected mocked endpoint ${endpoint}`);
 };
 return {run,calls};
}
test('new draft found via list and published through numeric ID, not tag',()=>{
 const f=fixture();try{const r=runner(f);const result=publishSourceRelease({folder:f.folder,repo,run:r.run});assert.equal(result.releaseId,51);assert.equal(result.resumed,false);assert.equal(r.calls.filter(c=>c.args[0]==='release').length,1);assert.equal(r.calls.filter(c=>c.args.includes('PATCH')).length,1);}finally{f.cleanup();}
});
test('explicit resume verifies same commit and both assets, without reupload/deletion',()=>{
 const f=fixture();try{const r=runner(f,{existing:true,missingDigest:true});const result=publishSourceRelease({folder:f.folder,repo,resumeDraft:true,run:r.run});assert.equal(result.resumed,true);assert.equal(r.calls.some(c=>c.args[0]==='release'),false);assert.equal(r.calls.filter(c=>c.args.includes('Accept: application/octet-stream')).length,2);}finally{f.cleanup();}
});
test('existing draft without explicit resume and published releases are refused',()=>{
 const f=fixture();try{
  const r=runner(f,{existing:true});assert.throws(()=>publishSourceRelease({folder:f.folder,repo,run:r.run}),/explicit/);assert.ok(!r.calls.some(c=>c.args.includes('PATCH')));
  f.release.draft=false;const run=(args)=>JSON.stringify([{...f.release}]);assert.throws(()=>publishSourceRelease({folder:f.folder,repo,resumeDraft:true,run}),/already published/);
 }finally{f.cleanup();}
});
test('resume rejects mismatched commit, checksum, extra assets and size, keeping draft',()=>{
 for(const mutate of [f=>f.release.target_commitish='b'.repeat(40),f=>f.assets[0].digest='sha256:'+'0'.repeat(64),f=>f.assets.push({...f.assets[1],id:63}),f=>f.assets[1].size++]){
  const f=fixture();try{mutate(f);const r=runner(f,{existing:true});assert.throws(()=>publishSourceRelease({folder:f.folder,repo,resumeDraft:true,run:r.run}),/differs|exactly/);assert.ok(!r.calls.some(c=>c.args.includes('PATCH')));assert.ok(!r.calls.some(c=>c.args[0]==='release'));}finally{f.cleanup();}
 }
});
test('draft lookup paginates past 100 releases',()=>{
 const f=fixture();try{const calls=[];const run=args=>{calls.push(args[1]);return JSON.stringify(args[1].endsWith('page=1')?Array.from({length:100},(_,i)=>({id:i+100,tag_name:`other-${i}`})):[f.release]);};assert.equal(findReleaseByTag(repo,f.release.tag_name,run).id,51);assert.equal(calls.length,2);}finally{f.cleanup();}
});
