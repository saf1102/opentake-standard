const {allowedSource}=require('./update-source.cjs');
const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process');
const {prepare,install}=require('./update-engine.cjs');const {killTree}=require('./platform.cjs');
const config=JSON.parse(fs.readFileSync(process.argv[2]));const abort=new AbortController();let active;
const begun=Date.now(),timings=[],groups=new Set();let lastStep=-1,lastAt=begun,lastWrite=0,bytes=0;const total=config.release.size;
const state=(step,status='running',error,extra={})=>{const now=Date.now();if(extra.downloadedBytes!==undefined)bytes=extra.downloadedBytes;const changed=step!==lastStep;if(changed){if(lastStep>=0)timings.push({step:lastStep,durationMs:now-lastAt});lastStep=step;lastAt=now;}if(status==='running'&&now-lastWrite<200&&!error&&!changed)return;lastWrite=now;const {downloadedBytes:_d,totalBytes:_t,...rest}=extra;const value={step,status,pid:process.pid,platform:config.platform,version:config.release.version,elapsedMs:now-begun,downloadedBytes:bytes,totalBytes:total,timings,...rest,...(error?{error}:{})};fs.writeFileSync(config.state+'.tmp',JSON.stringify(value));fs.renameSync(config.state+'.tmp',config.state);fs.writeFileSync(path.join(config.work,'result.json'),JSON.stringify(value,null,2));};
const progress=(step,details)=>state(step,'running',undefined,details);
const log=text=>fs.appendFileSync(path.join(config.work,'update.log'),String(text));
const timer=setInterval(()=>{if(fs.existsSync(config.cancel)){abort.abort();if(active?.pid)killTree(active.pid)}},300);
const run=(cmd,args)=>new Promise((resolve,reject)=>{if(abort.signal.aborted)return reject(Error('更新已取消'));let out='';active=spawn(cmd,args,{cwd:config.work,env:{...process.env,ELECTRON_RUN_AS_NODE:undefined},stdio:['ignore','pipe','pipe']});const child=active;groups.add(child.pid);log('\nCOMMAND '+cmd+' '+args.join(' ')+'\n');child.stdout.on('data',b=>{log(b);out+=b;if(out.length>262144)out=out.slice(-262144)});child.stderr.on('data',log);child.on('error',reject);child.on('exit',code=>{if(active===child)active=null;groups.delete(child.pid);code===0?resolve(out.trim()):reject(Error('准备新版失败（'+path.basename(cmd)+'）；旧版未改动，详情见更新日志。'))})});
// GitHub release assets redirect to their CDN; follow HTTPS redirects only and never send credentials.
const fetcher=async(url,options)=>{for(let i=0;i<6;i++){if(!allowedSource(url,config.testOrigin))throw Error('不允许的下载地址');const r=await fetch(url,{...options,redirect:'manual'});if(r.status>=300&&r.status<400){url=new URL(r.headers.get('location'),url).href;continue}return r}throw Error('重定向过多')};
const plist=(app,key)=>run('/usr/bin/plutil',['-extract',key,'raw',path.join(app,'Contents/Info.plist')]);
/** Copy the app out of the verified DMG, then check it is this product at the advertised version. */
async function unpackMac(dmg){
 const out=await run('/usr/bin/hdiutil',['attach','-nobrowse','-readonly','-noautoopen','-plist',dmg]);
 const mounts=[...out.matchAll(/<key>mount-point<\/key>\s*<string>([^<]+)<\/string>/g)].map(m=>m[1]);if(mounts.length!==1)throw Error('无法打开新版安装包，旧版未改动');
 const candidate=path.join(config.work,'candidate','OpenTake Standard.app');
 try{const source=path.join(mounts[0],'OpenTake Standard.app');if(!fs.existsSync(source))throw Error('安装包里没有 OpenTake Standard，旧版未改动');fs.mkdirSync(path.dirname(candidate));await run('/usr/bin/ditto',[source,candidate])}
 finally{await run('/usr/bin/hdiutil',['detach',mounts[0],'-force']).catch(()=>{})}
 if(await plist(candidate,'CFBundleShortVersionString')!==config.release.version)throw Error('新版版本号不符，旧版未改动');
 if(await plist(candidate,'CFBundleIdentifier')!==config.bundleId)throw Error('新版不是 OpenTake Standard，旧版未改动');
 await run('/usr/bin/codesign',['--verify','--deep','--strict',candidate]).catch(()=>{throw Error('新版签名校验失败，旧版未改动')});
 await run('/usr/bin/xattr',['-dr','com.apple.quarantine',candidate]).catch(()=>{});
 return candidate;
}
async function waitForExit(){for(let i=0;i<172800;i++){if(abort.signal.aborted)throw Error('更新已取消');try{process.kill(config.pid,0)}catch{return}await new Promise(r=>setTimeout(r,500))}throw Error('等待重启已超时，未替换')}
(async()=>{try{
 if(config.platform==='win32'){
  // The installer itself replaces the app after the user confirms restart; this worker only downloads and verifies it.
  const installer=await prepare({release:config.release,work:config.work,signal:abort.signal,testOrigin:config.testOrigin,fetcher,progress,unpack:async file=>file});
  state(2,'prepared',undefined,{installer});return;
 }
 const candidate=await prepare({release:config.release,work:config.work,signal:abort.signal,testOrigin:config.testOrigin,fetcher,progress,unpack:unpackMac});
 fs.rmSync(path.join(config.work,path.basename(new URL(config.release.url).pathname)),{force:true});
 state(3,'prepared'); // Wait for the user to confirm restart; never replace while the old app process is alive.
 await waitForExit();
 const ready=path.join(config.work,'ready.json');
 await install({target:config.target,candidate,backups:config.backups,signal:abort.signal,progress,
 launch:async(target,rollback)=>{fs.rmSync(ready,{force:true});const child=spawn(path.join(target,'Contents/MacOS/OpenTake Standard'),[],{env:{...process.env,ELECTRON_RUN_AS_NODE:undefined,OPENTAKE_STANDARD_USER_DATA:config.profile,...(!rollback?{OPENTAKE_UPDATE_READY:ready}:{OPENTAKE_UPDATE_READY:''})},detached:true,stdio:'ignore'});child.unref();return child;},
 healthy:async(child)=>{for(let i=0;i<120;i++){if(abort.signal.aborted)return false;if(child.exitCode!==null||child.signalCode!==null)return false;try{const v=JSON.parse(fs.readFileSync(ready));if(v.version===config.release.version&&v.pid===child.pid)return true}catch{}await new Promise(r=>setTimeout(r,500))}return false},
 stop:async(child)=>{if(!child.pid)return;const ended=()=>child.exitCode!==null||child.signalCode!==null;if(!ended())killTree(child.pid,'SIGTERM');for(let i=0;i<30&&!ended();i++)await new Promise(r=>setTimeout(r,100));if(!ended())killTree(child.pid,'SIGKILL');for(let i=0;i<30&&!ended();i++)await new Promise(r=>setTimeout(r,100));if(!ended())throw Error('新版进程尚未退出，保留回退副本，未覆盖运行中的 App')}});
 fs.rmSync(path.join(config.work,'candidate'),{recursive:true,force:true});state(3,'completed');
 }catch(e){for(const pid of groups){try{killTree(pid,'SIGKILL')}catch{}}try{for(const name of fs.readdirSync(config.work))if(/\.(dmg|exe)$/.test(name)||name==='candidate')fs.rmSync(path.join(config.work,name),{recursive:true,force:true})}catch{}const message=abort.signal.aborted?'更新已取消，旧版保留。':/fetch|terminated|network|socket|ECONNRESET/i.test(e.message)?'下载中断，请检查网络后重试；旧版未改动。':e.message;state(lastStep<0?0:lastStep,abort.signal.aborted?'cancelled':'failed',message)}finally{clearInterval(timer)}})();
