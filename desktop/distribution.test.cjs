const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {OFFLINE_CHANNEL,distributionIdentity,distributionEnvironment,unsignedBuildEnvironment}=require('./distribution.cjs');
const {assetRoot}=require('./assets.cjs');
const {applicationMenu}=require('./menu.cjs');
test('offline metadata preserves the product name and separates runtime mode from visible branding',()=>{
 const normal=distributionIdentity({},'win32'),offline=distributionIdentity({opentakeDistribution:OFFLINE_CHANNEL},'win32');
 assert.equal(offline.APP_NAME,'OpenTake Standard');assert.equal(offline.APP_ID,normal.APP_ID);assert.equal(offline.IS_WINDOWS_OFFLINE,true);
 assert.equal(distributionIdentity({opentakeDistribution:OFFLINE_CHANNEL},'darwin').IS_WINDOWS_OFFLINE,false);
});
test('explicit QA overrides survive product defaults without modifying parent paths',()=>{
 const input={LINK_READER_PROJECTS_DIR:path.resolve('isolated-projects'),OPENSCREEN_USER_DATA_DIR:path.resolve('isolated-profile')};
 const result=distributionEnvironment(input,{bundled:true,profile:path.resolve('other'),videos:path.resolve('videos')});assert.deepEqual(result,input);
 const defaults=distributionEnvironment({}, {bundled:true,profile:path.resolve('profile'),videos:path.resolve('videos')});
 assert.equal(defaults.LINK_READER_PROJECTS_DIR,path.resolve('videos','OpenTake Standard Projects'));assert.equal(defaults.OPENSCREEN_USER_DATA_DIR,path.resolve('profile','openscreen'));
});
test('source mode leaves runtime environment untouched',()=>{const input={PATH:'existing'};assert.deepEqual(distributionEnvironment(input,{bundled:false}),input)});
test('Windows menus start with recording and keep about and quit discoverable',()=>{
 let opened=0;const recording={fixture:true},template=applicationMenu({platform:'win32',app:{showAboutPanel(){opened++}},recordingMenu:recording});
 assert.equal(template[0].label,'录制');assert.equal(template[0].submenu,recording);
 const about=template.at(-1).submenu[0];about.click();assert.equal(opened,1);assert.equal(template.at(-1).submenu.at(-1).role,'quit');
 assert.equal(applicationMenu({platform:'darwin',app:{},recordingMenu:recording})[0].label,'OpenTake Standard');
});
test('desktop artwork loads from the single built asset tree when public is absent',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'opentake-artwork-'));try{
  fs.mkdirSync(path.join(root,'dist'));assert.equal(assetRoot(root),path.join(root,'dist'));
  fs.mkdirSync(path.join(root,'public'));assert.equal(assetRoot(root),path.join(root,'public'));
 }finally{assert.equal(path.dirname(root),os.tmpdir());fs.rmSync(root,{recursive:true,force:true})}
});
test('installer edits icon/version resources without signing, and ships assets once',()=>{
 const c=require('./installer.builder.config.cjs');assert.equal(c.productName,'OpenTake Standard');assert.equal(c.appId,'top.opentake.standard');
 assert.equal(c.win.signAndEditExecutable,true);assert.equal(c.win.signExecutable,false);assert.equal(c.nsis.differentialPackage,false);assert.equal(c.compression,'maximum');assert.ok(c.files.includes('!public/**'));
 assert.equal(c.win.requestedExecutionLevel,'asInvoker');assert.equal(c.nsis.oneClick,false);assert.equal(c.nsis.perMachine,false);assert.equal(c.nsis.allowElevation,false);assert.equal(c.nsis.packElevateHelper,false);assert.equal(c.nsis.deleteAppDataOnUninstall,false);assert.equal(c.nsis.runAfterFinish,true);
});
test('unsigned packaging removes certificate inputs without altering the parent environment',()=>{
 const input={PATH:'existing',WIN_CSC_LINK:'dummy-test-value',CSC_KEY_PASSWORD:'dummy-test-value',CSC_IDENTITY_AUTO_DISCOVERY:'true'},result=unsignedBuildEnvironment(input);
 assert.equal(result.PATH,input.PATH);assert.equal(result.WIN_CSC_LINK,undefined);assert.equal(result.CSC_KEY_PASSWORD,undefined);assert.equal(result.CSC_IDENTITY_AUTO_DISCOVERY,'false');assert.equal(input.CSC_IDENTITY_AUTO_DISCOVERY,'true');
});
