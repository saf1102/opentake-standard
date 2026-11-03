import {createRequire} from 'node:module';
const {requestFileDialog}=createRequire(import.meta.url)('../../desktop/file-dialogs.cjs') as {requestFileDialog:(kind:string)=>Promise<string|null>};
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {execFileAsync} from "../proc.ts";
import {readJianyingPaths,jianyingCandidates} from './jianying/paths.ts';
const JIANYING_DRAFT_CANDIDATES = [
  path.join(os.homedir(), 'Movies', 'JianyingPro', 'User Data', 'Projects', 'com.lveditor.draft'),
  path.join(os.homedir(), 'Library', 'Application Support', 'JianyingPro', 'User Data', 'Projects', 'com.lveditor.draft'),
]

const JIANYING_APP_CANDIDATES = [
  '/Applications/VideoFusion-macOS.app',
  '/Applications/剪映专业版.app',
  '/Applications/JianyingPro.app',
]

export function findJianyingDraftDir() {
  const configured=readJianyingPaths().drafts;
  if(configured)return fs.existsSync(path.join(configured,'root_meta_info.json'))?configured:undefined;
  if(process.platform==='win32')return jianyingCandidates().drafts.find(candidate=>fs.existsSync(path.join(candidate,'root_meta_info.json')));
  return JIANYING_DRAFT_CANDIDATES.find((candidate) => fs.existsSync(candidate))
}

export function findJianyingApp() {
  const configured=readJianyingPaths().app;
  if(configured)return fs.existsSync(configured)?configured:undefined;
  if(process.platform==='win32'){
    const choices=jianyingCandidates().apps;
    const parent=path.dirname(choices[0]);
    try{for(const entry of fs.readdirSync(parent,{withFileTypes:true})){if(entry.isDirectory()&&/^\d+(?:\.\d+)*$/.test(entry.name))choices.push(path.join(parent,entry.name,'JianyingPro.exe'));}}catch{}
    return choices.find(candidate=>fs.existsSync(candidate));
  }
  return JIANYING_APP_CANDIDATES.find((candidate) => fs.existsSync(candidate))
}

export async function chooseExportDestination(prompt="选择 Creative Workspace 导出位置") {
  if(process.platform==='win32'){const selected=await requestFileDialog('folder');if(!selected)throw Error('未选择导出位置');return selected;}
  if (process.platform !== 'darwin') throw new Error('当前系统暂不支持原生文件夹选择器，请直接填写绝对路径')
  const { stdout } = await execFileAsync('/usr/bin/osascript', [
    '-e',
    `POSIX path of (choose folder with prompt ${JSON.stringify(prompt)})`,
  ])
  const selected = stdout.trim().replace(/\/$/, '')
  if (!selected) throw new Error('未选择导出位置')
  return selected
}

