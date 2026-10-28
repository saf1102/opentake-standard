import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import crypto from 'node:crypto';
import {prepareSourceRelease,PUBLIC_REPOSITORY} from './prepare-source-release.mjs';
function fixture(){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'standard-source-zip-'));
 const git=(...args)=>{const r=spawnSync('git',args,{cwd:dir,encoding:'utf8'});assert.equal(r.status,0,r.stderr);return r.stdout.trim();};
 git('init','-b','main');git('config','user.name','Source archive test');git('config','user.email','test@example.invalid');git('remote','add','origin',`https://github.com/${PUBLIC_REPOSITORY}.git`);
 for(const name of ['README.md','LICENSE','NOTICE','package.json','package-lock.json'])fs.writeFileSync(path.join(dir,name),'tracked source');
 fs.writeFileSync(path.join(dir,'package.json'),JSON.stringify({name:'opentake-standard',version:'1.0.1'}));
 git('add','.');git('commit','-m','Source fixture');const sha=git('rev-parse','HEAD');git('update-ref','refs/remotes/origin/main',sha);
 return {dir,git,sha,cleanup:()=>fs.rmSync(dir,{recursive:true,force:true})};
}
test('archive contains selected tracked commit, excludes untracked files and dirty changes',()=>{
 const f=fixture();try{
  fs.writeFileSync(path.join(f.dir,'README.md'),'uncommitted change');fs.writeFileSync(path.join(f.dir,'personal-project.txt'),'not published');
  const out=path.join(f.dir,'prepared'),m=prepareSourceRelease({cwd:f.dir,out,ref:f.sha});
  assert.equal(m.commit,f.sha);assert.equal(m.tag,'v1.0.1');
  const receipt=JSON.parse(spawnSync('unzip',['-p',path.join(out,m.filename),'opentake-standard/release-source.json'],{encoding:'utf8'}).stdout);assert.equal(receipt.version,'1.0.1');assert.equal(receipt.repository,PUBLIC_REPOSITORY);assert.ok(receipt.files['README.md']);
  const list=spawnSync('unzip',['-Z1',path.join(out,m.filename)],{encoding:'utf8'});assert.equal(list.status,0);assert.ok(!list.stdout.includes('personal-project'));assert.ok(list.stdout.includes('opentake-standard/README.md'));
  const read=spawnSync('unzip',['-p',path.join(out,m.filename),'opentake-standard/README.md'],{encoding:'utf8'});assert.equal(read.stdout,'tracked source');
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(out,m.filename))).digest('hex'),m.sha256);
  assert.throws(()=>prepareSourceRelease({cwd:f.dir,out,ref:f.sha}),/overwrite/);
 }finally{f.cleanup();}
});
test('rejects private origin, non-main branch commit and forbidden tracked paths',()=>{
 const f=fixture();try{
  f.git('remote','set-url','origin','https://github.com/other/private.git');assert.throws(()=>prepareSourceRelease({cwd:f.dir,out:path.join(f.dir,'out')}),/public Standard/);
  f.git('remote','set-url','origin',`https://github.com/${PUBLIC_REPOSITORY}.git`);f.git('checkout','-b','side');fs.writeFileSync(path.join(f.dir,'side.txt'),'side');f.git('add','.');f.git('commit','-m','side');const side=f.git('rev-parse','HEAD');
  assert.throws(()=>prepareSourceRelease({cwd:f.dir,out:path.join(f.dir,'out'),ref:side}),/Git verification/);
  f.git('checkout','main');fs.mkdirSync(path.join(f.dir,'internal-service'));fs.writeFileSync(path.join(f.dir,'internal-service/private.txt'),'not allowed');f.git('add','.');f.git('commit','-m','bad path');f.git('update-ref','refs/remotes/origin/main',f.git('rev-parse','HEAD'));
  assert.throws(()=>prepareSourceRelease({cwd:f.dir,out:path.join(f.dir,'out')}),/forbidden/);
 }finally{f.cleanup();}
});
