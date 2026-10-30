import {migrationBackupRoots,placements,relocatedReferences} from './migration-state.ts';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {readSystemSettings,validateDirectory,defaultProjectRoot} from '../system-settings.ts';
import {EditProjectSchema} from '../../src/types/editor.ts';
const failures=new Map<string,string>();
export const backupFailures=()=>[...failures].map(([projectId,error])=>({projectId,error}));
const validId=(id:string)=>/^[a-zA-Z0-9_-]+$/.test(id);
const hash=(text:string)=>crypto.createHash('sha256').update(text).digest('hex');
type RecordingFile={path:string;text:string;sha256:string};
function recordingFiles(dir:string):RecordingFile[]{
 const base=path.join(dir,'analysis','openscreen'),out:RecordingFile[]=[];
 const visit=(folder:string)=>{if(!fs.existsSync(folder))return;for(const item of fs.readdirSync(folder,{withFileTypes:true})){if(item.isSymbolicLink()||item.name.startsWith('._')||item.name==='editor-lock.json')continue;const file=path.join(folder,item.name);if(item.isDirectory())visit(file);else if(item.isFile()&&/\.(json|openscreen)$/.test(item.name)){const text=fs.readFileSync(file,'utf8');out.push({path:path.relative(dir,file),text,sha256:hash(text)});}}};visit(base);return out;
}
function checkedRecordingFiles(value:unknown):RecordingFile[]{
 if(value===undefined)return [];if(!Array.isArray(value))throw Error('录屏备份格式无效');
 return value.map((item:RecordingFile)=>{if(!item||typeof item.path!=='string'||!item.path.startsWith('analysis/openscreen/')||item.path.split('/').includes('..')||path.isAbsolute(item.path)||typeof item.text!=='string'||hash(item.text)!==item.sha256)throw Error('录屏备份校验失败');return item;});
}
function root(){const folder=readSystemSettings().preferences.paths.backups;if(!folder)throw Error('未设置备份目录');if(!fs.existsSync(folder)){const parts=path.resolve(folder).split(path.sep);if(parts[1]==='Volumes'&&(!parts[2]||!fs.existsSync(path.join(path.parse(folder).root,parts[1],parts[2]))))throw Error('备份所在硬盘未连接，请先连接原硬盘');fs.mkdirSync(folder,{recursive:true});}validateDirectory(folder);return folder;}
export function backupProjectFile(dir:string,force=false){
 const config=readSystemSettings().preferences.backup;if(!force&&!config.automatic)return;
 const text=fs.readFileSync(path.join(dir,'project.json'),'utf8'),project=JSON.parse(text);if(!validId(project.id))throw Error('工程 ID 无效');
 const folder=path.join(root(),'snapshots',project.id);fs.mkdirSync(folder,{recursive:true});
 const files=fs.readdirSync(folder).filter(f=>/^\d+-[a-f0-9-]+\.json$/.test(f)).sort().reverse();
 if(!force&&files[0]&&Date.now()-Number(files[0].split('-')[0])<config.intervalMinutes*60000)return;
 const id=`${Date.now()}-${crypto.randomUUID()}`,file=path.join(folder,id+'.json'),temp=file+'.tmp';
 const value={version:1,id,createdAt:Date.now(),projectId:project.id,name:project.name,sourceDir:dir,sha256:hash(text),text,...(process.platform==='darwin'?{recordingFiles:recordingFiles(dir)}:{})};
 try{fs.writeFileSync(temp,JSON.stringify(value),{mode:0o600});fs.renameSync(temp,file);}finally{fs.rmSync(temp,{force:true});}
 failures.delete(project.id);
 for(const old of files.slice(config.keep-1)){const candidate=path.join(folder,old);if(fs.lstatSync(candidate).isFile())fs.unlinkSync(candidate);}
 return id;
}
export function autoBackup(dir:string){try{backupProjectFile(dir);}catch(e){try{failures.set(JSON.parse(fs.readFileSync(path.join(dir,'project.json'),'utf8')).id,String(e));}catch{/* Unreadable project identity: report the original backup failure below. */}console.warn('[backup]',String(e));}}
export function listBackups(strict=false){
 const settings=readSystemSettings();const roots=[...new Set([...migrationBackupRoots(),settings.preferences.paths.backups,...settings.backupRoots])];const rows:{id:string;projectId:string;name:string;createdAt:number;bytes:number;root:string}[]=[];
 for(const root of roots){const base=path.join(root,'snapshots');if(!fs.existsSync(base))continue;for(const id of fs.readdirSync(base)){if(!validId(id))continue;const folder=path.join(base,id);if(!fs.lstatSync(folder).isDirectory())continue;
 for(const file of fs.readdirSync(folder)){if(!/^\d+-[a-f0-9-]+\.json$/.test(file))continue;try{const target=path.join(folder,file);if(!fs.lstatSync(target).isFile())continue;const item=JSON.parse(fs.readFileSync(target,'utf8'));if(item.version!==1||item.projectId!==id||hash(item.text)!==item.sha256)throw Error('备份校验失败：'+target);checkedRecordingFiles(item.recordingFiles);rows.push({id:item.id,projectId:id,name:item.name,createdAt:item.createdAt,bytes:fs.statSync(target).size,root});}catch(e){if(strict)throw e}}
 }}return rows.filter((row,i)=>rows.findIndex(r=>r.id===row.id)===i).sort((a,b)=>b.createdAt-a.createdAt);
}
export async function restoreBackup(id:string){
 const entry=listBackups().find(e=>e.id===id);if(!entry)throw Error('备份不存在或校验失败');
 if(placements()[entry.projectId]&&!fs.existsSync(placements()[entry.projectId].dir))throw Error('工程所在硬盘未连接，请先连接再恢复');
 const item=JSON.parse(fs.readFileSync(path.join(entry.root,'snapshots',entry.projectId,id+'.json'),'utf8'));
 const recordings=checkedRecordingFiles(item.recordingFiles);
 const {findProject,save,dirs,scan}=await import('./store.ts');
 let sourceDir=item.sourceDir;try{sourceDir=findProject(entry.projectId,true).dir;}catch{/* No live placement: retain the snapshot source directory. */}
 const original=EditProjectSchema.parse(relocatedReferences(JSON.parse(item.text),entry.projectId,item.sourceDir));
 for(const media of original.media)if(!fs.existsSync(path.resolve(sourceDir,media.originalFile)))throw Error('原素材缺失，无法恢复：'+media.name);
 validateDirectory(defaultProjectRoot());const names=new Set(scan(true).map(p=>p.project.name));let name=original.name.slice(0,50)+' · 恢复副本',n=2;while(names.has(name)||fs.existsSync(path.join(defaultProjectRoot(),name)))name=original.name.slice(0,50)+' · 恢复副本 '+n++;
 const dir=path.join(defaultProjectRoot(),name);
 // Restore separately; never overwrite an open editor.
 const pathKeys=new Set(['originalFile','proxyFile','clearProxyFile','thumbnailFile','filmstripFile','waveformFile','cursorDataFile','openscreenProjectFile','rawProjectFile','relativePath','file','selectedFile','outputFile']);
 const rewrite=(value:unknown,key=''):unknown=>typeof value==='string'&&pathKeys.has(key)&&/^(?:(media|cache|exports)\/|\.{1,2}\/)/.test(value)?path.relative(dir,path.resolve(sourceDir,value)):Array.isArray(value)?value.map(v=>rewrite(v,key)):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([k,v])=>[k,rewrite(v,k)])):value;
 const restored=EditProjectSchema.parse(rewrite(original));restored.id=crypto.randomUUID();restored.name=name;restored.createdAt=Date.now();restored.revision=0;delete restored.deletedAt;delete restored.archivedAt;
 fs.mkdirSync(dir);dirs(dir);
 // Keep media and editable recording documents inside the recovered copy. This
 // also makes its media API independent of the source project's directory.
 try{
 if(process.platform==='darwin'&&(recordings.length||original.openScreenDocuments.length)){
  let index=0;const copied=new Map<string,string>();
  const ownMedia=(value:unknown,key=''):unknown=>{
   if(typeof value==='string'&&pathKeys.has(key)){const source=path.resolve(dir,value);if(fs.existsSync(source)&&fs.statSync(source).isFile()){let relative=copied.get(source);if(!relative){relative=path.join('media','originals',String(++index)+'-'+path.basename(source));fs.copyFileSync(source,path.join(dir,relative),fs.constants.COPYFILE_FICLONE);copied.set(source,relative);}return relative;}return value;}
   if(Array.isArray(value))return value.map(v=>ownMedia(v,key));if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,ownMedia(v,k)]));return value;
  };
  restored.media=ownMedia(restored.media) as typeof restored.media;
 }
 const analysis=path.join(sourceDir,'analysis');if(fs.existsSync(analysis))await fs.promises.cp(analysis,path.join(dir,'analysis'),{recursive:true,dereference:false,filter:file=>!fs.lstatSync(file).isSymbolicLink()});for(const file of recordings){const target=path.join(dir,file.path);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,file.text);}save(dir,restored);return restored;}
 catch(error){fs.rmSync(dir,{recursive:true,force:true});throw error;}
}
