const {test}=require('node:test'),assert=require('node:assert/strict');
const {endpoint,macRelease,macInstallerRelease,newerBuild,dmgName}=require('./mac-update-manifest.cjs');
const tag='desktop-v1.1.3-2026111001';
const feed=(over={})=>({schemaVersion:1,product:'opentake-standard',platform:'darwin',channel:'stable',version:'1.1.3',desktopBuild:2026111001,notes:'n',installers:Object.fromEntries(['arm64','x64'].map(arch=>[arch,{url:`https://github.com/saf1102/opentake-standard/releases/download/${tag}/${dmgName('1.1.3',arch)}`,sha256:'A'.repeat(64),size:400}])),...over});
test('Mac feed only accepts this release’s own DMGs',()=>{
 assert.equal(endpoint,'https://github.com/saf1102/opentake-standard/releases/latest/download/mac-update.json');
 const ok=macRelease(feed());assert.equal(ok.tag,tag);assert.equal(ok.installers.arm64.sha256,'a'.repeat(64));
 for(const bad of [{platform:'win32'},{schemaVersion:2},{version:'1.1'},{desktopBuild:0},{notes:'x'.repeat(16001)},{installers:{arm64:feed().installers.arm64}}])assert.equal(macRelease(feed(bad)),null);
 const other=feed();other.installers.x64.url=other.installers.x64.url.replace(tag,'desktop-v1.1.2-2026110901');assert.equal(macRelease(other),null);
 const evil=feed();evil.installers.arm64.url='https://example.com/'+dmgName('1.1.3','arm64');assert.equal(macRelease(evil),null);
 const sized=feed();sized.installers.arm64.size=0;assert.equal(macRelease(sized),null);
});
test('loopback test origin is accepted only when explicitly given',()=>{
 const local=feed();for(const arch of ['arm64','x64'])local.installers[arch].url=`http://127.0.0.1:4555/${dmgName('1.1.3',arch)}`;
 assert.equal(macRelease(local),null);assert.ok(macRelease(local,'http://127.0.0.1:4555'));assert.equal(macRelease(local,'http://127.0.0.1:4556'),null);assert.equal(macRelease(local,'http://example.com'),null);
});
test('installer for this chip and newer build comparison',()=>{
 const r=macInstallerRelease(macRelease(feed()),'x64');assert.deepEqual(Object.keys(r).sort(),['arch','desktopBuild','kind','notes','sha256','size','url','version'].sort());assert.equal(r.arch,'x64');assert.match(r.url,/mac-x64\.dmg$/);
 assert.equal(macInstallerRelease(macRelease(feed()),'ia32'),null);
 assert.equal(newerBuild({version:'1.1.3',desktopBuild:1},'1.1.2',99),true);assert.equal(newerBuild({version:'1.1.3',desktopBuild:5},'1.1.3',5),false);assert.equal(newerBuild({version:'1.1.3',desktopBuild:6},'1.1.3',5),true);assert.equal(newerBuild({version:'1.1.2',desktopBuild:9},'1.1.10',1),false);
});
