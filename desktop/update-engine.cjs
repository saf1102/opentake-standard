const {allowedSource}=require('./update-source.cjs');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
/** All destructive operations are restricted to a designated Standard app, never source/profile/project trees. */
async function install({target,candidate,backups,signal,launch,healthy,stop,progress=()=>{}}){
 if(path.basename(target)!=='OpenTake Standard.app'||path.basename(candidate)!=='OpenTake Standard.app'||target===candidate)throw Error('更新目标不是 Standard App');
 const id=crypto.randomUUID(),rollback=target+'.rollback-'+id,staged=target+'.new-'+id;
 fs.mkdirSync(backups,{recursive:true});const backup=path.join(backups,'standard-'+id+'.app');
 const check=()=>{if(signal?.aborted)throw Error('更新已取消')};check();
 fs.cpSync(candidate,staged,{recursive:true,errorOnExist:true,force:false,verbatimSymlinks:true});
 let moved=false,started;
 try{
  check();fs.cpSync(target,backup,{recursive:true,errorOnExist:true,force:false,verbatimSymlinks:true});check();
  fs.renameSync(target,rollback);moved=true;fs.renameSync(staged,target);progress(3);
  started=await launch(target);if(!await healthy(started))throw Error('新版启动自检失败');check();
  fs.rmSync(rollback,{recursive:true,force:true});moved=false;
  const entries=fs.readdirSync(backups).filter(n=>/^standard-[a-f0-9-]{36}\.app$/.test(n)).map(n=>({n,t:fs.statSync(path.join(backups,n)).mtimeMs})).sort((a,b)=>b.t-a.t);
  for(const e of entries.slice(2))fs.rmSync(path.join(backups,e.n),{recursive:true,force:true});
 }catch(e){if(started)await stop(started);if(moved){fs.rmSync(target,{recursive:true,force:true});fs.renameSync(rollback,target);await launch(target,true)}else if(fs.existsSync(target))await launch(target,true);throw e}
 finally{fs.rmSync(staged,{recursive:true,force:true})}
}
/** Streams one installer to disk while hashing; size and SHA-256 must both match before anything is opened. */
async function download({release,dest,signal,testOrigin,fetcher=fetch,progress=()=>{}}){
 if(!allowedSource(release.url,testOrigin)||!/^[a-f0-9]{64}$/i.test(release.sha256)||!Number.isSafeInteger(release.size)||release.size<1)throw Error('无效更新清单');
 const r=await fetcher(release.url,{signal,credentials:'omit',referrerPolicy:'no-referrer'});if(!r.ok||!r.body)throw Error('下载失败（HTTP '+r.status+'），旧版未改动');
 const digest=crypto.createHash('sha256');const fd=fs.openSync(dest,'wx',0o600);let size=0;
 try{for await(const chunk of r.body){if(signal?.aborted)throw Error('更新已取消');const b=Buffer.from(chunk);size+=b.length;if(size>release.size)throw Error('下载大小不符，旧版未改动');digest.update(b);fs.writeSync(fd,b);progress(0,{downloadedBytes:size,totalBytes:release.size})}}
 finally{fs.closeSync(fd)}
 progress(1,{downloadedBytes:size,totalBytes:release.size});
 if(size!==release.size)throw Error('下载大小不符，旧版未改动');
 if(digest.digest('hex')!==release.sha256.toLowerCase())throw Error('SHA-256 不一致，旧版未改动');
 return dest;
}
/** Download, verify, then let the platform unpack/inspect the installer. Never touches the running app. */
async function prepare({release,work,signal,testOrigin,fetcher=fetch,unpack,progress=()=>{}}){
 fs.mkdirSync(work,{recursive:true});progress(0);
 const name=path.basename(new URL(release.url).pathname);if(!/^OpenTake-Standard-[\w.-]+\.(dmg|exe)$/.test(name))throw Error('无效更新清单');
 const file=await download({release,dest:path.join(work,name),signal,testOrigin,fetcher,progress});
 if(signal?.aborted)throw Error('更新已取消');progress(2);return unpack(file,signal);
}
module.exports={prepare,download,install,hash};
