import fs from 'node:fs';
import path from 'node:path';
import type {EditProject} from '../../src/types/editor.ts';
import {defaultProjectRoot,projectRoots,validateDirectory} from '../system-settings.ts';
import {autoBackup} from './project-backups.ts';
import {assertNoMigration,placements,setPlacement,excludedMigrationSource} from './migration-state.ts';
import * as legacy from './store-windows.ts';
import {atomicJson as writeJson,dirs,rootDir,trashDir,projectLibrary} from './store/paths.ts';
export {dirs,rootDir,trashDir,projectLibrary};
export const atomicJson=process.platform==='darwin'?writeJson:legacy.atomicJson;
const screen=(dir:string,p:EditProject)=>p.standardKind==='screen'||p.openScreenDocuments?.length||fs.existsSync(path.join(dir,'.opentake-screen.json'))||fs.existsSync(path.join(dir,'screen-project.json'));
const validId=(id:string)=>{if(!/^[a-zA-Z0-9_-]{1,96}$/.test(id))throw Error('工程编号无效');};
export function scan(includeDeleted=false):{dir:string;project:EditProject}[]{
 if(process.platform!=='darwin')return legacy.listScreenProjects(includeDeleted).map(project=>({dir:legacy.projectFolder(project.id),project}));
 const placed=placements(),rows:{dir:string;project:EditProject}[]=[];
 const roots=[...new Set([...projectRoots(),...Object.values(placed).filter(p=>!p.removed).map(p=>projectLibrary(p.dir))])];
 for(const root of roots)for(const base of includeDeleted?[root,trashDir(root)]:[root]){
  if(!fs.existsSync(base))continue;
  for(const entry of fs.readdirSync(base,{withFileTypes:true})){
   if(!entry.isDirectory()||entry.name.startsWith('.'))continue;
   const dir=path.join(base,entry.name);if(excludedMigrationSource(dir))continue;
   const file=path.join(dir,'project.json');if(!fs.existsSync(file))continue;
   const project=JSON.parse(fs.readFileSync(file,'utf8')) as EditProject;
   if(!screen(dir,project)||!includeDeleted&&project.deletedAt)continue;
   const location=placed[project.id];if(location&&(location.removed||location.dir!==dir))continue;
   rows.push({dir,project});
  }
 }
 for(const p of Object.values(placed))if(!p.removed&&!fs.existsSync(p.dir)&&!rows.some(r=>r.project.id===p.id)&&(includeDeleted||!p.project.deletedAt))rows.push({dir:p.dir,project:{...p.project,storageOffline:true} as EditProject});
 return rows.sort((a,b)=>b.project.updatedAt-a.project.updatedAt);
}
export function findProject(id:string,includeDeleted=false){
 if(process.platform!=='darwin')return legacy.findProject(id,includeDeleted);
 validId(id);const placement=placements()[id];
 if(placement?.removed)throw Error('工程不存在');
 if(placement&&!fs.existsSync(placement.dir))throw Error('工程所在硬盘未连接或目录已移动，请重新连接原硬盘');
 const found=scan(includeDeleted).find(row=>row.project.id===id);if(!found)throw Error('工程不存在');return found;
}
export function projectFolder(id:string){
 if(process.platform!=='darwin')return legacy.projectFolder(id);
 validId(id);const found=scan(true).find(row=>row.project.id===id);if(found){if(found.project.storageOffline)throw Error('工程所在硬盘未连接或目录已移动，请重新连接原硬盘');return found.dir;}
 const dir=path.join(defaultProjectRoot(),id);if(fs.existsSync(dir)&&fs.lstatSync(dir).isSymbolicLink())throw Error('工程不能是符号链接');return dir;
}
export function save(dir:string,project:EditProject){
 if(process.platform!=='darwin')return legacy.save(dir,project);
 assertNoMigration();if(excludedMigrationSource(dir))throw Error('工程已迁移，请重新打开工程');
 validateDirectory(projectLibrary(dir));
 const file=path.join(dir,'project.json');if(fs.existsSync(file))autoBackup(dir);
 project.updatedAt=Date.now();atomicJson(file,project);
 // Remember a lightweight location even before the first manual migration so
 // disconnecting a registered library never turns its projects into an empty list.
 setPlacement({id:project.id,dir,previous:placements()[project.id]?.previous||[],aliases:placements()[project.id]?.aliases,project:project as unknown as Record<string,unknown>});
 return project;
}
export function createScreenProject(name:string){
 if(process.platform!=='darwin')return legacy.createScreenProject(name);
 validateDirectory(defaultProjectRoot());
 // The old factory defines the screen-only schema; route its initial write back
 // through the shared persistence boundary after it creates the new directory.
 const project=legacy.createScreenProject(name);const dir=legacy.projectFolder(project.id);dirs(dir);save(dir,project);return project;
}
export function listScreenProjects(includeDeleted=false){return process.platform==='darwin'?scan(includeDeleted).map(row=>row.project):legacy.listScreenProjects(includeDeleted);}
export const readLock=legacy.readLock;
export const acquireLock=legacy.acquireLock;
