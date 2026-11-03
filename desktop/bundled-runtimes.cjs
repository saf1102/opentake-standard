const fs=require('node:fs');
const path=require('node:path');
const {environmentPath,environmentWithPath}=require('./platform.cjs');
const RUNTIME_LAYOUT=Object.freeze({
 ffmpeg:'ffmpeg/bin/ffmpeg.exe',ffprobe:'ffmpeg/bin/ffprobe.exe',
 python:'python/python.exe',openscreen:'openscreen/Openscreen.exe',
 exportNode:'export-node/node.exe',jianying:'jianying-python/pyJianYingDraft/__init__.py',
 compositor:'openscreen/resources/electron/native/bin/win32-x64/compositor_view.node',
 chromium:'browsers/chromium_headless_shell-1243/chrome-headless-shell-win64/chrome-headless-shell.exe',
 headless:'browsers/chromium_headless_shell-1243/chrome-headless-shell-win64/chrome-headless-shell.exe',
 codex:'codex/vendor/x86_64-pc-windows-msvc/bin/codex.exe',
});
function bundledRuntimeEnvironment(input,resources){
 const root=path.join(resources,'runtimes');
 let manifest;try{manifest=JSON.parse(fs.readFileSync(path.join(root,'manifest.json'),'utf8'))}catch{throw Error('内置运行库清单缺失或损坏，请重新安装完整离线包。')}
 if(manifest.schema!==1||manifest.platform!=='win32-x64')throw Error('内置运行库版本不兼容，请重新安装完整离线包。');
 const files=Object.fromEntries(Object.entries(RUNTIME_LAYOUT).map(([key,relative])=>[key,path.join(root,relative)]));
 for(const [key,file] of Object.entries(files)){
  try{if(fs.statSync(file).isFile())continue}catch{}
  throw Error(`内置运行库 ${key} 缺失，请重新安装完整离线包。`);
 }
 const env={...input};
 env.LINKREADER_BIN_DIR ||= path.dirname(files.ffmpeg);
 env.LINKREADER_PYTHON ||= files.python;
 env.OPENTAKE_EXPORT_NODE = files.exportNode;
 env.OPENTAKE_JIANYING_PYTHON = files.python;
 env.OPENTAKE_JIANYING_PACKAGES = path.join(root,'jianying-python');
 env.OPENSCREEN_BIN ||= files.openscreen;
 env.PLAYWRIGHT_BROWSERS_PATH ||= path.join(root,'browsers');
 env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ||= files.chromium;
 env.LINKREADER_CODEX_EXECUTABLE ||= files.codex;
 // Keep code and caches app-local; neither the system PATH nor user Python configuration is edited.
 return environmentWithPath(env,[path.dirname(files.ffmpeg),path.dirname(files.python),path.dirname(files.codex),path.join(root,'codex/vendor/x86_64-pc-windows-msvc/codex-path'),environmentPath(env)].filter(Boolean).join(path.delimiter));
}
module.exports={RUNTIME_LAYOUT,bundledRuntimeEnvironment};
