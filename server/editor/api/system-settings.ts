import {handleSettingsMigrations} from './system-settings-migrations.ts';
import {acquireExportCacheLease} from '../render-cache-policy.ts';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type {IncomingMessage,ServerResponse} from 'node:http';
import {bodyJson,sendJson} from '../../http.ts';
import {execFileAsync} from '../../proc.ts';
import {settingsView,writeSystemSettings,pathStatus,readSystemSettings,settingsFile,registerProjectLibrary} from '../../system-settings.ts';
import {assertStorageIdle} from './storage.ts';
import {backupProjectFile,listBackups,restoreBackup,backupFailures} from '../project-backups.ts';
import {scan} from '../store.ts';
import {binary} from '../media-binary.ts';
import {findJianyingApp,findJianyingDraftDir,chooseExportDestination} from '../settings-host.ts';
const hasBinary=(name:string)=>{try{return !!binary(name)}catch{return false}};
export async function handleSystemSettingsApi(req:IncomingMessage,res:ServerResponse,parts:string[]){
 if(parts[0]!=='system-settings')return false;
 if(!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress||'')){sendJson(res,403,{ok:false,error:'系统设置请在这台电脑上打开'});return true;}
 const reply=(result:unknown)=>{sendJson(res,200,{ok:true,result});return true;};
 if(await handleSettingsMigrations(req,res,parts))return true;
 if(req.method==='GET'&&parts.length===1)return reply(settingsView());
 if(req.method==='PUT'&&parts.length===1){const body=await bodyJson(req);assertStorageIdle();const releases:(()=>void)[]=[];try{for(const {dir} of scan(true)){const lease=await acquireExportCacheLease(dir);releases.push(lease.release);releases.push(lease.beginMaintenance());}assertStorageIdle();return reply(writeSystemSettings(body.preferences,body.revision));}finally{for(const release of releases.reverse())release();}}
 if(req.method==='POST'&&parts[1]==='libraries'){const body=await bodyJson(req);assertStorageIdle();registerProjectLibrary(String(body.path||''));return reply(settingsView());}
 if(req.method==='POST'&&parts[1]==='choose-folder')return reply({path:await chooseExportDestination('选择系统设置文件夹')});
 if(req.method==='POST'&&parts[1]==='check-path'){const body=await bodyJson(req);return reply(pathStatus(String(body.path||'')));}
 if(req.method==='POST'&&parts[1]==='reveal'){const body=await bodyJson(req);const s=readSystemSettings();const allowed=[...Object.values(s.preferences.paths),...s.libraries,...s.cacheRoots,...s.backupRoots,path.dirname(settingsFile())].filter(Boolean);if(!allowed.includes(body.path as string))throw Error('只能打开已保存的设置目录');await execFileAsync('/usr/bin/open',[String(body.path)]);return reply(null);}
 if(req.method==='GET'&&parts[1]==='backups')return reply({items:listBackups(),failures:backupFailures()});
 if(req.method==='POST'&&parts[1]==='backup-now'){assertStorageIdle();let count=0;for(const {dir} of scan()){backupProjectFile(dir,true);count++;}return reply({count});}
 if(req.method==='POST'&&parts[1]==='restore-backup'){assertStorageIdle();const body=await bodyJson(req);return reply(await restoreBackup(String(body.id||'')));}
 if(req.method==='GET'&&parts[1]==='diagnostics'){return reply({platform:process.platform,architecture:process.arch,node:process.version,cpus:os.cpus().length,memoryGB:Math.round(os.totalmem()/1024**3),ffmpeg:hasBinary('ffmpeg'),ffprobe:hasBinary('ffprobe'),jianying:!!findJianyingApp(),jianyingDraft:!!findJianyingDraftDir(),backupErrors:backupFailures().length,settingsRevision:readSystemSettings().revision});}
 if(req.method==='GET'&&parts[1]==='development-storage'){const file=path.join(os.homedir(),'Library/Application Support/linkreader-desktop/build-storage.json');return reply(fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):null);}
 sendJson(res,404,{ok:false,error:'系统设置接口不存在'});return true;
}
