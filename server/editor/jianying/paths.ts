import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {settingsDataRoot} from '../../system-settings-location.ts';
import {atomicJsonSync} from '../../file-ops.ts';
export type JianyingPaths={app:string;drafts:string};
const file=()=>path.join(settingsDataRoot(),'jianying-paths.json');
export function readJianyingPaths():JianyingPaths {
 if(!fs.existsSync(file()))return {app:'',drafts:''};
 const data=JSON.parse(fs.readFileSync(file(),'utf8'));
 if(typeof data.app!=='string'||typeof data.drafts!=='string')throw Error('剪映路径设置损坏，请重新保存');
 return {app:data.app,drafts:data.drafts};
}
export function writeJianyingPaths(value:unknown) {
 const input=value as JianyingPaths;
 if(!input||typeof input.app!=='string'||typeof input.drafts!=='string')throw Error('剪映路径设置无效');
 const result={app:input.app.trim(),drafts:input.drafts.trim()};
 for(const [key,p] of Object.entries(result)) {
  if(!p)continue;
  if(!path.isAbsolute(p)||p.includes('\0')||p.length>2048)throw Error('请输入剪映路径的完整绝对地址');
  if(!fs.existsSync(p)||!(key==='app'?process.platform==='win32'?fs.statSync(p).isFile()&&/\.exe$/i.test(p):fs.statSync(p).isDirectory():fs.statSync(p).isDirectory()))throw Error('剪映路径不存在或类型不符：'+p);
  if(key==='drafts'&&!fs.existsSync(path.join(p,'root_meta_info.json')))throw Error('草稿目录应包含 root_meta_info.json，请先在剪映创建一个空工程');
 }
 atomicJsonSync(file(),result);return result;
}
export function jianyingCandidates(platform=process.platform,env=process.env,home=os.homedir()) {
 if(platform!=='win32')return {apps:['/Applications/VideoFusion-macOS.app','/Applications/剪映专业版.app','/Applications/JianyingPro.app'],drafts:[path.join(home,'Movies/JianyingPro/User Data/Projects/com.lveditor.draft'),path.join(home,'Library/Application Support/JianyingPro/User Data/Projects/com.lveditor.draft')]};
 const local=env.LOCALAPPDATA||path.win32.join(home,'AppData','Local');
 return {apps:[path.win32.join(local,'JianyingPro','Apps','JianyingPro.exe'),...[env.ProgramFiles,env['ProgramFiles(x86)']].filter(Boolean).map(root=>path.win32.join(root!,'JianyingPro','JianyingPro.exe'))],drafts:[path.win32.join(local,'JianyingPro','User Data','Projects','com.lveditor.draft')]};
}
