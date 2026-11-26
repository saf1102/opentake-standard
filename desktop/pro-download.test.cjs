const test=require('node:test'),assert=require('node:assert/strict');
const http=require('node:http');
const {installProDownload}=require('./pro-download.cjs');
const official=new URL(require('../upgrade.json').endpoint).origin;

for(const [platform,arch,target,filename] of [
 ['darwin','arm64','darwin-arm64','OpenTake-Pro-1.2.3-arm64-mac.zip'],
 ['win32','x64','win32-x64','OpenTake-Pro-1.2.3-win32-x64-installer.exe'],
])test(platform+' 主进程只打开经过校验的本平台正式安装包，错误可重试',async t=>{
 let handler,location,status=302,error='',calls=0,openFailure=false;
 const opened=[];
 const server=http.createServer((req,res)=>{
  calls++;assert.equal(req.url,'/api/upgrade/download');
  if(status===302)res.writeHead(302,{location});else res.writeHead(status,{'Content-Type':'application/json'});
  res.end(JSON.stringify({error}));
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(()=>new Promise(resolve=>server.close(resolve)));
 installProDownload({ipcMain:{handle:(name,fn)=>{assert.equal(name,'standard:pro-download');handler=fn}},
  trusted:event=>event==='main',getOrigin:()=>'http://127.0.0.1:'+server.address().port,platform,arch,
  shell:{openExternal:async url=>{if(openFailure)throw Error();opened.push(url)}}});
 const valid=official+'/releases/'+filename+'?platform='+target+'&expires='+(Date.now()+300000)+'&nonce='+'n'.repeat(16)+'&signature='+'s'.repeat(43);
 assert.ok((await handler('subframe')).error);assert.ok((await handler('main','https://example.test')).error);assert.equal(calls,0);
 for(location of [valid.replace(official,'https://other.example.test'),valid.replace('https:','http:'),valid.replace(filename,'OpenTake-Pro-1.2.3-from-1.0.0.zip'),valid.replace('platform='+target,'platform=linux-x64'),valid.replace(/expires=\d+/,'expires=1'),valid+'&extra=1']){
  assert.ok((await handler('main')).error);assert.equal(opened.length,0);
 }
 for(status of [409,503]){error='后台尚未提供 '+target+' 安装包';assert.deepEqual(await handler('main'),{error});}
 status=302;location=valid;openFailure=true;assert.match((await handler('main')).error,/浏览器/);openFailure=false;
 assert.deepEqual(await handler('main'),{ok:true});assert.deepEqual(opened,[valid]);
 if(platform==='darwin'){
  location=valid.replace('arm64-mac.zip','arm64.dmg');assert.deepEqual(await handler('main'),{ok:true});
 }
});

test('旧来源回执仍可使用，新回执校验离线智能体和许可全文',async t=>{
 const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
 const {receiptMatches}=require('./client-update.cjs');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'builtin-receipt-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const receipt={repository:'saf1102/opentake-standard',version:'1.1.4',files:{}};
 const save=()=>fs.writeFileSync(path.join(dir,'release-source.json'),JSON.stringify(receipt));
 save();assert.ok(receiptMatches(dir,receipt.version));
 receipt.files['desktop/builtin-agent/agent.mjs']='source-only';
 save();assert.equal(receiptMatches(dir,receipt.version),false);
 const out=path.join(dir,'desktop/builtin-runtime');fs.mkdirSync(out,{recursive:true});
 receipt.builtinRuntime={};
 for(const name of ['agent.mjs','THIRD-PARTY-NOTICES.txt']){
  fs.writeFileSync(path.join(out,name),name);
  receipt.builtinRuntime[name]=crypto.createHash('sha256').update(name).digest('hex');
 }
 save();assert.ok(receiptMatches(dir,receipt.version));fs.appendFileSync(path.join(out,'agent.mjs'),'changed');
 assert.equal(receiptMatches(dir,receipt.version),false);
});

test('隔离预加载拒绝传入地址，正常按钮只发送固定通道名',async()=>{
 const vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
 let bridge;const calls=[];
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'preload.cjs'),'utf8'),{require:id=>{
  assert.equal(id,'electron');return {contextBridge:{exposeInMainWorld:(_,api)=>{bridge=api}},ipcRenderer:{invoke:(...args)=>{calls.push(args);return Promise.resolve({ok:true})}}}
 }});
 assert.ok((await bridge.downloadPro('https://example.test')).error);assert.equal(calls.length,0);
 assert.ok((await bridge.downloadPro()).ok);assert.deepEqual(calls,[['standard:pro-download']]);
});
