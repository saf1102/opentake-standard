import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import {pipeline} from 'node:stream/promises';import type {IncomingMessage,ServerResponse} from 'node:http';
import {bodyJson,sendJson} from '../http.ts';import {findProject,save,createScreenProject,listScreenProjects,projectFolder,atomicJson,acquireLock,readLock} from '../editor/store.ts';import {processMedia} from '../editor/media.ts';import {handleOpenScreenApi} from '../editor/api/openscreen.ts';import {serveResolvedFile} from '../general/files.ts';import {openScreenEnvironmentStatus,listOpenScreenSources} from '../editor/openscreen.ts';import {agentSettingsView} from '../agent-settings.ts';import {migrateLegacyScreen} from './screen-migration.ts';
import {serveOpenScreenFonts} from '../editor/openscreen-fonts.ts';
import {nativeRecordingStatus} from '../editor/openscreen-host.ts';
export async function handleEditorApi(req:IncomingMessage,res:ServerResponse){
 const u=new URL(req.url||'/','http://localhost');const parts=u.pathname.slice('/api/editor/'.length).split('/').map(decodeURIComponent);const ok=(result:unknown)=>sendJson(res,200,{ok:true,result});
 if(parts[0]==='agent-settings')return ok(await agentSettingsView());
 if(parts[0]==='openscreen'&&['GET','HEAD'].includes(req.method||'')&&parts[1]==='fonts.css'&&parts.length===2)return serveOpenScreenFonts(req,res);
 if(parts[0]==='openscreen'&&['GET','HEAD'].includes(req.method||'')&&parts[1]==='fonts'&&parts.length===3)return serveOpenScreenFonts(req,res,parts[2]);
 if(parts[0]==='openscreen'&&req.method==='GET'){if(parts[1]==='recording-control')return ok(nativeRecordingStatus());if(parts[1]==='status')return ok(openScreenEnvironmentStatus());if(parts[1]==='sources')return ok(await listOpenScreenSources());}
 if(parts[0]!=='projects')return sendJson(res,404,{ok:false,error:'Standard 没有这个接口'});
 if(parts.length===1){if(req.method==='GET')return ok(listScreenProjects(u.searchParams.get('deleted')==='1'||u.searchParams.get('includeDeleted')==='1'));if(req.method==='POST'){const b=await bodyJson(req);return ok(createScreenProject(String(b.name||'空白录屏工程').slice(0,200)));}}
 const id=parts[1];migrateLegacyScreen(id);const {dir,project}=findProject(id);const action=parts[2];
 if(action==='lock'&&req.method==='POST'){const b=await bodyJson(req);return ok(acquireLock(dir,String(b.clientId||''),Boolean(b.takeover)));}
 if(parts.length===2){if(req.method==='GET')return ok(project);if(req.method==='PATCH'){const b=await bodyJson(req);if(typeof b.name==='string'&&b.name.trim())project.name=b.name.trim().slice(0,200);if('archivedAt'in b)project.archivedAt=b.archivedAt?Date.now():undefined;project.updatedAt=Date.now();save(dir,project);return ok(project)}if(req.method==='DELETE'){project.deletedAt=Date.now();save(dir,project);return ok(project)}}
 if(action==='restore'&&req.method==='POST'){delete project.deletedAt;save(dir,project);return ok(project)}
 if(action==='duplicate'&&req.method==='POST'){
  const p=createScreenProject(project.name+' 副本'),target=projectFolder(p.id);
  fs.cpSync(dir,target,{recursive:true,filter:source=>{
   const rel=path.relative(dir,source),parts=rel.split(path.sep);
   // Do not copy process ownership, locks or finished/partial exports. Windows
   // paths use backslashes; matching '/exports/' copied all of these on Windows.
   return rel!=='lock.json'&&parts[0]!=='exports'&&!(parts[0]==='analysis'&&parts[1]==='openscreen'&&(parts[2]==='host-sessions'||parts[3]==='export-jobs'));
  }});
  const copy={...project,id:p.id,name:p.name,createdAt:p.createdAt,updatedAt:p.updatedAt};delete copy.deletedAt;save(target,copy);return ok(copy);
 }
 if(action==='media'&&parts.length===3&&req.method==='PUT'){
  const assetId=crypto.randomUUID(),relative='media/'+assetId+'.mp4',file=path.join(dir,relative);fs.mkdirSync(path.dirname(file),{recursive:true});await pipeline(req,fs.createWriteStream(file,{flags:'wx'}));
  const asset={id:assetId,name:u.searchParams.get('filename')||'录屏.mp4',type:'video',mimeType:'video/mp4',originalFile:relative,duration:0,size:fs.statSync(file).size,createdAt:Date.now(),status:'processing',origin:'screen-recording'} as any;project.media.push(asset);save(dir,project);return ok(await processMedia(id,assetId));
 }
 if(action==='media'&&parts[3]&&['file','peaks'].includes(parts[4])&&parts.length===5&&(req.method==='GET'||req.method==='HEAD')){const asset=project.media.find(a=>a.id===parts[3]);if(!asset)return sendJson(res,404,{ok:false,error:'素材不存在'});if(parts[4]==='peaks'){res.writeHead(200,{'Content-Type':'application/octet-stream'});return res.end(Buffer.alloc(0))}const kind=u.searchParams.get('kind');if(kind==='cursor'&&!asset.capture?.cursorDataFile)return sendJson(res,200,{version:2,provider:'none',samples:[],assets:[]});const relative=kind==='thumbnail'?asset.thumbnailFile:kind==='cursor'?asset.capture?.cursorDataFile:asset.originalFile;if(!relative)return sendJson(res,404,{ok:false,error:'素材文件不存在'});const file=path.resolve(dir,relative);if(!file.startsWith(dir+path.sep)||!fs.realpathSync(file).startsWith(fs.realpathSync(dir)+path.sep))throw Error('文件不可访问');return serveResolvedFile(req,res,file);}
 if(await handleOpenScreenApi({req,res,parts,id,dir}))return;
 return sendJson(res,404,{ok:false,error:'Standard 没有这个接口'});
}
