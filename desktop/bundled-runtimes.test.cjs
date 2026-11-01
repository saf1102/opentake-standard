const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {RUNTIME_LAYOUT,bundledRuntimeEnvironment}=require('./bundled-runtimes.cjs');
const {distributionEnvironment}=require('./distribution.cjs');
function fixture(){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'opentake-bundled-test-')),resources=path.join(dir,'安装目录 中文 空格','resources'),root=path.join(resources,'runtimes');
 fs.mkdirSync(root,{recursive:true});fs.writeFileSync(path.join(root,'manifest.json'),JSON.stringify({schema:1,platform:'win32-x64'}));
 for(const relative of Object.values(RUNTIME_LAYOUT)){const file=path.join(root,relative);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,'fixture')}
 return {dir,resources,root,dispose(){assert.equal(path.dirname(path.resolve(dir)),path.resolve(os.tmpdir()));assert.ok(path.basename(dir).startsWith('opentake-bundled-test-'));fs.rmSync(dir,{recursive:true,force:true})}};
}
test('full installer resolves tools relative to a Chinese/space install path without host tools',()=>{
 const f=fixture();try{const input={Path:'host-path'},env=bundledRuntimeEnvironment(input,f.resources);
  for(const key of ['LINKREADER_PYTHON','OPENSCREEN_BIN','PLAYWRIGHT_CHROMIUM_EXECUTABLE','LINKREADER_CODEX_EXECUTABLE'])assert.ok(env[key].startsWith(f.root+path.sep));
  assert.equal(env.PLAYWRIGHT_BROWSERS_PATH,path.join(f.root,'browsers'));assert.ok(env.PATH.endsWith('host-path'));assert.equal(env.Path,undefined);assert.deepEqual(input,{Path:'host-path'});
 }finally{f.dispose()}
});
test('a stale manual-path file cannot break a self-contained installation',()=>{
 const f=fixture();try{fs.writeFileSync(path.join(f.dir,'runtime-paths.json'),'{obsolete invalid json');
  const env=distributionEnvironment({}, {bundled:true,profile:f.dir,videos:f.dir,resources:f.resources});assert.ok(env.LINKREADER_PYTHON.startsWith(f.root));
 }finally{f.dispose()}
});
test('explicit supported tool overrides retain precedence',()=>{
 const f=fixture();try{const env=bundledRuntimeEnvironment({LINKREADER_PYTHON:'explicit-python',OPENSCREEN_BIN:'explicit-openscreen',PLAYWRIGHT_BROWSERS_PATH:'explicit-browsers'},f.resources);
  assert.equal(env.LINKREADER_PYTHON,'explicit-python');assert.equal(env.OPENSCREEN_BIN,'explicit-openscreen');assert.equal(env.PLAYWRIGHT_BROWSERS_PATH,'explicit-browsers');
 }finally{f.dispose()}
});
test('incomplete bundles fail clearly instead of silently borrowing host runtimes',()=>{
 const f=fixture();try{fs.unlinkSync(path.join(f.root,RUNTIME_LAYOUT.ffprobe));assert.throws(()=>bundledRuntimeEnvironment({},f.resources),/ffprobe.*缺失/);
  fs.writeFileSync(path.join(f.root,'manifest.json'),'bad');assert.throws(()=>bundledRuntimeEnvironment({},f.resources),/清单缺失或损坏/);
 }finally{f.dispose()}
});
