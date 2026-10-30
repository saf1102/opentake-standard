import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import {readSystemSettings,validateDirectory} from '../system-settings.ts';
function projectKey(dir:string){const id=JSON.parse(fs.readFileSync(path.join(dir,'project.json'),'utf8')).id;if(typeof id!=='string'||! /^[a-zA-Z0-9_-]+$/.test(id))throw Error('工程缓存标识无效');return id;}
export function projectCacheRoot(dir:string){const root=readSystemSettings().preferences.paths.cache;if(!root)return path.join(dir,'cache');validateDirectory(root);return path.join(root,'creative-workspace-cache',projectKey(dir));}
export function cachePath(dir:string,...parts:string[]){return path.join(projectCacheRoot(dir),...parts);}
export function cacheRelative(dir:string,kind:string,file:string){const result=cachePath(dir,kind,file);fs.mkdirSync(path.dirname(result),{recursive:true});return path.relative(dir,result);}
export function allProjectCacheRoots(dir:string){const settings=readSystemSettings();const roots=[...new Set([...settings.cacheRoots,settings.preferences.paths.cache].filter(Boolean))];return [path.join(dir,'cache'),...roots.map(root=>path.join(root,'creative-workspace-cache',projectKey(dir)))];}

export function globalRenderCache(){const root=readSystemSettings().preferences.paths.cache;if(root){validateDirectory(root);return path.join(root,'creative-workspace-cache','renderer','frame-render');}return path.join(os.homedir(),process.platform==='darwin'?'Library/Caches':'.cache','LinkReader','frame-render');}
