const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const installation=require('./agent-installation.cjs');
const {agentLaunch,windowsShim,storeAccessHint}=require('./agent-launch.cjs');

test('中文 PATH 和商店 PackageRootFolder 用系统 cmd 切换 UTF-8，变量只逐个读取',()=>{
 const calls=[],env={SystemRoot:'C:\\Windows'};
 const run=(program,args,opts)=>{
  assert.equal(program,'C:\\Windows\\System32\\cmd.exe');assert.equal(opts.encoding,'utf8');
  assert.match(args.at(-1),/chcp\.com" 65001 >nul && .*reg\.exe" query/);
  calls.push(opts.env.OT_REG_VALUE||'package keys');
  const {OT_REG_KEY:key,OT_REG_VALUE:value}=opts.env;
  if(key.endsWith('Packages'))return {status:0,stdout:key.replace('HKCU','HKEY_CURRENT_USER')+'\\OpenAI.Codex_2.0_x64__abc\r\n'};
  if(value==='PackageRootFolder')return {status:0,stdout:'    PackageRootFolder    REG_SZ    D:\\中文 软件\\商店'};
  if(value==='Path'&&key.startsWith('HKCU'))return {status:0,stdout:'    Path    REG_EXPAND_SZ    %TOOLROOT%\\命令行'};
  if(value==='TOOLROOT')return {status:0,stdout:'    TOOLROOT    REG_SZ    E:\\工具 仓库'};
  return {status:1};
 };
 const registry=installation.registryEnvironment(env,(k,v,e)=>installation.queryWindowsRegistry(k,v,e,run));
 assert.equal(registry.user,'%TOOLROOT%\\命令行');assert.equal(registry.variables.TOOLROOT,'E:\\工具 仓库');
 assert.deepEqual(installation.windowsPackageRoots(['OpenAI.Codex_'],{platform:'win32',refresh:true,env,spawnSync:run}),['D:\\中文 软件\\商店']);
 assert.deepEqual(calls,['Path','Path','TOOLROOT','package keys','PackageRootFolder']);
});

test('已安装程序首次读取完成后返回；四处卸载键、十秒缓存和重新查找',()=>{
 let reads=0,now=1000;
 const opts={platform:'win32',now:()=>now,read(script){
  reads++;for(const literal of ['::CurrentUser','::LocalMachine','WOW6432Node','InstallLocation'])assert(script.includes(literal));
  return [{name:'DeepSeek Harness',path:'D:\\自选 '+reads},{name:'WorkBuddy',path:'E:\\工作台'},{name:'other',path:'relative'}];
 }};
 assert.equal(installation.windowsInstalledApps({},opts)[0].path,'D:\\自选 1');
 now+=9999;assert.equal(installation.windowsInstalledApps({},opts)[0].path,'D:\\自选 1');
 now++;assert.equal(installation.windowsInstalledApps({},opts)[0].path,'D:\\自选 2');
 assert.equal(installation.windowsInstalledApps({},{...opts,refresh:true}).length,2);assert.equal(reads,3);
});

test('WorkBuddy 5.11.3 空安装目录只取已核实的桌面图标，绝不从图标构造命令行',()=>{
 const folder='D:\\测试账户\\AppData\\Local\\Programs\\WorkBuddy',icon=folder+'\\WorkBuddy.exe';
 const rows=[{name:'WorkBuddy 5.11.3',path:'',icon:icon+',0'},{name:'WorkBuddy',path:null,icon:'"'+icon+'",0'},
  {name:'WorkBuddy',icon:'WorkBuddy.exe,0'},{name:'WorkBuddy',icon:folder+'\\other.exe,0'},
  {name:'WorkBuddy',icon:icon+',1'},{name:'CodeBuddy',icon:icon+',0'}];
 assert.deepEqual(installation.windowsInstalledApps({},{platform:'win32',read:()=>rows}),[
  {name:'WorkBuddy 5.11.3',path:folder},{name:'WorkBuddy',path:folder}]);
});
test('补查自定义和默认包管理器、商店别名和命令优先级',()=>{
 const env={PATH:'',USERPROFILE:'D:\\家',LOCALAPPDATA:'D:\\本地',APPDATA:'D:\\漫游',PNPM_HOME:'D:\\自定pnpm',VOLTA_HOME:'E:\\volta',SCOOP:'F:\\scoop',ProgramData:'C:\\数据'};
 const files=installation.agentPathCandidates(['agent'],env,env.USERPROFILE,'win32');
 const order=['D:\\漫游\\npm','D:\\自定pnpm','D:\\本地\\pnpm','E:\\volta\\bin','D:\\本地\\Volta\\bin','D:\\本地\\Yarn\\bin','D:\\家\\.bun\\bin','F:\\scoop\\shims','D:\\家\\scoop\\shims','C:\\数据\\chocolatey\\bin','D:\\本地\\Microsoft\\WinGet\\Links','D:\\本地\\Microsoft\\WindowsApps'];
 let last=-1;
 for(const dir of order){
  const at=files.indexOf(dir+'\\agent.exe');assert(at>last,dir);last=at;
  assert.deepEqual(files.slice(at,at+4),['exe','cmd','bat','ps1'].map(ext=>dir+'\\agent.'+ext));
 }
 const alias='C:\\本地\\Microsoft\\WindowsApps\\agent.exe';
 assert.equal(installation.agentFileStatus(alias,'win32',{lstatSync(){return {isSymbolicLink:()=>true}},statSync(){throw Error('alias stat should not run')}}),'executable');
});

test('Windows 普通文件即使可读也不能作为智能体程序',()=>{
 const io={statSync:()=>({isFile:()=>true}),accessSync(){}};
 for(const name of ['claude','claude.txt','claude.cjs','claude.mjs'])
  assert.equal(installation.agentFileStatus('C:\\fixture\\'+name,'win32',io),'invalid',name);
 for(const name of ['claude.CMD','claude.bat','claude.ps1'])
  assert.equal(installation.agentFileStatus('C:\\fixture\\'+name,'win32',io),'executable',name);
});

function peHeader(format=0x20b,subsystem=3,flags=2){
 const bytes=Buffer.alloc(256);
 bytes.writeUInt16LE(0x5a4d);bytes.writeUInt32LE(128,60);bytes.writeUInt32LE(0x4550,128);
 bytes.writeUInt16LE(100,148);bytes.writeUInt16LE(flags,150);bytes.writeUInt16LE(format,152);bytes.writeUInt16LE(subsystem,220);
 return bytes;
}

test('PE32 和 PE32+ 只接受控制台程序，拒绝窗口程序、DLL 和改名的文本',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'task57-pe-'));t.after(()=>fs.rmSync(dir,{force:true,recursive:true}));
 const file=path.join(dir,'claude.exe');
 for(const format of [0x10b,0x20b])for(const subsystem of [2,3]){
  fs.writeFileSync(file,peHeader(format,subsystem),{mode:0o755});
  assert.equal(installation.agentFileStatus(file,'win32'),subsystem===2?'invalid':'executable');
 }
 for(const payload of ['not an executable',peHeader(0x20b,3,0x2002)]){
  fs.writeFileSync(file,payload);
  assert.equal(installation.detectAgent('claude',{configured:file,platform:'win32',env:{PATH:''}}).state,'invalid');
 }
});

test('npm、pnpm、Yarn 的固定转发外壳还原为 node + 入口，自定义脚本沿原启动边界',()=>{
 const file='D:\\中文 目录\\bin\\agent.cmd',env={PATH:'E:\\node',NODE_PATH:'E:\\old'};
 const target='D:\\中文 目录\\bin\\node_modules\\tool\\cli.js',node='E:\\node\\node.exe';
 const present=p=>[target,node].includes(p);
 const resolve=body=>windowsShim(file,env,()=>body,present);
 const npm=['@ECHO off','GOTO start',':find_dp0','SET dp0=%~dp0','EXIT /b',':start','SETLOCAL','CALL :find_dp0','IF EXIST "%dp0%\\node.exe" (',' SET "_prog=%dp0%\\node.exe"',') ELSE (',' SET "_prog=node"',')','endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & set PATHEXT=%PATHEXT:;.JS;=;% & "%_prog%"  "%dp0%\\node_modules\\tool\\cli.js" %*'].join('\r\n');
 const classic=['@IF EXIST "%~dp0\\node.exe" (',' "%~dp0\\node.exe" "%~dp0\\node_modules\\tool\\cli.js" %*',') ELSE (',' @SETLOCAL',' @SET PATHEXT=%PATHEXT:;.JS;=;%',' node "%~dp0\\node_modules\\tool\\cli.js" %*',')'].join('\r\n');
 const pnpm='@SETLOCAL\r\n@IF NOT DEFINED NODE_PATH (\r\n @SET "NODE_PATH=D:\\global"\r\n) ELSE (\r\n @SET "NODE_PATH=D:\\global;%NODE_PATH%"\r\n)\r\n'+classic;
 for(const text of [npm,classic,pnpm]){
  const result=resolve(text);assert.equal(result.file,node);assert.deepEqual(result.args,[target]);
  assert.equal(result.env.NODE_PATH,text===pnpm?'D:\\global;E:\\old':'E:\\old');
 }
 assert.equal(resolve('echo setup\r\n'+npm),undefined);
 assert.deepEqual(resolve('@set ELECTRON_RUN_AS_NODE=1\r\n"editor.exe" %*'),{editor:true});
 assert.deepEqual(windowsShim(file,env,()=>'@"%~dp0\\tools\\agent.exe" %*',()=>true),{file:'D:\\中文 目录\\bin\\tools\\agent.exe',args:[],env});
});

test('Codex UTF-8 启动保留中文、引号和控制符的原始参数；拒绝访问提示可恢复',t=>{
 const arg=['exec','D:\\中文 工程\\片子.mp4','%PATH% & "text"','换\n行'];
 for(const ext of ['exe','cmd']){
  const result=agentLaunch('D:\\工具\\codex.'+ext,arg,{env:{}},'win32');
  assert.equal(result.options.shell,false);assert.equal(result.args.at(-1),'""%OT_UTF8_SCRIPT%""');
  assert.deepEqual(JSON.parse(result.options.env.OT_UTF8_REQUEST).args,arg);
  assert.match(fs.readFileSync(result.options.env.OT_UTF8_SCRIPT,'utf8'),/chcp\.com" 65001 >nul/);
 }
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'task57-denied-'));t.after(()=>fs.rmSync(dir,{force:true,recursive:true}));
 const root=path.join(dir,'WindowsApps','OpenAI.Codex_2.0_x64__fixture');
 const file=path.join(root,'app','resources','codex.exe');fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,peHeader(),{mode:0o755});
 const options={home:dir,env:{PATH:path.join(dir,'empty')},applicationDirs:[],configured:file,versionSpawn:()=>({error:{code:'EACCES'}})};
 assert.equal(installation.detectAgent('codex',options).notice,storeAccessHint);assert.equal(installation.storeCodexAccessNotice(file),storeAccessHint);
 assert.throws(()=>installation.resolveAgent('codex',file,options),/npm install -g @openai\/codex/);
 assert.equal(installation.detectAgent('codex',{...options,versionSpawn:()=>({status:0,stdout:'codex-cli 1.0.0'})}).executable,file);
 assert.equal(installation.storeCodexAccessNotice(file),undefined);
});

test('实测 dsh.cmd 模板保留 Electron 运行模式、内部模块参数和 ACP；随附档缺失不启动 GUI',t=>{
 const base=fs.mkdtempSync(path.join(os.tmpdir(),'task57-dsh-'));t.after(()=>fs.rmSync(base,{recursive:true,force:true}));
 const root='D:\\中文 工具\\DeepSeek Harness',cmd=path.win32.join(root,'resources','runtime','cli','bin','dsh.cmd');
 const exe=path.win32.join(root,'DeepSeek Harness.exe'),asar=path.win32.join(root,'resources','app.asar');
 const local=win=>path.join(base,...path.win32.relative(root,win).split('\\'));
 const write=(win,value)=>{fs.mkdirSync(path.dirname(local(win)),{recursive:true});fs.writeFileSync(local(win),value)};
 const canonical=['@echo off','setlocal DisableDelayedExpansion','set "ELECTRON_RUN_AS_NODE=1"',
  '"%~dp0..\\..\\..\\..\\DeepSeek Harness.exe" --expose-internals "%~dp0..\\..\\..\\app.asar\\dsh\\node_modules\\@deepseek-ai\\dsh-desktop-host\\lib\\cli.js" %*','exit /b %errorlevel%'].join('\r\n');
 write(cmd,canonical);write(exe,'fake desktop host');write(asar,'fake archive');
 const env={DEEPSEEK_API_KEY:'fictional-fixture-key'},read=p=>fs.readFileSync(local(p),'utf8'),isFile=p=>fs.existsSync(local(p));
 const resolved=windowsShim(cmd,env,read,isFile);
 assert.equal(resolved.harness,true);assert.equal(resolved.file,exe);assert.equal(resolved.args[0],'--expose-internals');
 assert.equal(resolved.args[1],path.win32.join(asar,'dsh','node_modules','@deepseek-ai','dsh-desktop-host','lib','cli.js'));
 assert.equal(env.ELECTRON_RUN_AS_NODE,undefined);
 // Windows' binary and archive aren't run here. This fake host verifies the exact child
 // environment/argv and answers the ACP initialize/session handshake over real stdio.
 const fixture=path.join(base,'fixture-host.cjs');
 fs.writeFileSync(fixture,[
  "const assert=require('node:assert/strict'),fs=require('node:fs');",
  "assert.equal(process.env.ELECTRON_RUN_AS_NODE,'1');assert.equal(process.env.DEEPSEEK_API_KEY,'fictional-fixture-key');",
  "assert.equal(process.argv[2],'--expose-internals');assert.match(process.argv[3],/dsh-desktop-host/);",
  "if(process.argv[4]==='--version'){console.log('0.2.2-rc.5');process.exit(0)}",
  "assert.deepEqual(process.argv.slice(4),['--profile','acp']);",
  "for(const line of fs.readFileSync(0,'utf8').trim().split('\\n')){const q=JSON.parse(line);console.log(JSON.stringify({jsonrpc:'2.0',id:q.id,result:q.method==='initialize'?{protocolVersion:1}:{sessionId:'fixture'}}));}",
 ].join('\n'));
 const run=(args,input='')=>require('node:child_process').execFileSync(process.execPath,[fixture,...resolved.args,...args],{encoding:'utf8',env:resolved.env,input});
 assert.equal(run(['--version']).trim(),'0.2.2-rc.5');
 const response=run(['--profile','acp'],['initialize','session/new'].map((method,i)=>JSON.stringify({jsonrpc:'2.0',id:i+1,method})).join('\n'));
 assert.deepEqual(response.trim().split('\n').map(s=>JSON.parse(s).result),[{protocolVersion:1},{sessionId:'fixture'}]);
 assert.deepEqual(windowsShim(cmd,env,()=>canonical.replace('DeepSeek Harness.exe','editor.exe'),isFile),{editor:true});
 fs.rmSync(local(asar));assert.deepEqual(windowsShim(cmd,env,read,isFile),{incomplete:true});
});

test('WorkBuddy 的桌面、两个内置入口和转发脚本都不能参与探测或启动',()=>{
 const root='D:\\软件\\腾讯 工作台',host=path.win32.join(root,'WorkBuddy.exe');
 const cli=path.win32.join(root,'resources','app.asar.unpacked','cli');
 const entry=path.win32.join(cli,'dist','codebuddy-lite-wb.mjs');
 const bin=path.win32.join(cli,'bin','codebuddy');
 for(const file of [host,entry,bin]){
  assert.equal(installation.agentFileStatus(file,'win32',{statSync:()=>({isFile:()=>true})}),'invalid');
  for(const args of [['--version'],['--acp','--permission-mode','bypassPermissions'],[]]){
   assert.throws(()=>agentLaunch(file,args,{},'win32'),/腾讯官方独立/);
  }
 }
 for(const target of [host,entry,bin]){
  const shim=windowsShim(path.win32.join(root,'codebuddy.cmd'),{},()=>'"'+target+'" %*',()=>true);
  assert.equal(shim.workBuddy,true);
 }
 assert.throws(()=>agentLaunch(path.win32.join(root,'unrelated.mjs'),[],{},'win32'),/普通脚本/);
 const independent='C:\\账户\\AppData\\Local\\codebuddy\\bin\\codebuddy.exe';
 const args=['--acp','--permission-mode','bypassPermissions'];
 const plan=agentLaunch(independent,args,{env:{CODEBUDDY_INTERNET_ENVIRONMENT:'internal'}},'win32');
 assert.equal(plan.file,independent);assert.deepEqual(plan.args,args);assert.equal(plan.options.env.ELECTRON_RUN_AS_NODE,undefined);
});

test('转发到内置程序的批处理、PowerShell 和 Mac 命令别名都不可登录',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'task57c-alias-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 for(const [name,body,platform] of [
  ['codebuddy.cmd','@"D:\\Apps\\WorkBuddy.exe" %*','win32'],
  ['cbc.bat','@"D:\\Apps\\WorkBuddy.exe" %*','win32'],
  ['cbc.ps1','& "D:\\Apps\\WorkBuddy.exe" @args','win32'],
  ['codebuddy','#!/bin/sh\nexec "/Applications/WorkBuddy.app/测试替身" "$@"','darwin'],
 ]){
  const file=path.join(dir,name);fs.writeFileSync(file,body,{mode:0o755});
  assert.equal(installation.isWorkBuddyProgram(file),true);assert.equal(installation.agentFileStatus(file,platform),'invalid');
  assert.throws(()=>agentLaunch(file,[],{},platform),/腾讯官方独立/);
 }
});

test('用户给 Codex 改名后版本检查和正式启动也经过 UTF-8 脚本',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'task57-manual-utf8-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const file=path.join(dir,'自定.exe');fs.writeFileSync(file,peHeader(),{mode:0o755});
 const options={platform:'win32',home:dir,env:{PATH:''},configured:file,versionSpawn(_file,_args,opts){
  assert.deepEqual(JSON.parse(opts.env.OT_UTF8_REQUEST).args,['--version']);return {status:0,stdout:'codex-cli 1.0.0'};
 }};
 assert.equal(installation.detectAgent('codex',options).executable,file);
 assert.deepEqual(JSON.parse(agentLaunch(file,['exec'],{env:{}},'win32').options.env.OT_UTF8_REQUEST).args,['exec']);
});
