import fs from 'node:fs';
import path from 'node:path';
import {execFile, type ExecFileOptions} from 'node:child_process';

/** Decode once after a pipe closes: chunk boundaries may split a Chinese UTF-8 character. */
export function decodeExportOutput(data:Buffer|string):string {
 if(typeof data==='string')return data;
 try{return new TextDecoder('utf-8',{fatal:true}).decode(data)}catch{return new TextDecoder('gb18030').decode(data)}
}
export function redactExportDiagnostic(text:string):string {
 return text.replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g,'[redacted private key]')
  .replace(/\bBearer\s+[^\s"'<>]+/gi,'Bearer [redacted]')
  .replace(/((?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|authorization)["']?\s*[:=]\s*["']?)[^\s,"'}&]+/gi,'$1[redacted]')
  .replace(/\bsk-[A-Za-z0-9_-]{12,}/g,'[redacted key]');
}
export function exportDiagnostic(event:Record<string,unknown>,file=process.env.OPENTAKE_EXPORT_DIAGNOSTICS) {
 if(!file)return;
 try{fs.mkdirSync(path.dirname(file),{recursive:true});fs.appendFileSync(file,JSON.stringify({at:new Date().toISOString(),pid:process.pid,...event},(_key,value)=>typeof value==='string'?redactExportDiagnostic(value):value)+'\n','utf8')}
 catch{/* Diagnostics must not turn an otherwise valid export into a failure. */}
}
export function runExportTool(file:string,args:string[],options:ExecFileOptions={}):Promise<{stdout:string;stderr:string}> {
 const started=Date.now();exportDiagnostic({event:'tool-start',file,args});
 return new Promise((resolve,reject)=>{
  execFile(file,args,{...options,windowsHide:true,encoding:'buffer'},(error,stdout,stderr)=>{
   const out=decodeExportOutput(stdout),err=decodeExportOutput(stderr);
   exportDiagnostic({event:'tool-exit',file,args,milliseconds:Date.now()-started,code:error?.code??0,signal:error?.signal??null,stderr:err,stack:error?.stack});
   if(error){const failure=new Error(`${path.basename(file)} 执行失败（${error.code??error.signal??'unknown'}）：${err.trim()||error.message}`);Object.assign(failure,{code:error.code,signal:error.signal,stderr:err,stdout:out,cause:error});reject(failure)}
   else resolve({stdout:out,stderr:err});
  });
 });
}
