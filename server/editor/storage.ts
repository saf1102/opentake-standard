import {placements,excludedMigrationSource,relocatedReferences} from './migration-state.ts';
import {readScreenLock} from './openscreen-lock.ts';
import {listBackups} from './project-backups.ts';
import {allProjectCacheRoots} from './cache-location.ts';
import {projectRoots,legacyProjectsRoot,settingsFile,projectPathOverridden} from '../system-settings.ts';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {execFileAsync} from '../proc.ts';
import {rootDir, atomicJson, findProject, save, readLock} from './store.ts';
import {acquireExportCacheLease} from './render-cache-policy.ts';

const GiB=1024**3;
let rootMemo=new Map<string,string[]>();
const cachedRoots=(dir:string)=>{let roots=rootMemo.get(dir);if(!roots){roots=allProjectCacheRoots(dir);rootMemo.set(dir,roots)}return roots;};
const generated=new Set(['base-timeline','timeline-render','timeline-composite','motion-render','recording-motion','subtitle-render','chapter-plates','thumbnails','filmstrips','waveforms','audio-peaks','proxies']);
const preview=new Set(['thumbnails','filmstrips','waveforms','audio-peaks']);
const derived=new Set(['proxyFile','clearProxyFile','thumbnailFile','filmstripFile','waveformFile']);
export let storageBusy=false;
export const storageDefaults={renderBudgetGB:20,previewDays:30,temporaryDays:1,automatic:true};
export type StoragePolicy=typeof storageDefaults;
function canonical(file:string):string {try{return fs.realpathSync(file)}catch{const parent=path.dirname(file);return parent===file?file:path.join(canonical(parent),path.basename(file))}}
const policyFile=()=>path.join(projectPathOverridden()?rootDir():path.dirname(settingsFile()),'.storage-policy.json');
export function storagePolicy():StoragePolicy {try{return {...storageDefaults,...JSON.parse(fs.readFileSync(fs.existsSync(policyFile())?policyFile():path.join(legacyProjectsRoot(),'.storage-policy.json'),'utf8'))}}catch{return {...storageDefaults}}}
export function setStoragePolicy(value:StoragePolicy){
 if(!Number.isFinite(value.renderBudgetGB)||value.renderBudgetGB<1||value.renderBudgetGB>500||!Number.isInteger(value.previewDays)||value.previewDays<1||value.previewDays>365||typeof value.automatic!=='boolean')throw Error('缓存设置无效');
 const result={renderBudgetGB:value.renderBudgetGB,previewDays:value.previewDays,temporaryDays:1,automatic:value.automatic};atomicJson(policyFile(),result);return result;
}
type Entry={file:string;size:number;allocated:number;mtime:number;ino:number;dev:number;nlink:number};
async function walk(root:string, options:{skip?:Set<string>;accept?:(file:string)=>boolean}={}):Promise<Entry[]> {
 const result:Entry[]=[];
 const visit=async(dir:string)=>{
  let entries:fs.Dirent[];try{entries=await fs.promises.readdir(dir,{withFileTypes:true})}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return;throw e}
  for(const entry of entries){if(entry.isSymbolicLink())continue;const file=path.join(dir,entry.name);if(entry.isDirectory()){if(dir!==root||!options.skip?.has(entry.name))await visit(file)}else if(entry.isFile()&&(!options.accept||options.accept(file))){
   let s:fs.Stats;try{s=await fs.promises.lstat(file)}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')continue;throw e}if(!s.isFile())continue;result.push({file,size:s.size,allocated:s.blocks*512,mtime:s.mtimeMs,ino:s.ino,dev:s.dev,nlink:s.nlink});
  }}
 };if(fs.existsSync(root)&&!fs.lstatSync(root).isSymbolicLink())await visit(root);return result;
}
function projectDirs(){const dirs:string[]=[];for(const base of [...new Set([...projectRoots(),...Object.values(placements()).filter(p=>!p.removed).map(p=>path.basename(path.dirname(p.dir))==='.Trash'?path.dirname(path.dirname(p.dir)):path.dirname(p.dir))])].flatMap(root=>[root,path.join(root,'.Trash')])){
 if(!fs.existsSync(base))continue;for(const item of fs.readdirSync(base,{withFileTypes:true}))if(item.isDirectory()&&!item.name.startsWith('.')){const dir=path.join(base,item.name);if(!excludedMigrationSource(dir)&&fs.existsSync(path.join(dir,'project.json')))dirs.push(canonical(dir))}
 }return dirs;}
function rawProject(dir:string){return JSON.parse(fs.readFileSync(path.join(dir,'project.json'),'utf8'))}
const inode=(e:Entry)=>`${e.dev}:${e.ino}`;
function bytes(entries:Entry[]){const seen=new Set<string>();return entries.reduce((sum,e)=>{const k=inode(e);if(seen.has(k))return sum;seen.add(k);return sum+e.allocated},0)}
function category(dir:string,file:string){if(cachedRoots(dir).some(root=>file.startsWith(root+path.sep)))return 'cache';const rel=path.relative(dir,file).split(path.sep);if(rel[0]==='cache'||rel[0]==='media'&&rel[1]==='proxies')return 'cache';if(rel[0]==='media')return 'media';if(rel[0]==='exports'&&rel[1]!=='.jobs')return 'exports';return 'project';}
function cacheKind(dir:string,file:string){const root=cachedRoots(dir).find(root=>file.startsWith(root+path.sep));return root?path.relative(root,file).split(path.sep)[0]:path.relative(dir,file).split(path.sep)[1];}
function candidate(dir:string,e:Entry){return (cachedRoots(dir).some(root=>e.file.startsWith(root+path.sep))&&generated.has(cacheKind(dir,e.file))||e.file.startsWith(path.join(dir,'media','proxies')+path.sep))&&/\.(mp4|mov|webm|png|jpg|jpeg|wav|bin|peaks)$/i.test(e.file)&&!path.basename(e.file).startsWith('.');}
// Protect references in all projects, versions, snapshots and generated delivery
// manifests. Unrecognized caches remain untouched. External source files are never candidates.
async function references(dirs:string[],targets:string[]){
 const protectedFiles=new Set<string>();const nativeProjects=new Set<string>();let opaqueNativeFiles=0;const resolved=new Map<string,string>();
 const resolve=(file:string)=>{const normalized=path.normalize(file);let result=resolved.get(normalized);if(!result){result=canonical(normalized);resolved.set(normalized,result)}return result};
 const add=(value:unknown,base:string,key='',skipDerived=false)=>{
  if(typeof value==='string'&&!(skipDerived&&derived.has(key))){
   if(value.length>4096||value.includes('\0')||/^(?:https?:|data:|blob:)/i.test(value))return;
   let text=value;try{if(text.startsWith('file://'))text=decodeURIComponent(new URL(text).pathname)}catch{/* Keep the original reference when a file URL cannot be decoded. */}
   if(path.isAbsolute(text))protectedFiles.add(resolve(text));
   else if(/^(?:\.{1,2}\/|media\/|cache\/|analysis\/|exports\/|assets\/|resources\/)/.test(text))protectedFiles.add(resolve(path.resolve(base,text)));
  }else if(Array.isArray(value))for(const v of value)add(v,base,key,skipDerived);
  else if(value&&typeof value==='object')for(const [k,v]of Object.entries(value))add(v,base,k,skipDerived);
 };
 const visited=new Set<string>();
 const read=async(file:string,base:string)=>{if(visited.has(file))return;visited.add(file);try{add(JSON.parse(await fs.promises.readFile(file,'utf8')),base,'',targets.includes(base)&&file===path.join(base,'project.json'))}catch{throw Error('无法核对素材引用，未清理：'+file)}};
 for(const dir of dirs){
  if(cachedRoots(dir).some(root=>['jianying-alpha','jianying-opaque','jianying-chapter'].some(name=>fs.existsSync(path.join(root,name)))))nativeProjects.add(dir);
  // Include generated scene manifests and saved project/version metadata.
  for(const entry of await walk(dir,{skip:new Set(['cache','media','exports']),accept:file=>/\.(json|openscreen)$/.test(file)&&!path.basename(file).startsWith('._')}))await read(entry.file,dir);
  for(const entry of await walk(path.join(dir,'exports'),{accept:file=>file.endsWith('.json')})){if(!entry.file.endsWith('.json')||path.basename(entry.file).startsWith('._'))continue;await read(entry.file,dir);
   if(/draft_(?:content|info)\.json$/.test(entry.file))nativeProjects.add(dir);
   if(entry.file.includes(`${path.sep}.jobs${path.sep}`)&&!entry.file.endsWith('.snapshot.json')){
    const job=JSON.parse(await fs.promises.readFile(entry.file,'utf8'));
    if(job.settings?.importToJianying||job.settings?.selection?.jianyingDraft||job.settings?.selection?.jianyingMedia)nativeProjects.add(dir);
    if(typeof job.outputDir==='string'&&path.isAbsolute(job.outputDir)&&!job.outputDir.startsWith(dir+path.sep))for(const output of await walk(job.outputDir,{accept:file=>file.endsWith('.json')}))if(output.file.endsWith('.json')&&!path.basename(output.file).startsWith('._'))await read(output.file,job.outputDir);
   }
  }
 }
 // Native Jianying drafts may refer directly to generated assets from our library.
 const draftRoots=process.env.LINKREADER_JIANYING_PROJECTS_DIR?[process.env.LINKREADER_JIANYING_PROJECTS_DIR]:[path.join(os.homedir(),'Movies/JianyingPro/User Data/Projects'),path.join(os.homedir(),'Library/Application Support/JianyingPro/User Data/Projects')];
 for(const draftRoot of draftRoots)for(const entry of await walk(draftRoot,{accept:file=>/(?:draft_content|draft_info|draft_meta_info)\.json$/.test(file)}))if(/(?:draft_content|draft_info|draft_meta_info)\.json$/.test(entry.file)){
  const text=await fs.promises.readFile(entry.file,'utf8');
  // Recent Jianying versions encrypt these files. They are not malformed project
  // JSON. Keep all caches for projects with native delivery history in this case.
  if(!/^[\s]*[[{]/.test(text)){opaqueNativeFiles++;continue}
  await read(entry.file,path.dirname(entry.file));
 }
 for(const item of listBackups(true)){const snapshot=JSON.parse(fs.readFileSync(path.join(item.root,'snapshots',item.projectId,item.id+'.json'),'utf8'));let source=snapshot.sourceDir;try{source=findProject(item.projectId,true).dir}catch{/* No live placement: resolve against the recorded backup source. */}add(relocatedReferences(JSON.parse(snapshot.text),item.projectId,snapshot.sourceDir),source,'',true);}
 return {files:protectedFiles,nativeProjects,opaqueNativeFiles};
}
export async function storageOverview(projectId?:string){
 rootMemo=new Map();
 const projects=[];
 for(const dir of projectDirs().filter(dir=>!projectId||rawProject(dir).id===projectId)){
  const p=rawProject(dir),entries=await walk(dir);for(const root of cachedRoots(dir).slice(1))entries.push(...await walk(root));
  projects.push({id:p.id,name:p.name,dir,archivedAt:p.archivedAt,deletedAt:p.deletedAt,total:bytes(entries),media:bytes(entries.filter(e=>category(dir,e.file)==='media')),cache:bytes(entries.filter(e=>category(dir,e.file)==='cache')),exports:bytes(entries.filter(e=>category(dir,e.file)==='exports')),project:bytes(entries.filter(e=>category(dir,e.file)==='project'))});
 }
 let available=0;try{const stat=fs.statfsSync(rootDir());available=stat.bavail*stat.bsize}catch{/* Disk availability is unknown; keep the existing zero fallback. */}
 const appData=process.env.LINKREADER_STORAGE_APP_DATA||path.join(os.homedir(),'Library/Application Support/linkreader-desktop');
 const auxiliary=[];if(!projectId)for(const [name,folder]of [['更新包与解包文件','updates'],['工程备份','project-backups']]){
  const original=path.join(appData,folder);if(fs.existsSync(original)){const dir=fs.realpathSync(original);let occupied:number|null=null;
   try{if(process.platform==='darwin'){const result=await execFileAsync('/usr/bin/du',['-sk',dir],{timeout:30000,maxBuffer:1024*1024});const match=/^(\d+)\s/.exec(result.stdout);if(match)occupied=Number(match[1])*1024}else occupied=bytes(await walk(dir))}catch{/* Auxiliary size is unknown; retain null rather than invent a size. */}
   auxiliary.push({name,dir,bytes:occupied});}
 }
 return {root:rootDir(),available,policy:storagePolicy(),projects,auxiliary};
}
export async function cleanStorage(options:{projectId?:string;mode:'all'|'policy';archive?:boolean;dryRun?:boolean;reviewedFiles?:{path:string;mtime:number;ino:number}[];assertIdle:()=>void}){
 rootMemo=new Map();
 if(storageBusy)throw Error('正在管理缓存，请稍后重试');options.assertIdle();
 if(process.platform==='darwin'&&(projectRoots().some(root=>!fs.existsSync(root))||Object.values(placements()).some(p=>!p.removed&&!fs.existsSync(p.dir))))throw Error('有工程库离线，无法核对全部引用，请连接后清理');
 storageBusy=true;
 const gates:(()=>void)[]=[];
 const leases:Awaited<ReturnType<typeof acquireExportCacheLease>>[]=[];
 try{
  const dirs=projectDirs();const requested=options.projectId?dirs.filter(dir=>rawProject(dir).id===options.projectId):dirs;
  if(options.mode==='all'&&requested.some(dir=>readLock(dir)||(process.platform==='darwin'&&readScreenLock(dir))))throw Error('请先关闭正在编辑的工程，再清理或归档');
  const targets=options.mode==='policy'?requested.filter(dir=>!readLock(dir)&&(process.platform!=='darwin'||!readScreenLock(dir))):requested;
  if(options.projectId&&!requested.length)throw Error('工程不存在');
  for(const dir of targets){const lease=await acquireExportCacheLease(dir);leases.push(lease);if(lease.otherReaders())throw Error('工程仍有导出进程正在使用缓存');gates.push(lease.beginMaintenance())}
  if(options.archive)for(const dir of targets)for(const asset of rawProject(dir).media||[]){if(asset.originalFile&&!fs.existsSync(path.resolve(dir,asset.originalFile)))throw Error('素材缺失，请先补齐再归档：'+asset.name)}
  const referenceCheck=await references(dirs,targets);const refs=referenceCheck.files;options.assertIdle();
  const retainedProjects=targets.filter(dir=>referenceCheck.opaqueNativeFiles>0&&referenceCheck.nativeProjects.has(dir)).map(dir=>rawProject(dir).name);
  const warnings=retainedProjects.length?[`剪映存在加密草稿，以下工程的可重建缓存暂予保留：${retainedProjects.join('、')}`]:[];
  const policy=storagePolicy();const now=Date.now();const candidates:{dir:string;e:Entry;kind:string}[]=[];
  for(const dir of targets){
   if(options.mode==='policy'){
    const recentJobs=(await walk(path.join(dir,'exports','.jobs'))).filter(e=>e.file.endsWith('.json')&&!e.file.endsWith('.snapshot.json')&&now-e.mtime<86400000);
    let recoverable=false;for(const e of recentJobs){try{const j=JSON.parse(fs.readFileSync(e.file,'utf8'));if(['failed','cancelled','running','queued'].includes(j.status))recoverable=true}catch{/* Ignore unreadable recovery metadata under the existing policy. */}}
    if(recoverable)continue;
   }
   if(!retainedProjects.includes(rawProject(dir).name))for(const folder of cachedRoots(dir).flatMap(root=>[...generated].map(name=>path.join(root,name))).concat(path.join(dir,'media','proxies')))for(const e of await walk(folder))if(candidate(dir,e)&&!refs.has(e.file))candidates.push({dir,e,kind:cacheKind(dir,e.file)});
   for(const cacheRoot of cachedRoots(dir)){
   const work=path.join(cacheRoot,'export-work');
   for(const item of fs.existsSync(work)?fs.readdirSync(work,{withFileTypes:true}):[]){
    if(!item.isDirectory()||!item.name.startsWith('export-'))continue;
    const folder=path.join(work,item.name);let live=false;
    try{const owner=JSON.parse(fs.readFileSync(path.join(folder,'.owner.json'),'utf8'));if(Number.isInteger(owner.pid)&&owner.pid>0){try{process.kill(owner.pid,0);live=true}catch(e){if((e as NodeJS.ErrnoException).code!=='ESRCH')live=true}}else live=true}catch{if(Date.now()-fs.statSync(folder).mtimeMs<86400000)live=true}
    if(live)continue;
    for(const e of await walk(folder))if(!refs.has(e.file)&&now-e.mtime>3600000)candidates.push({dir,e,kind:'temporary'});
   }
  }
  }
  const selected=new Set<string>();let renderBytes=0;
  // Recent files first: the budget covers all evictable render caches, not just history.
  for(const c of candidates.sort((a,b)=>b.e.mtime-a.e.mtime)){
   if(options.mode==='all'||c.kind==='temporary')selected.add(c.e.file);
   else if(preview.has(c.kind)||c.kind==='proxies'){if(now-c.e.mtime>policy.previewDays*86400000)selected.add(c.e.file)}
   else {renderBytes+=c.e.allocated;if(renderBytes>policy.renderBudgetGB*GiB)selected.add(c.e.file)}
  }
  if(options.reviewedFiles){const reviewed=new Map(options.reviewedFiles.map(f=>[f.path,f]));for(const {e} of candidates){const prior=reviewed.get(e.file);if(!prior||prior.mtime!==e.mtime||prior.ino!==e.ino)selected.delete(e.file);}}
  const projectNames=new Map(candidates.map(({dir})=>[dir,'']));for(const dir of projectNames.keys())projectNames.set(dir,rawProject(dir).name);
  const files=candidates.filter(c=>selected.has(c.e.file)).map(({dir,e,kind})=>({path:e.file,name:path.basename(e.file),projectName:projectNames.get(dir),kind,bytes:e.allocated,mtime:e.mtime,ino:e.ino}));
  const counts=new Map<string,{entry:Entry;count:number}>();
  for(const {e} of candidates)if(selected.has(e.file)){const k=inode(e);const item=counts.get(k)||{entry:e,count:0};item.count++;counts.set(k,item)}
  const plannedBytes=[...counts.values()].reduce((sum,{entry,count})=>sum+(count>=entry.nlink?entry.allocated:0),0);
  if(options.dryRun)return {files,removedBytes:0,removedFiles:0,plannedBytes,plannedFiles:selected.size,protectedFiles:refs.size,warnings,completedAt:Date.now()};
  // Commit invalidation first: interruption can leave extra cache files, never stale
  // authoritative pointers to deleted previews.
  for(const dir of targets){const raw=rawProject(dir);const {project}=findProject(raw.id,true);let changed=false;
   for(const asset of project.media)for(const key of derived){const k=key as 'proxyFile'|'clearProxyFile'|'thumbnailFile'|'filmstripFile'|'waveformFile';if(asset[k]&&selected.has(canonical(path.resolve(dir,asset[k]!)))){delete asset[k];changed=true}}
   if(changed){project.revision++;save(dir,project)}
  }
  let removedBytes=0,removedFiles=0;
  for(const {e,dir} of candidates){if(!selected.has(e.file))continue;options.assertIdle();
   // Recheck identity and all ancestor symlinks immediately before unlinking.
   if(fs.realpathSync(path.dirname(e.file))!==path.dirname(e.file)||fs.realpathSync(dir)!==dir)throw Error('缓存路径发生变化，已停止清理');
   let s:fs.Stats;try{s=fs.lstatSync(e.file)}catch{continue}if(!s.isFile()||s.ino!==e.ino||s.mtimeMs!==e.mtime)continue;
   await fs.promises.unlink(e.file);removedFiles++;if(s.nlink===1)removedBytes+=s.blocks*512;
  }
  for(const dir of targets){const raw=rawProject(dir);const {project}=findProject(raw.id,true);let changed=false;
   if(options.archive){project.archivedAt=Date.now();changed=true;}
   if(changed){project.revision++;save(dir,project)}
  }
  const result={removedBytes,removedFiles,plannedBytes,plannedFiles:selected.size,protectedFiles:refs.size,warnings,completedAt:Date.now()};atomicJson(path.join(path.dirname(policyFile()),'.storage-last-clean.json'),result);return result;
 }finally{for(const release of gates.reverse())release();for(const lease of leases)lease.release();storageBusy=false;}
}

/** Migration cleanup shares the same conservative cross-project/native reference audit. */
export async function migrationReferences(){if(projectRoots().some(root=>!fs.existsSync(root))||Object.values(placements()).some(p=>!p.removed&&!fs.existsSync(p.dir)))throw Error('有工程库离线，无法核对全部引用，请连接后清理');rootMemo=new Map();return references(projectDirs().filter(dir=>fs.existsSync(dir)),[]);}
