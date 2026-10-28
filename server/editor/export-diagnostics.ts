import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {processOwner} from '../proc.ts';
const sessions=new Map<string,{file:string;started:number;bytes:number;timer:ReturnType<typeof setInterval>;lastProgress:number}>();
/** Enabled by a packaged diagnostic capability or emergency marker. Logging never blocks export. */
export function startExportDiagnostics(token:string,jobId:string,settings:unknown){
 const marker=['export-diagnostics.json','emergency-patch.json'].map(f=>path.resolve(f)).find(f=>fs.existsSync(f));
 if(!marker)return;
 try{
  const dir=path.join(process.env.LINKREADER_DESKTOP_PROFILE||path.join(os.homedir(),'Library/Application Support/linkreader-desktop'),'export-diagnostics',`${jobId}-${Date.now()}`);
  fs.mkdirSync(dir,{recursive:true});
  const timer=setInterval(()=>exportDiagnostic('resources',{freeMemory:os.freemem(),loadAverage:os.loadavg(),nodeMemory:process.memoryUsage()},token),5000);timer.unref();
  sessions.set(token,{file:path.join(dir,'export.jsonl'),started:Date.now(),bytes:0,timer,lastProgress:0});
  exportDiagnostic('start',{jobId,settings,platform:process.platform,arch:process.arch,os:os.release(),cpu:os.cpus()[0]?.model,parallelism:os.availableParallelism(),totalMemory:os.totalmem(),patch:JSON.parse(fs.readFileSync(marker,'utf8'))},token);
 }catch(error){console.warn('[export diagnostics] unavailable',String(error));}
}
export function exportDiagnostic(event:string,data:unknown,token=processOwner.getStore()){
 if(!token)return;const s=sessions.get(token);if(!s||s.bytes>8*1024*1024)return;
 try{const line=JSON.stringify({time:new Date().toISOString(),elapsedMs:Date.now()-s.started,event,data})+'\n';fs.appendFileSync(s.file,line);s.bytes+=Buffer.byteLength(line);}catch{/* Diagnostic I/O must not fail media work. */}
}
export function exportDiagnosticProgress(data:unknown){const token=processOwner.getStore(),s=token&&sessions.get(token);if(!s||Date.now()-s.lastProgress<1000)return;s.lastProgress=Date.now();exportDiagnostic('progress',data,token);}
export function finishExportDiagnostics(token:string,result:unknown){const s=sessions.get(token);if(!s)return;exportDiagnostic('finish',result,token);clearInterval(s.timer);sessions.delete(token);}
