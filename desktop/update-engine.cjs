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
  fs.renameSync(target,rollback);moved=true;fs.renameSync(staged,target);progress(4);
  started=await launch(target);if(!await healthy(started))throw Error('新版启动自检失败');check();
  fs.rmSync(rollback,{recursive:true,force:true});moved=false;
  const entries=fs.readdirSync(backups).filter(n=>/^standard-[a-f0-9-]{36}\.app$/.test(n)).map(n=>({n,t:fs.statSync(path.join(backups,n)).mtimeMs})).sort((a,b)=>b.t-a.t);
  for(const e of entries.slice(2))fs.rmSync(path.join(backups,e.n),{recursive:true,force:true});
 }catch(e){if(started)await stop(started);if(moved){fs.rmSync(target,{recursive:true,force:true});fs.renameSync(rollback,target);await launch(target,true)}else if(fs.existsSync(target))await launch(target,true);throw e}
 finally{fs.rmSync(staged,{recursive:true,force:true})}
}
async function prepare({release,work,signal,testOrigin,fetcher=fetch,extract,build,progress=()=>{}}){
 if(!allowedSource(release.url,testOrigin)||!/^[a-f0-9]{64}$/i.test(release.sha256))throw Error('无效更新清单');
 fs.mkdirSync(work,{recursive:true});progress(0);const r=await fetcher(release.url,{signal,credentials:'omit',referrerPolicy:'no-referrer',redirect:'error'});if(!r.ok)throw Error('下载失败');
 const parts=[];let size=0;for await(const b of r.body){size+=b.length;if(size>512*1024*1024)throw Error('源码包过大');if(signal?.aborted)throw Error('更新已取消');parts.push(b);progress(0,{downloadedBytes:size})}
 const bytes=Buffer.concat(parts);progress(1,{downloadedBytes:size});if(hash(bytes).toLowerCase()!==release.sha256.toLowerCase())throw Error('SHA-256 不一致，旧版未改动');
 const zip=path.join(work,'source.zip');fs.writeFileSync(zip,bytes);const source=await extract(zip,path.join(work,'source'));
 const pkg=JSON.parse(fs.readFileSync(path.join(source,'package.json')));if(pkg.name!=='opentake-standard'||pkg.version!==release.version)throw Error('源码版本或产品不匹配');
 if(signal?.aborted)throw Error('更新已取消');return build(source,progress,signal);
}
module.exports={prepare,install,hash};
