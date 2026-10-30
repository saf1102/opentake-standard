import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
/** macOS source edition uses its readable importer, without shipping precompiled launchers. */
export function writePortableJianyingImporters(folder:string) {
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
