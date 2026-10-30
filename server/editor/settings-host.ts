import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {execFileAsync} from "../proc.ts";
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
  return JIANYING_DRAFT_CANDIDATES.find((candidate) => fs.existsSync(candidate))
}

export function findJianyingApp() {
  return JIANYING_APP_CANDIDATES.find((candidate) => fs.existsSync(candidate))
}

export async function chooseExportDestination(prompt="选择 Creative Workspace 导出位置") {
  if (process.platform !== 'darwin') throw new Error('当前系统暂不支持原生文件夹选择器，请直接填写绝对路径')
  const { stdout } = await execFileAsync('/usr/bin/osascript', [
    '-e',
    `POSIX path of (choose folder with prompt ${JSON.stringify(prompt)})`,
  ])
  const selected = stdout.trim().replace(/\/$/, '')
  if (!selected) throw new Error('未选择导出位置')
  return selected
}

