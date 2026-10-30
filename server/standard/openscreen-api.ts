import {handleProjectAgentChoices,withProjectAgentChoices} from '../editor/project-agent-choices.ts';
import {handleStorageApi,assertStorageIdle} from '../editor/api/storage.ts';
import {cleanStorage} from '../editor/storage.ts';
import {purgeProjectDirectory} from '../editor/purge-project.ts';
import {relocatedDirectory,placements,setPlacement} from '../editor/migration-state.ts';
import {trashDir,projectLibrary} from '../editor/store.ts';
import {uploadMediaStream} from '../editor/media-upload.ts';
import {getProjectMediaAudioPeaks} from '../editor/audio-peaks.ts';
import {readExportPreferences,writeExportPreferences} from '../export-preferences.ts';
import {execFileAsync} from '../proc.ts';
import {listScreenExports} from '../editor/openscreen-export.ts';
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import {pipeline} from 'node:stream/promises';import type {IncomingMessage,ServerResponse} from 'node:http';
import {bodyJson,sendJson} from '../http.ts';import {findProject,save,createScreenProject,listScreenProjects,projectFolder,atomicJson,acquireLock,readLock} from '../editor/store.ts';import {processMedia} from '../editor/media.ts';import {handleOpenScreenApi} from '../editor/api/openscreen.ts';import {serveResolvedFile} from '../general/files.ts';import {openScreenEnvironmentStatus,listOpenScreenSources} from '../editor/openscreen.ts';import {agentSettingsView} from '../agent-settings.ts';import {migrateLegacyScreen} from './screen-migration.ts';
export async function handleEditorApi(req:IncomingMessage,res:ServerResponse){
 const u=new URL(req.url||'/','http://localhost');const parts=u.pathname.slice('/api/editor/'.length).split('/').map(decodeURIComponent);const ok=(result:unknown)=>sendJson(res,200,{ok:true,result});
 if(process.platform==='darwin'&&await handleStorageApi(req,res,parts))return;
 if(parts[0]==='agent-settings')return ok(await agentSettingsView());
 if(parts[0]==='openscreen'&&req.method==='GET'){if(parts[1]==='status')return ok(openScreenEnvironmentStatus());if(parts[1]==='sources')return ok(await listOpenScreenSources());}
 if(parts[0]!=='projects')return sendJson(res,404,{ok:false,error:'Standard 没有这个接口'});
 if(parts.length===1){if(req.method==='GET')return ok(listScreenProjects(u.searchParams.get('deleted')==='1'||u.searchParams.get('includeDeleted')==='1'));if(req.method==='POST'){const b=await bodyJson(req);return ok(createScreenProject(String(b.name||'空白录屏工程').slice(0,200)));}}
 const id=parts[1];migrateLegacyScreen(id);const {dir,project}=findProject(id,process.platform==='darwin');const action=parts[2];
 if(process.platform==='darwin'&&project.archivedAt&&!['GET','HEAD'].includes(req.method||'GET')&&!(req.method==='DELETE'&&parts.length===2)&&!['archive','storage','purge','restore'].includes(action||''))return sendJson(res,423,{ok:false,error:'工程已归档，请先恢复编辑'});
 if(process.platform==='darwin'&&await handleProjectAgentChoices(req,res,parts,dir,true))return;
 if(process.platform==='darwin'&&action==='archive'&&req.method==='POST'){const body=await bodyJson(req);if(project.deletedAt)throw Error('请先从回收站恢复工程');if(body.archived===false){assertStorageIdle();delete project.archivedAt;project.revision++;return ok(save(dir,project));}if(body.archived!==true)throw Error('归档状态无效');return ok(await cleanStorage({projectId:id,mode:'all',archive:true,assertIdle:assertStorageIdle}));}
 if(process.platform==='darwin'&&action==='purge'&&req.method==='POST'){const body=await bodyJson(req);if(body.confirmProjectId!==id)throw Error('请确认彻底删除的工程');assertStorageIdle();const trash=trashDir(projectLibrary(dir));let target=dir;if(project.deletedAt&&path.dirname(dir)!==trash){fs.mkdirSync(trash,{recursive:true});target=path.join(trash,id);if(fs.existsSync(target))throw Error('回收站已有同编号工程，请先处理');fs.renameSync(dir,target);relocatedDirectory(id,dir,target,project);}await purgeProjectDirectory(trash,target,project.deletedAt);const p=placements()[id];if(p)setPlacement({...p,removed:true});return ok(null);}
 if(action==='exports') {
  if(parts[3]==='preferences') {
   if(req.method==='GET')return ok(readExportPreferences(dir));
   if(req.method==='PUT')return ok(writeExportPreferences(dir,await bodyJson(req)));
  }
  if(parts[3]==='capabilities'&&req.method==='GET') {
   const destination=path.join(dir,'exports');fs.mkdirSync(destination,{recursive:true});
   const stats=fs.statfsSync(destination);return ok({defaultDestination:destination,freeBytes:stats.bavail*stats.bsize,jianying:{available:false,warning:'录屏运镜合成为完整视频轨道，完成后从导出文件夹导入剪映'}});
  }
  if(parts[3]==='destination'&&req.method==='POST') {
   const {stdout}=await execFileAsync('/usr/bin/osascript',['-e','POSIX path of (choose folder with prompt "选择导出位置")']);return ok({path:stdout.trim().replace(/\/$/,'')});
  }
  if(parts[3]==='history'&&req.method==='GET')return ok(listScreenExports(id));
 }
 if(action==='lock'&&req.method==='POST'){const b=await bodyJson(req);return ok(acquireLock(dir,String(b.clientId||''),Boolean(b.takeover)));}
 if(parts.length===2){if(req.method==='GET')return ok(project);if(req.method==='PATCH'){const b=await bodyJson(req);if(typeof b.name==='string'&&b.name.trim())project.name=b.name.trim().slice(0,200);if('archivedAt'in b)project.archivedAt=b.archivedAt?Date.now():undefined;project.updatedAt=Date.now();save(dir,project);return ok(project)}if(req.method==='DELETE'){project.deletedAt=Date.now();if(process.platform==='darwin'){assertStorageIdle();const trash=trashDir(projectLibrary(dir));fs.mkdirSync(trash,{recursive:true});const target=path.join(trash,id);if(dir!==target){if(fs.existsSync(target))throw Error('回收站已有同编号工程，请先处理');fs.renameSync(dir,target);relocatedDirectory(id,dir,target,project);}save(target,project);}else save(dir,project);return ok(project)}}
 if(action==='restore'&&req.method==='POST'){if(process.platform==='darwin'&&project.deletedAt){assertStorageIdle();const target=path.join(projectLibrary(dir),id);if(dir!==target){if(fs.existsSync(target))throw Error('工程库已有同编号工程，请先处理');fs.renameSync(dir,target);relocatedDirectory(id,dir,target,project);}delete project.deletedAt;save(target,project);}else{delete project.deletedAt;save(dir,project);}return ok(project)}
 if(action==='duplicate'&&req.method==='POST'){const p=createScreenProject(project.name+' 副本'),target=projectFolder(p.id);fs.cpSync(dir,target,{recursive:true,filter:s=>!s.endsWith('lock.json')&&!s.includes('/exports/')});const copy={...project,id:p.id,name:p.name,createdAt:p.createdAt,updatedAt:p.updatedAt};delete copy.deletedAt;save(target,copy);return ok(copy)}
 if(action==='media'&&parts.length===3&&req.method==='PUT'){
  const assetId=crypto.randomUUID(),relative='media/'+assetId+'.mp4',file=path.join(dir,relative);if(process.platform==='darwin')await uploadMediaStream(req,file);else{fs.mkdirSync(path.dirname(file),{recursive:true});await pipeline(req,fs.createWriteStream(file,{flags:'wx'}));}
  const asset={id:assetId,name:u.searchParams.get('filename')||'录屏.mp4',type:'video',mimeType:'video/mp4',originalFile:relative,duration:0,size:fs.statSync(file).size,createdAt:Date.now(),status:'processing',origin:'screen-recording'} as any;const latest=findProject(id).project;latest.media.push(asset);latest.revision++;save(dir,latest);return ok(await processMedia(id,assetId));
 }
 if(action==='media'&&parts[3]&&['file','peaks'].includes(parts[4])&&parts.length===5&&(req.method==='GET'||req.method==='HEAD')){const asset=project.media.find(a=>a.id===parts[3]);if(!asset)throw Error('素材不存在');if(parts[4]==='peaks'){const peaks=await getProjectMediaAudioPeaks(id,asset.id,Number(u.searchParams.get('duration')||0));res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Length':peaks.byteLength,'Cache-Control':'private, max-age=31536000, immutable'});return res.end(req.method==='HEAD'?undefined:peaks)}const kind=u.searchParams.get('kind'),relative=kind==='thumbnail'?asset.thumbnailFile:kind==='cursor'?asset.capture?.cursorDataFile:asset.originalFile;if(!relative)return sendJson(res,404,{ok:false,error:'素材文件不存在'});const file=path.resolve(dir,relative);if(!file.startsWith(dir+path.sep)||!fs.realpathSync(file).startsWith(fs.realpathSync(dir)+path.sep))throw Error('文件不可访问');return serveResolvedFile(req,res,file);}
 const screenDispatch=()=>handleOpenScreenApi({req,res,parts,id,dir});
 if(await (process.platform==='darwin'&&!['GET','HEAD'].includes(req.method||'GET')?withProjectAgentChoices(dir,'screen',screenDispatch):screenDispatch()))return;
 return sendJson(res,404,{ok:false,error:'Standard 没有这个接口'});
}
