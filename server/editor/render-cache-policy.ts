import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

/** Cross-process guard: no history eviction while another export reads this project. */
export async function acquireExportCacheLease(projectDir:string) {
 const root=path.join(projectDir,'cache','.export-leases');fs.mkdirSync(root,{recursive:true});
 const gate=path.join(root,'.maintenance');
 const lease=path.join(root,`${process.pid}-${crypto.randomUUID()}.json`);
 const deadline=Date.now()+30000;
 for(;;){
  if(fs.existsSync(gate)){
   try{const pid=Number(fs.readFileSync(gate,'utf8'));if(Number.isInteger(pid)&&pid>0)try{process.kill(pid,0);}catch(e){if((e as NodeJS.ErrnoException).code==='ESRCH')fs.rmSync(gate,{force:true});}}catch{/* Keep the maintenance gate on unreadable identity; the existing timeout applies. */}
   if(Date.now()>deadline)throw Error('缓存维护正在进行，请稍后重试导出');
   await new Promise(r=>setTimeout(r,50));continue;
  }
  fs.writeFileSync(lease,JSON.stringify({pid:process.pid}));
  if(!fs.existsSync(gate))break;
  fs.rmSync(lease,{force:true});
 }
 const otherReaders=()=>fs.readdirSync(root).some(name=>{
  // Finder/ExFAT AppleDouble sidecars are metadata, never process leases.
  if(name==='.maintenance'||name.startsWith('._')||name==='.DS_Store')return false;
  const file=path.join(root,name);if(file===lease)return false;
  try{const {pid}=JSON.parse(fs.readFileSync(file,'utf8'));if(!Number.isInteger(pid)||pid<1)return true;
   try{process.kill(pid,0);return true;}catch(error){if((error as NodeJS.ErrnoException).code!=='ESRCH')return true;}
   fs.rmSync(file,{force:true});return false;
  }catch{return true;}
 });
 return {release:()=>fs.rmSync(lease,{force:true}),otherReaders,
  beginMaintenance:()=>{
   let fd:number;try{fd=fs.openSync(gate,'wx')}catch{throw Error('缓存维护正在进行')}
   fs.writeFileSync(fd,String(process.pid));fs.closeSync(fd);
   if(otherReaders()){fs.rmSync(gate,{force:true});throw Error('另一个导出正在使用缓存')}
   return ()=>fs.rmSync(gate,{force:true});
  },
  maintain:(operation:()=>void)=>{
   let fd:number;try{fd=fs.openSync(gate,'wx');}catch{return false;}
   try{fs.writeFileSync(fd,String(process.pid));if(otherReaders())return false;operation();return true;}
   finally{fs.closeSync(fd);fs.rmSync(gate,{force:true});}
  }
 };
}

/** Only exact generated MOV caches are eligible; current output and last successful set stay warm. */
export function pruneMotionCache(folder:string,currentFiles:string[],historyBudget=8*1024**3) {
 if(!fs.existsSync(folder))return 0;
 const index=path.join(folder,'.retained.json');
 const current=new Set(currentFiles.map(file=>path.basename(file)).filter(name=>/^[a-f0-9]{64}\.mov$/.test(name)));
 let previous:string[]=[];try{previous=JSON.parse(fs.readFileSync(index,'utf8')).current.filter((n:unknown)=>typeof n==='string');}catch{/* No valid retained index: keep the explicitly supplied current files. */}
 const retained=new Set([...current,...previous]);
 const candidates=fs.readdirSync(folder).filter(n=>/^[a-f0-9]{64}\.mov$/.test(n)&&!retained.has(n))
  .map(name=>({name,stat:fs.lstatSync(path.join(folder,name))})).filter(x=>x.stat.isFile()).sort((a,b)=>b.stat.mtimeMs-a.stat.mtimeMs);
 let kept=0,removed=0;
 for(const {name,stat} of candidates){if(kept+stat.size<=historyBudget){kept+=stat.size;continue;}fs.rmSync(path.join(folder,name));removed+=stat.size;}
 const temp=index+'.'+crypto.randomUUID()+'.tmp';fs.writeFileSync(temp,JSON.stringify({current:[...current]}));fs.renameSync(temp,index);
 return removed;
}
