import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {settingsFile,projectPathOverridden,legacyProjectsRoot} from '../system-settings.ts';
export const migrationHome=()=>projectPathOverridden()?path.join(legacyProjectsRoot(),'.project-migrations'):path.join(path.dirname(settingsFile()),'project-migrations');
export function durableJson(file:string,value:unknown){fs.mkdirSync(path.dirname(file),{recursive:true});const tmp=file+'.'+crypto.randomUUID()+'.tmp';const fd=fs.openSync(tmp,'wx',0o600);try{fs.writeFileSync(fd,JSON.stringify(value,null,2));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}fs.renameSync(tmp,file);}
export type Placement={id:string;dir:string;previous:string[];aliases?:Record<string,string>;project:Record<string,unknown>;removed?:boolean};
let cached:{key:string;value:Record<string,Placement>}|undefined;
export function placements():Record<string,Placement>{const file=path.join(migrationHome(),'locations.json');if(!fs.existsSync(file))return {};const st=fs.statSync(file),key=`${file}:${st.ino}:${st.mtimeMs}:${st.size}`;if(cached?.key===key)return cached.value;const value=JSON.parse(fs.readFileSync(file,'utf8'));cached={key,value};return value;}
function offlineSummary(project:Record<string,unknown>){const p=project as unknown as import('../../src/types/editor.ts').EditProject;return {schemaVersion:p.schemaVersion,id:p.id,name:p.name,revision:p.revision,createdAt:p.createdAt,updatedAt:p.updatedAt,archivedAt:p.archivedAt,deletedAt:p.deletedAt,settings:p.settings,timeline:{duration:p.timeline.duration,fps:p.timeline.fps,playhead:0,tracks:p.timeline.tracks.map(t=>({id:t.id,kind:t.kind,clips:t.clips.map(c=>({id:c.id,start:c.start,duration:c.duration}))}))},media:p.media.map(m=>({id:m.id,name:m.name,type:m.type,status:m.status})),timelineVersions:[]};}

export function setPlacement(p:Placement){const all={...placements()};all[p.id]={...p,project:offlineSummary(p.project)};durableJson(path.join(migrationHome(),'locations.json'),all);}
export function relocatedDirectory(id:string,oldDir:string,newDir:string,project?:unknown){const p=placements()[id];if(p&&p.dir===oldDir)setPlacement({...p,dir:newDir,...(project?{project:project as Record<string,unknown>}: {})});}
export function excludedMigrationSource(dir:string){return Object.values(placements()).some(p=>p.previous.includes(dir));}
export function migrationBackupRoots(){return Object.values(placements()).filter(p=>!p.removed).map(p=>path.join(p.dir,'.migration-backups'));}
export function migrationRunning(){const file=path.join(migrationHome(),'running.json');if(!fs.existsSync(file))return false;const v=JSON.parse(fs.readFileSync(file,'utf8'));try{process.kill(v.pid,0);return true;}catch(e){if((e as NodeJS.ErrnoException).code!=='ESRCH')return true;return false;}}
export function assertNoMigration(){if(migrationRunning())throw Error('工程迁移正在进行，请暂停或等待迁移完成后再编辑、生成或管理存储');}

/** Old snapshots remain usable even when created between preflight and copying. */
export function relocatedReferences(value:unknown,id:string,sourceDir:string,key=''):unknown{
 const aliases=placements()[id]?.aliases;if(!aliases)return value;
 if(Array.isArray(value))return value.map(v=>relocatedReferences(v,id,sourceDir,key));
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,relocatedReferences(v,id,sourceDir,k)]));
 if(typeof value!=='string'||!/(?:file|files|path|paths|src|url)$/i.test(key)||/^(?:https?:|data:|blob:)/i.test(value))return value;
 let file=value;try{if(file.startsWith('file://'))file=decodeURIComponent(new URL(file).pathname)}catch{return value}
 return aliases[path.resolve(sourceDir,file)]||value;
}
