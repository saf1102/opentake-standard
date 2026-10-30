const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {signLocalApp,verifyLocalApp,diagnoseLocalApp}=require('./sign-local-app.cjs');
function fixture(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'standard-sign-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const app=path.join(dir,'OpenTake Standard.app');fs.mkdirSync(path.join(app,'Contents'),{recursive:true});fs.writeFileSync(path.join(app,'Contents/Info.plist'),'<plist/>');return {dir,app:fs.realpathSync(app)};}
test('assembly cleanup precedes local signing; strict verification and quarantine check are mandatory',async t=>{
 const {app}=fixture(t),calls=[];const run=(cmd,args)=>{calls.push([path.basename(cmd),...args]);return ''};
 const sign=async opts=>{calls.push(['sign']);assert.equal(opts.identity,'-');assert.equal(opts.identityValidation,false);assert.equal(opts.preAutoEntitlements,false);assert.equal(opts.preEmbedProvisioningProfile,false);assert.equal(opts.strictVerify,true);const per=opts.optionsForFile(app);assert.equal(per.hardenedRuntime,true);assert.equal(per.timestamp,'none');assert.deepEqual(per.additionalArguments,['--generate-entitlement-der']);const text=fs.readFileSync(per.entitlements,'utf8');for(const key of ['allow-jit','allow-unsigned-executable-memory','disable-library-validation'])assert(text.includes(key));};
 const r=await signLocalApp(app,{run,sign});assert.equal(r.signature,'adhoc');assert.equal(r.notarized,false);
 assert.deepEqual(calls,[['xattr','-cr',app],['sign'],['codesign','--verify','--deep','--strict',app],['xattr','-lr',app]]);
});
test('cleanup, signing, verification and residual quarantine failures cannot report success',async t=>{
 const {app}=fixture(t);
 for(const step of ['clear','sign','verify','quarantine']){let signed=false;const run=(cmd,args)=>{if(step==='clear'&&args[0]==='-cr')throw Error('属性无法清除');if(step==='verify'&&args[0]==='--verify')throw Error('code has no resources but signature indicates they must be present');return step==='quarantine'&&args[0]==='-lr'?'entry: com.apple.quarantine: 0083':''};
  await assert.rejects(signLocalApp(app,{run,sign:async()=>{signed=true;if(step==='sign')throw Error('签名失败')}}),/签名未完成/);if(step==='clear')assert.equal(signed,false);
 }
});
test('doctor distinguishes no build, good build and a damaged build, and never repairs automatically',t=>{
 const {app,dir}=fixture(t);assert.equal(diagnoseLocalApp(path.join(dir,'absent.app')).state,'not-built');const calls=[];
 const result=diagnoseLocalApp(app,{run:(_cmd,args)=>{calls.push(args);if(args[0]==='--verify')throw Error('invalid signature');return ''}});
 assert.equal(result.ok,false);assert.match(result.message,/已损坏/);assert.match(result.repair,/node desktop\/sign-local-app.cjs/);assert.equal(calls.length,1);
 assert.equal(diagnoseLocalApp(app,{run:()=>''}).state,'ready');
});
test('repair refuses Pro, root symlinks and nested links escaping the bundle before mutation',async t=>{
 const {app,dir}=fixture(t);let touched=false;const options={run:()=>{touched=true;return ''},sign:async()=>{touched=true}};
 await assert.rejects(signLocalApp(path.join(dir,'OpenTake.app'),options),/不能修改 Pro/);
 fs.symlinkSync(dir,path.join(app,'Contents/outside'));await assert.rejects(signLocalApp(app,options),/外部/);assert.equal(touched,false);
});
