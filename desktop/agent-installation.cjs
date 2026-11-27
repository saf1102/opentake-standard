const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const platform=require('./platform.cjs');
const {agentLaunch,rememberCodexExecutable,isWorkBuddyProgram,windowsShim,storeCodexDenied,storeAccessHint}=require('./agent-launch.cjs');
const versions=new Map();
const storeNotices=new Map();
function storeCodexAccessNotice(configured=''){return storeNotices.get(configured)}

const unreadableVersions=new Map();
function codexVersionUnreadable(file){
 try{const stat=fs.statSync(file);return unreadableVersions.get(fs.realpathSync(file))===stat.mtimeMs+':'+stat.size}catch{return false}
}
let shellCache;
function sanitizeAgentEnv(input=process.env,connection){
 const clean=Object.fromEntries(Object.entries(input).filter(([k,v])=>v!==undefined&&!/^(CLAUDECODE|CLAUDE_CODE_.*|ANTHROPIC_BASE_URL|ANTHROPIC_AUTH_TOKEN|ANTHROPIC_API_KEY|DEEPSEEK_API_KEY|OPENTAKE_CODEX_API_KEY)$/i.test(k)));
 // API credentials are explicit per-launch additions on both supported platforms.
 if(connection){
  const keys=connection.agent==='claude'?['ANTHROPIC_BASE_URL','ANTHROPIC_API_KEY']:connection.agent==='codex'?['OPENTAKE_CODEX_API_KEY']:connection.agent==='deepseek'?['DEEPSEEK_API_KEY']:[];
  for(const key of keys)if(typeof connection.variables?.[key]==='string')clean[key]=connection.variables[key];
 }
 return clean;
}
function windowsJson(script,env){
 const root=Object.entries(env).find(([name])=>/^systemroot$/i.test(name))?.[1]||'C:\\Windows';
 const command=path.win32.join(root,'System32','WindowsPowerShell','v1.0','powershell.exe');
 const result=spawnSync(command,['-NoLogo','-NoProfile','-NonInteractive','-Command',
  '[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false); '+script],{env,encoding:'utf8',windowsHide:true,timeout:4000,maxBuffer:512*1024});
 try{return result.status===0?JSON.parse(result.stdout):null}catch{return null}
}
// reg.exe writes in the console code page. Only pass keys and value names as quoted
// environment expansions; a registry-supplied package name never becomes cmd.exe syntax.
// https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/chcp
function queryWindowsRegistry(key,value,env,run=spawnSync){
 if(!/^[\w\\ .()-]+$/.test(key)||value&&!/^[\w .()-]+$/.test(value))return '';
 const system32=path.win32.join(env.SystemRoot||env.windir||'C:\\Windows','System32');
 const command='"%OT_REG_SYSTEM32%\\chcp.com" 65001 >nul && "%OT_REG_SYSTEM32%\\reg.exe" query "%OT_REG_KEY%"'+(value?' /v "%OT_REG_VALUE%"':'');
 const result=run(path.win32.join(system32,'cmd.exe'),['/d','/s','/v:off','/c','"'+command+'"'],{
  env:{...env,OT_REG_SYSTEM32:system32,OT_REG_KEY:key,OT_REG_VALUE:value||''},encoding:'utf8',windowsHide:true,windowsVerbatimArguments:true,timeout:4000,maxBuffer:8<<20,
 });
 return result.status===0?String(result.stdout||''):'';
}
// Read only PATH and variables it actually references, never dump either Environment key.
function registryEnvironment(env,query=queryWindowsRegistry){
 const userKey='HKCU\\Environment',systemKey='HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment';
 const read=(key,name)=>query(key,name,env).match(/^\s+.+?\s+REG_(?:EXPAND_)?SZ(?:\s+(.*?))?\s*$/im)?.[1]?.trim();
 const user=read(userKey,'Path'),system=read(systemKey,'Path'),variables={},seen=new Set(['path']),queue=[user,system];
 while(queue.length&&seen.size<64){
  for(const match of String(queue.pop()||'').matchAll(/%([\w .()-]+)%/g)){
   const name=match[1],lower=name.toLowerCase();
   if(seen.has(lower))continue;
   seen.add(lower);
   const value=read(userKey,name)??read(systemKey,name);
   if(value!==undefined){variables[name]=value;queue.push(value)}
  }
 }
 return {user,system,variables};
}
function mergedPath(entries,win){
 const p=win?path.win32:path.posix,seen=new Set(),result=[];
 for(const raw of entries){
  if(typeof raw!=='string')continue;
  const dir=win?raw.trim().replace(/^"(.*)"$/,'$1'):raw;
  if(!dir||!p.isAbsolute(dir))continue;
  const key=win?p.normalize(dir).replace(/\\$/,'').toLowerCase():dir;
  if(!seen.has(key)){seen.add(key);result.push(dir)}
 }
 return result;
}
function newestNodeVersion(directory){
 try{
  return fs.readdirSync(directory,{withFileTypes:true}).filter(item=>(item.isDirectory()||item.isSymbolicLink())&&/^v\d+\.\d+\.\d+$/.test(item.name))
   .map(item=>item.name.slice(1)).sort((a,b)=>compareVersions(b,a))[0];
 }catch{return undefined}
}
function toolchainDirs(env,home,osName){
 const win=osName==='win32',p=win?path.win32:path.posix,join=(base,...parts)=>base&&p.join(base,...parts);
 // fnm current shell and default alias: https://github.com/Schniz/fnm/blob/master/src/config.rs
 const fnmRoots=[env.FNM_DIR,env.XDG_DATA_HOME&&join(env.XDG_DATA_HOME,'fnm'),win?join(env.APPDATA,'fnm'):join(home,'.local','share','fnm'),...(!win?[join(home,'Library','Application Support','fnm')]:[]),join(home,'.fnm')];
 const fnm=[env.FNM_MULTISHELL_PATH,...fnmRoots.filter(Boolean).map(root=>join(root,'aliases','default'))].filter(Boolean).map(dir=>win?dir:join(dir,'bin'));
 // https://github.com/Schniz/fnm/blob/master/src/config.rs (node-versions) and src/version.rs (installation)
 for(const root of mergedPath(fnmRoots,win)){
  const versionsDir=join(root,'node-versions'),latest=newestNodeVersion(versionsDir);
  if(latest)fnm.push(join(versionsDir,'v'+latest,'installation',...(win?[]:['bin'])));
 }
 // https://get.pnpm.io/install.ps1 and https://get.pnpm.io/install.sh (v10 home and newer bin)
 // https://docs.volta.sh/advanced/installers ; https://bun.com/docs/installation
 // https://github.com/ScoopInstaller/Scoop ; https://github.com/microsoft/winget-cli/blob/master/src/AppInstallerCommonCore/Runtime.cpp
 // https://github.com/coreybutler/nvm-windows ; https://docs.npmjs.com/cli/configuring-npm/folders
 const pnpm=env.PNPM_HOME||(win?join(env.LOCALAPPDATA,'pnpm'):join(home,'Library','pnpm'));
 const pnpmDirs=[join(pnpm,'bin'),pnpm];
 // https://github.com/yarnpkg/yarn/blob/master/src/cli/commands/global.js
 // https://docs.chocolatey.org/docs/features-shim/ ; https://learn.microsoft.com/en-us/sysinternals/downloads/microsoft-store#app-execution-aliases
 if(win)return [join(env.APPDATA,'npm'),env.PNPM_HOME,join(env.PNPM_HOME,'bin'),join(env.LOCALAPPDATA,'pnpm'),join(env.LOCALAPPDATA,'pnpm','bin'),
  join(env.VOLTA_HOME,'bin'),join(env.LOCALAPPDATA,'Volta','bin'),env.NVM_SYMLINK,join(env.LOCALAPPDATA,'Yarn','bin'),
  join(env.BUN_INSTALL,'bin'),join(home,'.bun','bin'),join(env.SCOOP,'shims'),join(home,'scoop','shims'),
  join(env.ChocolateyInstall||env.CHOCOLATEYINSTALL,'bin'),join(env.ProgramData||env.PROGRAMDATA,'chocolatey','bin'),join(env.LOCALAPPDATA,'Microsoft','WinGet','Links'),
  join(env.LOCALAPPDATA,'Microsoft','WindowsApps'),...fnm,join(home,'.local','bin'),join(env.ProgramFiles||'C:\\Program Files','nodejs'),join(env.LOCALAPPDATA,'Programs')];
 const common=[join(home,'.local','bin'),join(home,'.npm-global','bin')];
 if(osName!=='darwin')return common;
 // https://github.com/nvm-sh/nvm ; https://asdf-vm.com/guide/getting-started.html ; https://mise.jdx.dev/dev-tools/shims.html
 const nodeVersions=join(env.NVM_DIR||join(home,'.nvm'),'versions','node');
 const latest=newestNodeVersion(nodeVersions);
 return [...common,'/opt/homebrew/bin','/usr/local/bin',latest&&join(nodeVersions,'v'+latest,'bin'),...fnm,
  join(env.VOLTA_HOME||join(home,'.volta'),'bin'),join(env.BUN_INSTALL||join(home,'.bun'),'bin'),join(env.ASDF_DATA_DIR||join(home,'.asdf'),'shims'),
  join(env.MISE_DATA_DIR||join(env.XDG_DATA_HOME||join(home,'.local','share'),'mise'),'shims'),...pnpmDirs];
}
function agentEnvironmentSnapshot(base=process.env,refresh=false,options={}){
 const env=sanitizeAgentEnv(base),osName=options.platform||process.platform,win=osName==='win32';
 const home=options.home||(win?env.USERPROFILE:env.HOME)||os.homedir();
 const pathSources=['process'],inherited=platform.environmentPath(env,osName);
 if(win){
  if(refresh&&process.platform==='win32')windowsInstalledApps(env,{refresh:true});
  const reg=(options.registryEnvironment||registryEnvironment)(env);
  const vars=new Map(Object.entries({...env,...Object.fromEntries(Object.entries(reg.variables||{}).filter(([,v])=>typeof v==='string'))}).map(([k,v])=>[k.toLowerCase(),v]));
  vars.set('path',inherited);
  function expand(raw){
   let value=raw||'';
   for(let i=0;i<12 && /%[^%]+%/.test(value);i++){
    const next=value.replace(/%([^%]+)%/g,(original,key)=>vars.get(key.toLowerCase())??original);
    if(next===value||next.length>65536)break;
    value=next;
   }
   return value.split(';').filter(dir=>!/%[^%]+%/.test(dir));
  }
  if(typeof reg.user==='string')pathSources.push('registry-user');
  if(typeof reg.system==='string')pathSources.push('registry-system');
  const dirs=mergedPath([...expand(inherited),...expand(reg.user),...expand(reg.system),...toolchainDirs(env,home,osName)],true);
  return {env:platform.environmentWithPath(env,dirs.join(';'),osName),pathSources,loginShellTimedOut:false};
 }
 const cacheKey=JSON.stringify([home,env.SHELL,osName]);
 if(refresh||shellCache?.key!==cacheKey||Date.now()-shellCache.at>5*60_000){
  const shell=path.isAbsolute(env.SHELL||'')?env.SHELL:'/bin/zsh';
  const marker='__CW_LOGIN_ENV_7B31__';
  const run=options.spawnSync||spawnSync;
  const result=run(shell,['-ilc',`printf '${marker}\\0'; /usr/bin/env -0`],{env,encoding:'utf8',timeout:8000,maxBuffer:1024*1024});
  const output=result.stdout||'', at=output.indexOf(marker+'\0'),values={};
  if(result.status===0&&at>=0)for(const pair of output.slice(at+marker.length+1).split('\0')){
   const i=pair.indexOf('=');if(i<1)continue;const key=pair.slice(0,i);
   if(/^(PATH|LANG|LC_[A-Z_]+|https?_proxy|all_proxy|no_proxy|HTTPS?_PROXY|ALL_PROXY|NO_PROXY|CODEX_HOME|CLAUDE_CONFIG_DIR|CODEBUDDY_CONFIG_DIR|CODEBUDDY_INTERNET_ENVIRONMENT)$/.test(key))values[key]=pair.slice(i+1);
  }
  if(osName==='darwin'&&!Object.keys({...env,...values}).some(k=>/^(https?|all)_proxy$/i.test(k))){
   const proxy=run('/usr/sbin/scutil',['--proxy'],{encoding:'utf8',timeout:1000}).stdout||'';
   for(const protocol of ['HTTP','HTTPS']){
    if(new RegExp(`${protocol}Enable\\s*:\\s*1`).test(proxy)){
     const host=proxy.match(new RegExp(`${protocol}Proxy\\s*:\\s*([^\\s]+)`))?.[1],port=proxy.match(new RegExp(`${protocol}Port\\s*:\\s*(\\d+)`))?.[1];
     if(host&&port)values[protocol.toLowerCase()+'_proxy']=`http://${host}:${port}`;
    }
   }
  }
  shellCache={key:cacheKey,at:Date.now(),values,timedOut:result.error?.code==='ETIMEDOUT'};
 }
 if(shellCache.values.PATH)pathSources.push('login-shell');
 if(osName==='darwin')pathSources.push('fallback');
 const dirs=mergedPath([...(shellCache.values.PATH||'').split(':'),...inherited.split(':'),...toolchainDirs({...env,...shellCache.values},home,osName)],false);
 return {env:{...env,...shellCache.values,PATH:dirs.join(':')},pathSources,loginShellTimedOut:shellCache.timedOut};
}
function loginEnvironment(base=process.env,refresh=false){return agentEnvironmentSnapshot(base,refresh).env}
function agentPathCandidates(names,env,home,osName=process.platform,extraDirs=[]){
 const win=osName==='win32',p=win?path.win32:path.posix;
 const dirs=mergedPath([...platform.environmentPath(env,osName).split(p.delimiter),...toolchainDirs(env,home,osName),...extraDirs],win);
 return dirs.flatMap(dir=>names.flatMap(name=>(win?['.exe','.cmd','.bat','.ps1']:['']).map(ext=>p.join(dir,name+ext))));
}
// Use the registered installation root on all drives. These are the standard
// DisplayName/InstallLocation fields, not executable paths that we may run.
// https://learn.microsoft.com/en-us/windows/win32/msi/uninstall-registry-key
let installedAppsCache;
function windowsInstalledApps(env,options={}){
 if((options.platform||process.platform)!=='win32')return [];
 const now=(options.now||Date.now)(),read=options.read||windowsJson;
 if(!options.refresh&&installedAppsCache?.reader===read&&now-installedAppsCache.at<10000)return installedAppsCache.apps;
 const entries=read(String.raw`
  $entries = @(foreach ($hive in @([Microsoft.Win32.Registry]::CurrentUser,[Microsoft.Win32.Registry]::LocalMachine)) {
   foreach ($key in @('Software\Microsoft\Windows\CurrentVersion\Uninstall','Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall')) {
    $root=$hive.OpenSubKey($key)
    if (!$root) { continue }
    try { foreach ($name in $root.GetSubKeyNames()) {
     $item=$root.OpenSubKey($name)
     if ($item) { try {
      $display=$item.GetValue('DisplayName')
      if ($display -match '^(CodeBuddy|WorkBuddy|Kimi|MiniMax|DeepSeek Harness|OpenCode|Cursor|Qwen)(?:\b|$)') {
       $folder=$item.GetValue('InstallLocation')
       $desktopIcon=if (!$folder -and $display -match '^WorkBuddy(?:\s|$)') { $item.GetValue('DisplayIcon') }
       @{name=$display;path=$folder;icon=$desktopIcon}
      }
     } finally { $item.Close() } }
    } } finally { $root.Close() }
   }
  })
  ConvertTo-Json -InputObject $entries -Compress
 `,env);
 const apps=[];
 for(const item of Array.isArray(entries)?entries:[]){
  if(typeof item?.name!=='string')continue;
  if(typeof item.path==='string'&&/^[A-Z]:[\\/]/i.test(item.path)){apps.push({name:item.name,path:item.path});continue}
  // WorkBuddy 5.11.3 on Windows (2026-11-20): user installation registers only
  // DisplayIcon. It identifies the desktop app; the GUI is never a CLI candidate.
  if(!/^WorkBuddy(?:\s|$)/i.test(item.name)||item.path||typeof item.icon!=='string')continue;
  const match=item.icon.trim().match(/^(?:"([^"]+)"|([^",]+)),\s*0$/);
  const icon=match?.[1]||match?.[2];
  if(icon&&/^[A-Z]:\\/i.test(icon)&&/\\Programs\\WorkBuddy\\WorkBuddy\.exe$/i.test(icon)
      &&!/[%"*?<>\r\n]/.test(icon)&&path.win32.normalize(icon)===icon)apps.push({name:item.name,path:path.win32.dirname(icon)});
 }
 // The first call returns only once the read finishes; a transient failure can be retried.
 if(Array.isArray(entries))installedAppsCache={reader:read,at:now,apps};
 return apps;
}
// https://github.com/deepseek-ai/deepseek-harness/blob/master/apps/desktop/README.md#bundled-command-runtime
function deepseekWindowsBins(env,installedRoots){
 const roots=installedRoots??windowsInstalledApps(env).filter(app=>/^DeepSeek Harness(?:\s|$)/i.test(app.name)).map(app=>app.path);
 return roots.filter(dir=>typeof dir==='string'&&/^[A-Z]:[\\/]/i.test(dir)).map(dir=>path.win32.join(dir,'resources','runtime','cli','bin'));
}
// Only inspect the DOS/PE headers, including for large executables.
// https://learn.microsoft.com/en-us/windows/win32/debug/pe-format#optional-header-windows-specific-fields-image-only
function isConsoleProgram(file,io){
 const fd=io.openSync(file,'r');
 try{
  const dos=Buffer.alloc(64),header=Buffer.alloc(94);
  if(io.readSync(fd,dos,0,dos.length,0)!==dos.length||dos.readUInt16LE(0)!==0x5a4d)return false;
  if(io.readSync(fd,header,0,header.length,dos.readUInt32LE(60))!==header.length)return false;
  const flags=header.readUInt16LE(22);
  return header.readUInt32LE(0)===0x4550 && (flags&0x2002)===2 && header.readUInt16LE(20)>=70
   && [0x10b,0x20b].includes(header.readUInt16LE(24)) && header.readUInt16LE(92)===3;
 }finally{io.closeSync(fd)}
}
function agentFileStatus(file,osName=process.platform,io=fs){
 const win=osName==='win32';
 if(!(win?path.win32:path.posix).isAbsolute(file))return 'invalid';
 try{
  if(win&&/[\\/]Microsoft[\\/]WindowsApps[\\/][^\\/]+\.exe$/i.test(file)){
   // App execution aliases are reparse points. A normal stat/access can fail even when CreateProcess can launch the alias.
   const alias=io.lstatSync(file);
   if(alias.isSymbolicLink()||(alias.isFile()&&alias.size===0))return isWorkBuddyProgram(file)?'invalid':'executable';
  }
  const stat=io.statSync(file);
  if(!stat.isFile()||(win&&!/\.(?:exe|cmd|bat|ps1)$/i.test(file))||isWorkBuddyProgram(file))return 'invalid';
  if(win&&/\.cmd$/i.test(file)){
   const shim=windowsShim(file,process.env);
   if(shim?.editor||shim?.incomplete||(shim?.file&&!shim.harness&&!isConsoleProgram(shim.file,io)))return 'invalid';
  }
  if(win&&/\.exe$/i.test(file)&&!isConsoleProgram(file,io))return 'invalid';
  io.accessSync(file,fs.constants.X_OK);
  return 'executable';
 }catch(error){return ['EACCES','EPERM'].includes(error.code)?'access-denied':error.code==='ENOENT'||error.code==='ENOTDIR'?'missing':'invalid'}
}
function fileIdentity(file){try{return fs.realpathSync(file)}catch{return file}}
/** Codex only: asks the program itself for its version. Claude Code is never run (see claudeVersionFromFiles). */
function versionOf(kind,file,env,options={}){
 if(kind!=='codex')return null;
 const real=fileIdentity(file);
 let stat;try{stat=fs.statSync(file)}catch{/* An execution alias can be started without following its reparse point. */}
 const stamp=stat&&stat.mtimeMs+':'+stat.size,key=stamp&&kind+':'+real+':'+stamp;
 if(key&&!options.refresh&&versions.has(key))return versions.get(key);
 const launch=agentLaunch(file,['--version'],{env,encoding:'utf8',timeout:4000,maxBuffer:65536},options.platform,true);
 let r;
 try{r=(options.versionSpawn||spawnSync)(launch.file,launch.args,launch.options)}catch(error){r={error}}

 const value=String(r.stdout||'').trim();
 if(r.status===0&&/^codex(?:-cli)?\b/i.test(value)){
  const result={version:value,semver:value.match(/\d+\.\d+\.\d+(?:-[\w.-]+)?/)?.[0]||'0.0.0'};
  if((options.platform||process.platform)==='win32')rememberCodexExecutable(file);
  if(key)versions.set(key,result);
  unreadableVersions.delete(real);
  return result;
 }
 if(key)versions.delete(key);
 if(stamp)unreadableVersions.set(real,stamp);
 return storeCodexDenied(file,r.error?.code,String(r.stderr||''))?{denied:true}:null;
}
/**
 * Claude Code's version, read only from what is installed beside it: its bundle's Info.plist, its npm package.json, or
 * the version folder in its real path. Detection never runs Claude Code, not even `--version` or `auth status`.
 * Actual execution belongs only to the explicit unified connection gate. A file that is there and executable is found.
 */
function claudeVersionFromFiles(file){
 let real=file;try{real=fs.realpathSync(file)}catch{/* Keep the path as given. */}
 const bundle=real.match(/^(.*\.app)[\\/]Contents[\\/]MacOS[\\/][^\\/]+$/)?.[1];
 if(bundle)try{
  const plist=fs.readFileSync(path.join(bundle,'Contents','Info.plist'),'utf8');
  const value=plist.match(/<key>CFBundleShortVersionString<\/key>\s*<string>\s*(\d+\.\d+\.\d+[^<\s]*)\s*<\/string>/)?.[1];
  if(value)return value;
 }catch{/* No readable XML Info.plist. */}
 for(let dir=path.dirname(real),i=0;i<5&&dir!==path.dirname(dir);i++,dir=path.dirname(dir)){
  try{const pkg=JSON.parse(fs.readFileSync(path.join(dir,'package.json'),'utf8'));if(pkg.name==='@anthropic-ai/claude-code'&&typeof pkg.version==='string')return pkg.version}catch{/* Not its package. */}
 }
 return real.split(/[\\/]/).reverse().map(part=>part.match(/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/)?.[0]).find(Boolean);
}
function compareVersions(a,b){
 const [ac,ap]=a.split(/-(.*)/s),[bc,bp]=b.split(/-(.*)/s),x=ac.split('.').map(Number),y=bc.split('.').map(Number);
 for(let i=0;i<3;i++)if(x[i]!==y[i])return x[i]-y[i];
 if(ap===undefined||bp===undefined)return Number(ap===undefined)-Number(bp===undefined);
 const as=ap.split('.'),bs=bp.split('.');for(let i=0;i<Math.max(as.length,bs.length);i++){
  if(as[i]===bs[i])continue;if(as[i]===undefined)return -1;if(bs[i]===undefined)return 1;
  const an=/^\d+$/.test(as[i]),bn=/^\d+$/.test(bs[i]);if(an&&bn)return Number(as[i])-Number(bs[i]);if(an!==bn)return an?-1:1;return as[i].localeCompare(bs[i]);
 }return 0;
}
// Windows：微软商店装的桌面 App（MSIX）把命令行放在自己的包目录里，不进 PATH。
// 包目录从当前用户的注册表读（没有就按默认位置拼）；商店每次更新目录名都会变，所以每次现查，只缓存 15 秒。
let packageCache;
function windowsPackageRoots(prefixes,options={}){
 if(options.packageRoots)return options.packageRoots(prefixes);
 if((options.platform||process.platform)!=='win32'||(process.platform!=='win32'&&!options.spawnSync))return [];
 const env=options.env||process.env,key=prefixes.join('|'),now=Date.now();
 if(!options.refresh&&packageCache&&packageCache.key===key&&now-packageCache.at<15000)return packageCache.roots;
 const query=(key,value)=>queryWindowsRegistry(key,value,env,options.spawnSync);
 const roots=[];
 for(const line of query('HKCU\\Software\\Classes\\Local Settings\\Software\\Microsoft\\Windows\\CurrentVersion\\AppModel\\Repository\\Packages').split(/\r?\n/).map(l=>l.trim())){
  const name=line.split('\\').pop()||'';
  if(!/^HKEY_/i.test(line)||!prefixes.some(prefix=>name.toLowerCase().startsWith(prefix.toLowerCase())))continue;
  const folder=query(line,'PackageRootFolder').match(/PackageRootFolder\s+REG_\w+\s+(.+)/i)?.[1]?.trim();
  roots.push(folder&&path.win32.isAbsolute(folder)?folder:path.win32.join(env.ProgramFiles||'C:\\Program Files','WindowsApps',name));
 }
 packageCache={key,at:now,roots};return roots;
}
/** Codex 桌面版（商店版、安装版）自带的命令行：和 Mac 上 Codex.app 里的那份一样能直接用。 */
function windowsCodexCandidates(options={}){
 const env=options.env||process.env,win=(options.platform||process.platform)==='win32',files=[];
 if(!win&&!options.packageRoots)return files;
 const p=win?path.win32:path;
 for(const root of windowsPackageRoots(['OpenAI.Codex_','OpenAI.ChatGPT'],{...options,env}))files.push(p.join(root,'app','resources','codex.exe'));
 if(win&&env.LOCALAPPDATA)for(const app of ['Codex','ChatGPT'])for(const relative of [['resources','codex.exe'],['app','resources','codex.exe']])files.push(p.join(env.LOCALAPPDATA,'Programs',app,...relative));
 return files;
}
function agentCandidates(kind,options={}){
 if(!['codex','claude'].includes(kind))throw Error('未知智能体');
 const home=options.home||os.homedir(),env=options.env||loginEnvironment(process.env,options.refresh),candidates=[];
 const osName=options.platform||process.platform,p=osName==='win32'?path.win32:path.posix;
 const add=(file,source)=>{if(file&&!(kind==='codex'&&/[\\/]runtime[\\/]support[\\/]bin[\\/]codex$/.test(file))&&!candidates.some(c=>c.path===file))candidates.push({path:file,source})};
 const configured=options.configured||'';
 if(configured)add(configured,'manual');
 else{
  add(env[kind==='codex'?'LINKREADER_CODEX_EXECUTABLE':'LINKREADER_CLAUDE_EXECUTABLE'],'environment');
  for(const file of agentPathCandidates([kind],env,home,osName))add(file,'PATH');
  for(const apps of options.applicationDirs||(osName==='darwin'?[p.join(home,'Applications'),'/Applications']:[]))if(kind==='codex')for(const app of ['Codex.app','ChatGPT.app'])for(const relative of ['Contents/Resources/codex','Contents/Resources/codex-cli/bin/codex','Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex'])add(p.join(apps,app,relative),'app');
  if(osName==='win32'&&kind==='codex'){
   const npm=env.APPDATA&&p.join(env.APPDATA,'npm','node_modules','@openai','codex');
   if(npm)for(const base of [p.join(npm,'vendor'),p.join(npm,'node_modules','@openai','codex-win32-x64','vendor')])add(p.join(base,'x86_64-pc-windows-msvc','codex','codex.exe'),'npm');
  }
  if(kind==='codex')for(const file of windowsCodexCandidates({env,platform:options.platform,packageRoots:options.packageRoots,refresh:options.refresh}))add(file,'app');
  if(kind==='claude'&&osName==='darwin'){
   const dir=p.join(home,'Library/Application Support/Claude/claude-code');
   try{for(const version of fs.readdirSync(dir).filter(v=>/^\d+\.\d+\.\d+/.test(v)).sort((a,b)=>compareVersions(b,a)).slice(0,8)){
    for(const relative of ['claude','bin/claude','claude-code','claude.app/Contents/MacOS/claude'])add(p.join(dir,version,relative),'app');
    // Newer Claude apps keep each version in a build folder: claude-code/<version>/<build>/claude.app.
    try{for(const build of fs.readdirSync(p.join(dir,version)).filter(b=>!b.startsWith('.')&&!b.endsWith('.app')))add(p.join(dir,version,build,'claude.app/Contents/MacOS/claude'),'app')}catch{/* Not a folder. */}
   }}catch{/* No Claude app here. */}
  }
 }
 return candidates;
}
function detectAgent(kind,options={}){
 const env=options.env||loginEnvironment(process.env,options.refresh);
 const configured=options.configured||'';
 const candidates=agentCandidates(kind,{...options,env});
 const seen=new Set();
 for(const item of candidates){
  item.status=agentFileStatus(item.path,options.platform);
  if(item.status!=='executable')continue;
  const real=fileIdentity(item.path);
  if(kind==='codex'&&(/(?:^|[\\/])claude(?:-code)?(?:\.(?:exe|cmd|bat|ps1))?$/i.test(item.path)||/(?:^|[\\/])claude(?:-code)?(?:\.(?:exe|cmd|bat|ps1))?$/i.test(real)||/[\\/]@anthropic-ai[\\/]claude-code[\\/]|[\\/]claude[\\/]versions[\\/]/.test(real))){item.status='invalid';continue;}
  if(seen.has(real)){item.status='duplicate';continue}seen.add(real);
  // Claude Code: found when the file is there and executable; it is never started, so its version comes from files.
  if(kind==='claude'){const semver=claudeVersionFromFiles(item.path);Object.assign(item,{status:'valid',semver:semver||'0.0.0'},semver?{version:semver}:{});continue}
  const version=versionOf(kind,item.path,env,options);if(version?.denied){item.status='access-denied';continue;}if(version){Object.assign(item,version);item.status='valid'}else item.status='invalid';
 }
 const selected=candidates.filter(c=>c.status==='valid').sort((a,b)=>compareVersions(b.semver,a.semver))[0];
 const notice=kind==='codex'&&!selected&&candidates.some(c=>c.status==='access-denied'&&storeCodexDenied(c.path,'EACCES'))?storeAccessHint:undefined;
 if(kind==='codex'){if(notice)storeNotices.set(configured,notice);else storeNotices.delete(configured)}
 return {...(notice?{notice}:{}),kind,host:os.hostname(),mode:configured?'manual':'auto',executable:selected?.path,version:selected?.version,candidates,state:selected?'installed':configured?'invalid':'missing'};
}
/** The program a work module runs: Codex only. Claude Code is detected and listed, never resolved for running. */
function resolveAgent(kind,configured='',options={}){
 if(kind!=='codex')throw Error('工作台不调用 Claude Code，只检测它是否安装');
 const result=detectAgent(kind,{...options,configured});
 if(!result.executable&&result.notice)throw Error(result.notice);
 if(!result.executable)throw Error(configured?`所选 ${kind} 不存在、不可执行或不是正确的 CLI：${configured}`:'未找到 Codex，请安装或手动指定服务主机上的程序');
 return result.executable;
}
module.exports={isWorkBuddyProgram,storeCodexDenied,storeAccessHint,windowsShim,storeCodexAccessNotice,agentFileStatus,windowsInstalledApps,windowsPackageRoots,queryWindowsRegistry,registryEnvironment,agentEnvironmentSnapshot,agentPathCandidates,agentCandidates,codexVersionUnreadable,deepseekWindowsBins,sanitizeAgentEnv,loginEnvironment,detectAgent,resolveAgent,compareVersions,claudeVersionFromFiles,windowsCodexCandidates};
