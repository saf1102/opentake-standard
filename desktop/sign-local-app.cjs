// Standard local build only. No keychain identity lookup, private keys, notarization or system policy changes.
const fs=require('node:fs'),path=require('node:path');
const {spawnSync}=require('node:child_process');
const {createRequire}=require('node:module');
const ENTITLEMENTS=path.join(__dirname,'standard-entitlements.plist');
function validateApp(app){
 if(!path.isAbsolute(app)||path.basename(app)!=='OpenTake Standard.app')throw Error('只能检查或修复绝对路径下的 OpenTake Standard.app，不能修改 Pro 或其他应用。');
 if(fs.lstatSync(app).isSymbolicLink())throw Error('App 不能是符号链接，请指定本次实际构建目录。');
 const root=fs.realpathSync(app);
 if(!fs.statSync(root).isDirectory()||!fs.existsSync(path.join(root,'Contents/Info.plist')))throw Error('这不是完整的 Standard App，请重新运行 npm run build:app。');
 function walk(folder){for(const e of fs.readdirSync(folder,{withFileTypes:true})){
  const f=path.join(folder,e.name);
  if(e.isSymbolicLink()){const target=fs.realpathSync(f);if(target!==root&&!target.startsWith(root+path.sep))throw Error('App 内有指向外部的符号链接，拒绝清理或签名：'+path.relative(root,f));}
  else if(e.isDirectory())walk(f);
 }}walk(root);return root;
}
function command(file,args){
 const r=spawnSync(file,args,{encoding:'utf8',maxBuffer:64*1024*1024,timeout:300000});
 if(r.error||r.status!==0)throw Error(`${path.basename(file)} ${args[0]} 失败：${r.error?.message||r.stderr?.trim()||r.stdout?.trim()||'退出码 '+r.status}`);
 return r.stdout||'';
}
function repairCommand(app){return 'node desktop/sign-local-app.cjs '+"'"+app.replaceAll("'","'\\''")+"'";}
function verifyLocalApp(app,{run=command}={}){
 const target=validateApp(app);
 run('/usr/bin/codesign',['--verify','--deep','--strict',target]);
 const attrs=run('/usr/bin/xattr',['-lr',target]);
 if(/com\.apple\.quarantine(?::|\s)/.test(attrs))throw Error('App 仍带隔离标记，不能当作构建完成。请运行：'+repairCommand(target));
 return {ok:true,app:target,signatureStrict:true,quarantineClear:true};
}
async function signLocalApp(app,{run=command,sign}={}){
 const target=validateApp(app);
 try{
  // Do this after assembly/renaming/Info.plist edits and before the final seal.
  run('/usr/bin/xattr',['-cr',target]);
  if(!sign){const dependency=createRequire(require.resolve('electron-builder/package.json'));sign=dependency('@electron/osx-sign').signAsync;}
  // Same signer and runtime entitlements used by Pro. osx-sign signs nested code inside out.
  // identityValidation:false avoids consulting a signing identity/keychain; '-' is local ad-hoc.
  await sign({app:target,platform:'darwin',identity:'-',identityValidation:false,type:'development',
   preAutoEntitlements:false,preEmbedProvisioningProfile:false,strictVerify:true,
   optionsForFile:()=>({entitlements:ENTITLEMENTS,hardenedRuntime:true,timestamp:'none',additionalArguments:['--generate-entitlement-der']})});
  return {...verifyLocalApp(target,{run}),signature:'adhoc',hardenedRuntime:true,notarized:false};
 }catch(e){throw Error('Standard 本机 App 签名未完成，不能打开或交付此产物。请保留构建日志，确认使用 Apple 芯片 Mac 并已安装锁定依赖，再重跑 npm run build:app。原因：'+e.message);}
}
function diagnoseLocalApp(app,{run=command}={}){
 if(!fs.existsSync(app))return {ok:true,state:'not-built',message:'尚未生成本机 App；npm run build:app 会清理隔离标记、临时签名并严格校验。'};
 try{return {...verifyLocalApp(app,{run}),state:'ready',message:'本机 App：严格签名校验通过，无隔离标记（本机临时签名，不代表苹果公证）。'};}
 catch(e){return {ok:false,state:'damaged',message:'本机 App 可能提示「已损坏」：'+e.message,repair:repairCommand(app)};}
}
module.exports={signLocalApp,verifyLocalApp,diagnoseLocalApp,validateApp,repairCommand};
if(require.main===module){
 if(process.platform!=='darwin'){console.error('本机临时签名仅支持 macOS。');process.exitCode=1;}
 else signLocalApp(process.argv[2]||'').then(r=>console.log(JSON.stringify(r,null,2))).catch(e=>{console.error(e.message);process.exitCode=1;});
}
