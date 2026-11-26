const path = require('node:path');
const fs = require('node:fs');
const {randomUUID} = require('node:crypto');

// cmd parses a batch invocation once, then a typical npm shim expands %*.
// Protect both passes. Percent signs travel through a private, single-pass
// environment expansion so names such as %PATH% remain literal data.
const meta = /[()[\]%!^"`<>&|;, *?]/g;
const caret = value => value.replace(meta, char => '^' + char);
function quoteArgument(value) {
 let result = '"', slashes = 0;
 for (const char of value) {
  if (char === '\\') { slashes++; continue; }
  result += '\\'.repeat(char === '"' ? slashes * 2 + 1 : slashes) + char;
  slashes = 0;
 }
 return result + '\\'.repeat(slashes * 2) + '"';
}
// Recognize package managers' generated forwarding scripts. Match the full template:
// a custom wrapper may set options or run setup code and must retain those semantics.
// https://github.com/npm/cmd-shim/blob/main/lib/index.js
// https://github.com/pnpm/cmd-shim/blob/main/src/index.ts
function smallScriptText(file) {
 try {
  if (!path.win32.isAbsolute(file)) return '';
  const stat=fs.statSync(file);
  if (!stat.isFile() || stat.size > 32768) return '';
  return fs.readFileSync(file,'utf8').replace(/^\uFEFF/,'').trim();
 } catch { return ''; }
}
const workBuddyForwarder=/(?:(?:\b|%~dp0|%dp0%)WorkBuddy\.exe\b|\bcodebuddy-lite-wb\.mjs\b|\bWorkBuddy\.app[\\/]|resources[\\/]app\.asar\.unpacked[\\/]cli[\\/]bin[\\/](?:codebuddy|cbc)\b)/i;
function windowsShim(file, env, read = smallScriptText, isFile = candidate => {try{return fs.statSync(candidate).isFile()}catch{return false}}, visited = new Set()) {
 if(!/\.cmd$/i.test(file))return undefined;
 const id=path.win32.normalize(file).toLowerCase();
 if(visited.has(id)||visited.size>=4)return undefined;
 visited.add(id);
 const text = read(file);
 if (!text) return undefined;
 // Verified with the vendor's 0.2.2-rc.5 Windows dsh.cmd on 2026-11-20.
 // app.asar is a file for normal Node; Electron itself resolves the inner entry.
 if (/[\\/]resources[\\/]runtime[\\/]cli[\\/]bin[\\/]dsh\.cmd$/i.test(file)) {
  const canonical = [
   '@echo off','setlocal DisableDelayedExpansion','set "ELECTRON_RUN_AS_NODE=1"',
   '"%~dp0..\\..\\..\\..\\DeepSeek Harness.exe" --expose-internals "%~dp0..\\..\\..\\app.asar\\dsh\\node_modules\\@deepseek-ai\\dsh-desktop-host\\lib\\cli.js" %*',
   'exit /b %errorlevel%',
  ].join('\n');
  if (text.split(/\r?\n/).map(line=>line.trim()).join('\n').toLowerCase()===canonical.toLowerCase()) {
   const root=path.win32.resolve(path.win32.dirname(file),'..','..','..','..');
   const host=path.win32.join(root,'DeepSeek Harness.exe'),archive=path.win32.join(root,'resources','app.asar');
   if(!isFile(host)||!isFile(archive))return {incomplete:true};
   return {file:host,args:['--expose-internals',path.win32.join(archive,'dsh','node_modules','@deepseek-ai','dsh-desktop-host','lib','cli.js')],
    env:{...env,ELECTRON_RUN_AS_NODE:'1'},harness:true};
  }
 }
 if (workBuddyForwarder.test(text))return {editor:true,workBuddy:true};
 if (/ELECTRON_RUN_AS_NODE|resources[\\/]app[\\/]out[\\/]cli\.js/i.test(text)) return {editor:true};
 const lines = text.split(/\r?\n/).map(line=>line.trim().replace(/^@/,'')).filter(Boolean);
 const dir = path.win32.dirname(file);
 const entry = raw => {
  const expanded = raw.replace(/^%(?:~dp0|dp0%)[\\/]?/i,dir+'\\');
  return /^(?:[a-z]:[\\/]|\\\\)/i.test(expanded) && !/[%"\r\n]/.test(expanded) ? path.win32.normalize(expanded) : undefined;
 };
 let nodePath;
 const nodePathBlock = lines.findIndex(line=>/^if not defined NODE_PATH \($/i.test(line));
 if (nodePathBlock === 1 && /^setlocal$/i.test(lines[0])) {
  const value=lines[2]?.match(/^set "NODE_PATH=([^"%]+)"$/i)?.[1];
  if (!value || lines[3]!==') ELSE (' || lines[4]?.toLowerCase()!==('set "NODE_PATH='+value+';%NODE_PATH%"').toLowerCase() || lines[5]!==')') return undefined;
  nodePath=value+(env.NODE_PATH?';'+env.NODE_PATH:'');
  lines.splice(1,5);
 }
 let target, node;
 const script=lines.join('\n');
 const npm=script.match(/^echo off\ngoto start\n:find_dp0\nset dp0=%~dp0\nexit \/b\n:start\nsetlocal\ncall :find_dp0\nif exist "%dp0%\\node\.exe" \(\nset "_prog=%dp0%\\node\.exe"\n\) else \(\nset "_prog=node"\n\)\nendlocal & goto #_undefined_# 2>nul \|\| title %comspec% & set pathext=%pathext:;\.js;=;% & "%_prog%"\s+"([^"]+)" %\*$/i);
 const old=script.match(/^(?:setlocal\n)?if exist "%~dp0\\node\.exe" \(\n"%~dp0\\node\.exe"\s+"([^"]+)" %\*\n\) else \(\n(?:setlocal\n)?set pathext=%pathext:;\.js;=;%\nnode\s+"\1" %\*\n\)$/i);
 const forward=script.match(/^(?:(?:echo off|setlocal)\n)*"([^"]+)"\s+(?:"([^"]+)"\s+)?%\*$/i);
 if (npm || old) {
  target=entry((npm||old)[1]);
  const search=[dir,...String(Object.entries(env).find(([k])=>/^path$/i.test(k))?.[1]||'').split(';')];
  node=search.filter(candidate=>path.win32.isAbsolute(candidate)).map(candidate=>path.win32.join(candidate,'node.exe')).find(isFile);
 } else if (forward) {
  target=entry(forward[2]||forward[1]);
  if (forward[2]) node=entry(forward[1]);
 } else return undefined;
 if (target && isWorkBuddyPath(target)) return {editor:true,workBuddy:true};
 if (!target || !isFile(target)) return undefined;
 if ((npm || old || forward[2]) && (!node || !/\\node\.exe$/i.test(node) || !isFile(node))) return undefined;
 const childEnv=nodePath?{...env,NODE_PATH:nodePath}:env;
 if(!node&&/\.cmd$/i.test(target))return windowsShim(target,childEnv,read,isFile,visited);
 if (!node && !/\.exe$/i.test(target)) return undefined;
 return {file:node||target,args:node?[target]:[],env:childEnv};
}
const storeAccessHint='Windows 拒绝启动商店包里的 Codex。请用 npm install -g @openai/codex 安装命令行，再点重新查找。';
function storeCodexDenied(file,code,text=''){
 return /[\\/]WindowsApps[\\/](?:OpenAI\.Codex_|OpenAI\.ChatGPT)[^\\/]*[\\/].*[\\/]codex\.exe$/i.test(file)
  && (['EPERM','EACCES'].includes(code)||/access is denied|permission denied|拒绝访问|访问被拒绝|存取被拒|Windows 拒绝启动商店包里的 Codex/i.test(text));
}

// Manual Codex programs can be renamed. Register only after the executable
// answered the Codex version check in this process.
const verifiedCodexPaths=new Set();
function rememberCodexExecutable(file){
 verifiedCodexPaths.add(path.win32.normalize(file).toLowerCase());
}
function agentLaunch(file, args = [], options = {}, platform = process.platform, checkingCodex = false) {
 if(platform==='win32' && (checkingCodex || verifiedCodexPaths.has(path.win32.normalize(file).toLowerCase()) || /(?:^|[\\/])codex(?:-cli)?(?:\.(?:exe|cmd|bat|ps1))?$/i.test(file))){
  if([file,...args].some(value=>typeof value!=='string'||value.includes('\0')))throw Error('程序路径和参数不能包含空字符');
  const env={...(options.env||process.env)},system32=path.win32.join(env.SystemRoot||env.windir||'C:\\Windows','System32');
  // Only the fixed script path crosses cmd.exe. The Node relay forwards the original
  // argv and stdio directly, including quotes, Chinese, newlines and long prompts.
  env.OT_UTF8_NODE=process.execPath;
  env.OT_UTF8_ENTRY=__filename;
  env.OT_UTF8_SCRIPT=path.join(__dirname,'agent-codex-utf8.cmd');
  env.OT_UTF8_REQUEST=JSON.stringify({file,args,electronMode:env.ELECTRON_RUN_AS_NODE});
  if(process.versions.electron)env.ELECTRON_RUN_AS_NODE='1';
  return {file:path.win32.join(system32,'cmd.exe'),args:['/d','/s','/v:off','/c','""%OT_UTF8_SCRIPT%""'],options:{...options,env,shell:false,windowsVerbatimArguments:true}};
 }
 return directLaunch(file,args,options,platform);
}
// WorkBuddy desktop 5.11.3 ships an entry that prints a version but cannot serve ACP.
function isWorkBuddyPath(file){
 const bundled=value=>/(?:^|[\\/])(?:WorkBuddy\.exe|codebuddy-lite-wb\.mjs)$|(?:^|[\\/])WorkBuddy[^\\/]*\.app(?:[\\/]|$)|[\\/]resources[\\/]app\.asar\.unpacked[\\/]cli[\\/]bin[\\/](?:codebuddy|cbc)(?:\.\w+)?$/i.test(value);
 if(bundled(file))return true;
 try{return bundled(fs.realpathSync(file))}catch{return false}
}
function isWorkBuddyProgram(file){
 if(!file)return false;
 if(isWorkBuddyPath(file))return true;
 if(/\.cmd$/i.test(file))return windowsShim(file,{})?.workBuddy===true;
 if(/\.(?:bat|ps1)$/i.test(file))return workBuddyForwarder.test(smallScriptText(file));
 if(/(?:^|[\\/])(?:codebuddy|cbc)$/i.test(file)){
  const text=smallScriptText(file);
  return text.startsWith('#!')&&workBuddyForwarder.test(text);
 }
 return false;
}
const workBuddyCliHint='请选择腾讯官方独立的 CodeBuddy 命令行，WorkBuddy 桌面版的内置程序无法登录或出片';
function directLaunch(file,args,options,platform) {
 if(isWorkBuddyProgram(file))throw Error(workBuddyCliHint);
 if(platform==='win32'&&/\.mjs$/i.test(file))throw Error('普通脚本不能作为智能体程序');
 if(platform==='win32'&&/\.cmd$/i.test(file)){
  const shim=windowsShim(file,options.env||process.env);
  if(shim?.incomplete)throw Error('DeepSeek Harness 桌面版缺少随附的运行文件，请重新安装后再查找');
  if(shim?.workBuddy)throw Error(workBuddyCliHint);
  if(shim?.editor)throw Error('所选命令打开的是桌面编辑器，请指定智能体命令行');
  if(shim)return {file:shim.file,args:[...shim.args,...args],options:{...options,env:shim.env,shell:false}};
 }

 if (platform !== 'win32' || !/\.(cmd|bat|ps1)$/i.test(file)) return {file, args: [...args], options: {...options, shell: false}};
 if (typeof file !== 'string' || [file, ...args].some(value => typeof value !== 'string' || /[\r\n\0]/.test(value))) throw Error('程序路径和命令参数不能包含换行或空字符');
 const env = {...(options.env || process.env)};
 const systemRoot = Object.entries(env).find(([key]) => key.toLowerCase() === 'systemroot')?.[1] || 'C:\\Windows';
 if (/\.ps1$/i.test(file)) {
  return {file:path.win32.join(systemRoot,'System32','WindowsPowerShell','v1.0','powershell.exe'),
   args:['-NoLogo','-NoProfile','-File',file,...args],options:{...options,env,shell:false}};
 }
 const percent = 'OPENTAKE_LITERAL_' + randomUUID().replaceAll('-', '');
 env[percent] = '%';
 const protectPercent = value => value.replaceAll('%', '%' + percent + '%');
 const command = [protectPercent(caret(path.win32.normalize(file))), ...args.map(value => protectPercent(caret(caret(quoteArgument(value)))))].join(' ');
 return {file: path.win32.join(systemRoot, 'System32', 'cmd.exe'), args: ['/d', '/s', '/v:off', '/c', '"' + command + '"'], options: {...options, env, shell: false, windowsVerbatimArguments: true}};
}
if(require.main===module && process.platform==='win32' && process.env.OT_UTF8_REQUEST){
 const env={...process.env};
 const {file,args,electronMode}=JSON.parse(env.OT_UTF8_REQUEST);
 for(const name of ['OT_UTF8_NODE','OT_UTF8_ENTRY','OT_UTF8_SCRIPT','OT_UTF8_REQUEST'])delete env[name];
 if(electronMode===undefined)delete env.ELECTRON_RUN_AS_NODE;else env.ELECTRON_RUN_AS_NODE=electronMode;
 const launch=directLaunch(file,args,{env,stdio:'inherit',windowsHide:true},'win32');
 const child=require('node:child_process').spawn(launch.file,launch.args,launch.options);
 child.once('error',error=>{
  process.stderr.write((storeCodexDenied(file,error.code)?storeAccessHint:[error.code,'Codex 启动失败'].filter(Boolean).join(' '))+'\n');
  process.exitCode=1;
 });
 child.once('exit',code=>{process.exitCode=code??1});
}
module.exports = {agentLaunch, rememberCodexExecutable, quoteArgument, windowsShim, isWorkBuddyProgram, storeCodexDenied, storeAccessHint};
