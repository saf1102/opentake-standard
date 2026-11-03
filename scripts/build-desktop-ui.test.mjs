import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {buildDesktopUi} from './build-desktop-ui.mjs';
function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'opentake-ui-build-'));
 fs.mkdirSync(path.join(root,'public/openscreen'),{recursive:true});
 fs.writeFileSync(path.join(root,'public/openscreen/linkreader.html'),'tracked prebuilt snapshot');
 fs.writeFileSync(path.join(root,'public/icon.png'),'shared asset');
 t.after(()=>{assert.equal(path.dirname(path.resolve(root)),path.resolve(os.tmpdir()));assert.ok(path.basename(root).startsWith('opentake-ui-build-'));fs.rmSync(root,{recursive:true,force:true});});
 return root;
}
test('platform-specific editor output reaches the app while tracked public assets remain identical',t=>{
 for(const preserve of [false,true]){
  const root=fixture(t),calls=[];
  const stage=buildDesktopUi({root,preserve,run(file,args,options){
   assert.equal(file,process.execPath);calls.push({args,options});
   if(calls.length===1){const output=args[args.indexOf('--outDir')+1];fs.mkdirSync(output);fs.writeFileSync(path.join(output,'linkreader.html'),'new platform-specific editor');}
   else {fs.cpSync(options.env.OPENTAKE_BUILD_PUBLIC_DIR,path.join(root,'dist'),{recursive:true});}
  }});
  assert.equal(fs.readFileSync(path.join(root,'public/openscreen/linkreader.html'),'utf8'),'tracked prebuilt snapshot');
  assert.equal(fs.readFileSync(path.join(root,'dist/openscreen/linkreader.html'),'utf8'),'new platform-specific editor');
  assert.equal(fs.readFileSync(path.join(stage,'icon.png'),'utf8'),'shared asset');
  assert.equal(calls[0].options.cwd,path.join(root,'vendor/openscreen'));
  assert.deepEqual(calls[1].args.slice(1),['build',...(preserve?['--emptyOutDir','false']:[])]);
 }
});
test('a failed editor compile preserves the tracked snapshot and its diagnostic stage',t=>{
 const root=fixture(t);
 assert.throws(()=>buildDesktopUi({root,run(){throw Error('synthetic compiler failure')}}),/synthetic compiler failure/);
 assert.equal(fs.readFileSync(path.join(root,'public/openscreen/linkreader.html'),'utf8'),'tracked prebuilt snapshot');
 assert.equal(fs.readdirSync(path.join(root,'.build')).length,1);
});
