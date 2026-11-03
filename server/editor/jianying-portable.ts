import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {jianyingRuntime} from './jianying/runtime.ts';
import {findJianyingDraftDir} from './settings-host.ts';
/** macOS source edition uses its readable importer, without shipping precompiled launchers. */
export function writePortableJianyingImporters(folder:string) {
 if(process.platform==='win32') {
  for(const name of ['import-windows.py','import-windows.ps1'])fs.writeFileSync(path.join(folder,name),(name.endsWith('.ps1')?'\ufeff':'')+fs.readFileSync(fileURLToPath(new URL('./jianying/portable/'+name,import.meta.url)),'utf8'));
  fs.writeFileSync(path.join(folder,'import-runtime.json'),JSON.stringify({python:jianyingRuntime().python,draftRoot:findJianyingDraftDir()||''},null,2));
  fs.writeFileSync(path.join(folder,'导入剪映-Windows.cmd'),'@echo off\r\nchcp 65001 >nul\r\npowershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0import-windows.ps1"\r\npause\r\n','utf8');
  fs.writeFileSync(path.join(folder,'导入说明.txt'),'请保留整个剪映工程文件夹及 Resources 素材。保存并退出剪映后，双击「导入剪映-Windows.cmd」。\n默认使用设置中的剪映草稿目录，也可输入自定义目录。导入会创建新草稿并备份原索引，不覆盖旧草稿。\n另一台电脑需先安装 OpenTake 和剪映。草稿生成组件由 OpenTake 提供，剪映用于打开和继续编辑。\n','utf8');
  return;
 }
 const source=fileURLToPath(new URL('./jianying/portable/import-mac.js',import.meta.url));
 fs.copyFileSync(source,path.join(folder,'import-mac.js'));
 const launcher=path.join(folder,'导入剪映-Mac.command');
 fs.writeFileSync(launcher,`#!/bin/bash
cd -- "$(dirname -- "$0")" || exit 1
if /bin/ps -axo comm= | /usr/bin/grep -E '/(VideoFusion[^/]*|Jianying[^/]*|剪映[^/]*)[.]app/Contents/MacOS/[^/]+$' | /usr/bin/grep -Ev '(Helper|Tray|Crash)' >/dev/null; then
 echo '请先保存工程并退出剪映，再双击导入。'
else
 echo '使用默认草稿目录请直接回车；自定义目录请输入完整路径：'
 IFS= read -r draft_root
 /usr/bin/osascript -l JavaScript ./import-mac.js "$PWD" "$draft_root"
fi
echo '按回车关闭。'
read -r
`);fs.chmodSync(launcher,0o755);
 fs.writeFileSync(path.join(folder,'导入说明.txt'),'请传输整个剪映工程文件夹，保存并退出剪映后，双击「导入剪映-Mac.command」。');
}
