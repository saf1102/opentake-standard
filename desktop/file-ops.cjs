const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');

// Existing callers are synchronous read/modify/write transactions. Bound Windows
// sharing-violation retries without yielding between reading and replacing JSON.
const waits=[15,30,50,90,140,220];
const sleeper=new Int32Array(new SharedArrayBuffer(4));
function retrySync(operation){
 for(let attempt=0;;attempt++){
  try{return operation()}catch(error){
   if(process.platform!=='win32'||!['EBUSY','EPERM','EACCES','ENOTEMPTY'].includes(error.code)||attempt>=waits.length)throw error;
   Atomics.wait(sleeper,0,0,waits[attempt]);
  }
 }
}
function fileError(error,operation,target,extra={}){
 // Native rmSync's Windows error text can use the ANSI code page. Preserve the
 // original JS Unicode path rather than displaying that converted error string.
 const result=new Error(`${operation}失败（${error.code||'UNKNOWN'}）：${target}`,{cause:error});
 Object.assign(result,{code:error.code,syscall:error.syscall,path:target},extra);
 return result;
}
function renameWithRetrySync(from,to){
 try{return retrySync(()=>fs.renameSync(from,to))}catch(error){throw fileError(error,'重命名',to,{source:from,dest:to})}
}
function atomicWriteFileSync(file,data,options={}){
 fs.mkdirSync(path.dirname(file),{recursive:true});
 const temp=`${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
 try{
  fs.writeFileSync(temp,data,{...options,flag:'wx'});
  renameWithRetrySync(temp,file);
 }catch(error){
  // Do not delete the original or the recoverable new bytes when replacement
  // fails. In particular, cleanup must never mask the first write/rename error.
  const recoveryFile=fs.existsSync(temp)?temp:undefined;
  const wrapped=fileError(error,'保存文件',file,{recoveryFile});
  if(recoveryFile)wrapped.message+=`；未覆盖原文件，待恢复数据：${recoveryFile}`;
  throw wrapped;
 }
}
function atomicJsonSync(file,value,options={}){
 const {indent=2,...writeOptions}=options;
 return atomicWriteFileSync(file,JSON.stringify(value,null,indent),writeOptions);
}
function removeWithRetrySync(target,options={}){
 try{return retrySync(()=>{
  if(options.recursive)return fs.rmSync(target,{...options,maxRetries:0});
  try{return fs.unlinkSync(target)}catch(error){if(options.force&&error.code==='ENOENT')return;throw error}
 })}catch(error){throw fileError(error,'清理文件',target)}
}
function cleanupPathSync(target,options={}){
 try{removeWithRetrySync(target,{force:true,...options});return undefined}catch(error){
  // Cleanup is secondary. Keep the artifact and leave a diagnostic, while the
  // task's original error/completed output remains the authoritative result.
  console.warn(`[OpenTake cleanup] ${error.message}`);
  return error;
 }
}
module.exports={retrySync,renameWithRetrySync,atomicWriteFileSync,atomicJsonSync,removeWithRetrySync,cleanupPathSync};
