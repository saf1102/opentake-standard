import type { ExportJob } from '../types/editor.ts';
export function exportTime(job:ExportJob,now:number){
 const terminal=['completed','failed','cancelled'].includes(job.status);
 const started=job.stages?.filter(stage=>stage.phase==='preparing').at(-1)?.startedAt ?? job.createdAt;
 const elapsed=Math.max(0,(terminal?job.updatedAt:now)-started);
 const measured=Math.max(0,job.updatedAt-started);
 // Overall progress is phase-weighted; expose a rounded estimate, never a precise promise.
 const fresh=!terminal&&job.status==='running'&&now-job.updatedAt<60000;
 const remaining=fresh&&job.estimatedRemainingSeconds!==undefined
  ?Math.max(1000,job.estimatedRemainingSeconds*1000-(now-job.updatedAt))
  :fresh&&job.progress>=5&&job.progress<100&&measured>=30000
   ?Math.max(1000,measured*(100-job.progress)/job.progress-(now-job.updatedAt)):null;
 return {elapsed,remaining,terminal};
}
export function exportElapsedLabel(ms:number){
 const seconds=Math.floor(ms/1000),h=Math.floor(seconds/3600),m=Math.floor(seconds%3600/60),s=seconds%60;
 return `${h?`${h}:`:''}${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}
export function exportRemainingLabel(ms:number){return ms<60000?'不足 1 分钟':`约 ${Math.ceil(ms/60000)} 分钟`;}
