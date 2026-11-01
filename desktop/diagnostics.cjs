const fs=require('node:fs');
const path=require('node:path');
const {redact}=require('../shared/redaction.mjs');
function recordServiceEvent(profile,event,details={}){
 if(!profile)return;
 try{
  const folder=path.join(profile,'diagnostics'),file=path.join(folder,'service-events.jsonl');
  fs.mkdirSync(folder,{recursive:true});
  // No prompts, environment dumps, account files or raw child output are logged.
  const entry={at:new Date().toISOString(),event,pid:process.pid,code:details.code,signal:details.signal,
   origin:details.origin,stage:['runtime','config','listening','ready'].includes(details.stage)?details.stage:undefined,error:details.error?{name:details.error.name,code:details.error.code,message:redact(details.error.message),stack:redact(details.error.stack)}:undefined};
  if(fs.existsSync(file)&&fs.statSync(file).size>1024*1024){try{fs.unlinkSync(file+'.previous')}catch{}fs.renameSync(file,file+'.previous');}
  fs.appendFileSync(file,JSON.stringify(entry)+'\n',{mode:0o600});
 }catch{/* Diagnostic I/O must never replace the actual application failure. */}
}
function installFatalDiagnostics(profile){
 const fatal=(error,origin)=>recordServiceEvent(profile,'fatal',{error,origin});
 const exited=code=>recordServiceEvent(profile,'service-exit',{code});
 // Monitor only: Node still exits on an unhandled fatal error. Do not continue
 // running after an unknown exception or silently restart the user's project.
 process.on('uncaughtExceptionMonitor',fatal);process.on('exit',exited);
 return ()=>{process.off('uncaughtExceptionMonitor',fatal);process.off('exit',exited)};
}
module.exports={redact,recordServiceEvent,installFatalDiagnostics};
