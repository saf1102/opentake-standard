const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {afterPack}=require('./production-pack.cjs');
test('package cleanup removes dependency fixtures/maps/types and preserves runtime code and licenses',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'opentake-production-pack-')),out=path.join(dir,'output'),app=path.join(out,'resources/app');
 const needed=['dist/index.html','dist/opentake-icon-512.png','dist/openscreen/linkreader.html','dist/openscreen/wallpapers/wallpaper1.jpg','desktop/main.cjs','server/editor/openscreen-export.ts','node_modules/example/runtime.js','node_modules/example/LICENSE','node_modules/example/schema.json'];
 const discarded=['node_modules/example/tests/fixture.js','node_modules/example/__snapshots__/value.snap','node_modules/example/lib/parse.spec.ts','node_modules/example/lib/runtime.js.map','node_modules/example/lib/runtime.d.mts'];
 try{
  await fs.mkdir(path.join(dir,'evidence'),{recursive:true});await fs.mkdir(path.join(dir,'source'));
  for(const name of [...needed,...discarded]){const file=path.join(app,name);await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,'fixture')}
  await afterPack({appOutDir:out,packager:{projectDir:path.join(dir,'source')}});
  for(const name of needed)assert.equal(await fs.readFile(path.join(app,name),'utf8'),'fixture');
  for(const name of discarded)await assert.rejects(fs.access(path.join(app,name)),{code:'ENOENT'});
  assert.equal(JSON.parse(await fs.readFile(path.join(dir,'evidence/production-pack.json'),'utf8')).staticAssetsSingleCopy,true);
 }finally{assert.equal(path.dirname(dir),os.tmpdir());await fs.rm(dir,{recursive:true,force:true})}
});
