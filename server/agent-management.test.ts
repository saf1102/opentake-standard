import {fakeNodeCli} from './test-support/fake-cli.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createAgentManagement,getAgentDiagnostics,setAgentProgramPath,type AgentManagementDeps} from './agent-management.ts';
import {connectionDefinition,defaultConnection,type ConnectionId,type ConnectionView} from '../shared/agent-connections.ts';
const view=(id:ConnectionId,patch:Partial<ConnectionView>={}):ConnectionView=>({...defaultConnection(id),...connectionDefinition(id),cliInstalled:false,relay:false,state:'unconfigured',...patch});

test('程序路径先验证 --version，只返回版本号，失败不保存；诊断不启动程序',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'task24-management-'));
 try{
  const marker=path.join(root,'ran');
  const markRun=`require('node:fs').writeFileSync(${JSON.stringify(marker)},'started')`;
  const file=fakeNodeCli(path.join(root,'qwen'),markRun);
  let writes=0,versions=0;
  const deps:AgentManagementDeps={assertAllowed:()=>{},version:async executable=>{versions++;assert.equal(executable,file);return 'qwen 1.2.3 private@example.com'},save:async(id,input)=>{writes++;return view(id,{cliPath:input.cliPath})}};
  const result=await setAgentProgramPath('qwen',file,deps);
  assert.equal(result.version,'1.2.3');assert.doesNotMatch(JSON.stringify(result),/private@example/);assert.equal(writes,1);assert.equal(versions,1);
  await assert.rejects(setAgentProgramPath('qwen',file,{...deps,version:async()=>{throw Error('TOKEN must not leak')}}),/未能回答 --version/);assert.equal(writes,1);
  await assert.rejects(setAgentProgramPath('qwen','relative/qwen',deps),/完整绝对路径/);
  const diagnostics=getAgentDiagnostics('qwen',{home:root,env:{PATH:root},configured:file});
  assert.deepEqual(diagnostics.candidates,[{path:file,status:'executable'}]);assert.equal(fs.existsSync(marker),false);
  const claude=fakeNodeCli(path.join(root,'claude'),markRun);
  await assert.rejects(setAgentProgramPath('qwen',claude,deps),/Claude Code/);assert.equal(versions,1);assert.equal(writes,1);assert.equal(fs.existsSync(marker),false);
 }finally{fs.rmSync(root,{recursive:true,force:true})}
});

test('管理入口守住 Claude 关闭门禁，终端和版本命令一个都不启动',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'task24-management-off-')),old=process.env.LINKREADER_CONNECTION_SETTINGS_FILE;
 process.env.LINKREADER_CONNECTION_SETTINGS_FILE=path.join(root,'connections.json');
 try{
  let calls=0;const deps:AgentManagementDeps={terminal:async()=>{calls++;return ''},version:async()=>{calls++;return '1.2.3'}};
  await assert.rejects(setAgentProgramPath('claude','/unused',deps),/开关已关闭/);
  const manager=createAgentManagement();await assert.rejects(manager.start('claude','logout',{},deps),/开关已关闭/);
  assert.equal(calls,0);
 }finally{if(old===undefined)delete process.env.LINKREADER_CONNECTION_SETTINGS_FILE;else process.env.LINKREADER_CONNECTION_SETTINGS_FILE=old;fs.rmSync(root,{recursive:true,force:true})}
});

test('安装仅发送核实过的固定命令，结束自动刷新本家；重复/取消与超时不冒充成功',async()=>{
 const manager=createAgentManagement(),refreshed:ConnectionId[]=[],scripts:string[]=[];
 let terminalState='waiting',now=100,installed=false;
 const deps:AgentManagementDeps={platform:'darwin',assertAllowed:()=>{},detect:async()=>undefined,pollMs:60000,now:()=>now,timeoutMs:1000,exitCode:()=>0,
  terminal:async script=>{scripts.push(script);return script.includes('do script')?'12:/dev/ttys007':terminalState},
  refresh:async id=>{refreshed.push(id);return view(id,{cliInstalled:installed})}};
 const command=connectionDefinition('qwen').installCommand!;
 await assert.rejects(manager.start('qwen','install',{command:command+'; echo injected'},deps),/未经确认/);assert.equal(scripts.length,0);
 assert.equal((await manager.start('qwen','install',{command},deps)).state,'waiting');
 assert.match(scripts[0],/npm install -g @qwen-code\/qwen-code@latest/);
 await assert.rejects(manager.start('qwen','install',{command},deps),/操作未结束/);
 assert.equal((await manager.check('qwen')).state,'waiting');assert.deepEqual(refreshed,[]);
 terminalState='finished';assert.equal((await manager.check('qwen')).state,'waiting');
 const afterExit=scripts.length;installed=true;assert.equal((await manager.check('qwen')).state,'complete');assert.deepEqual(refreshed,['qwen','qwen']);assert.equal(scripts.length,afterExit);
 await manager.start('qwen','install',{command},deps);assert.equal(manager.cancel('qwen').state,'cancelled');assert.equal((await manager.check('qwen')).state,'cancelled');
 await manager.start('qwen','install',{command},deps);now=1200;assert.equal((await manager.check('qwen')).state,'failed');assert.deepEqual(refreshed,['qwen','qwen']);
});

test('退出只运行本家固定参数；关闭终端但仍登录不报告成功，取消不关闭用户终端',async()=>{
 const manager=createAgentManagement(),scripts:string[]=[];
 let loggedIn=true;
 const deps:AgentManagementDeps={platform:'darwin',assertAllowed:()=>{},detect:async()=>'/fixture/cursor agent',pollMs:60000,
  terminal:async script=>{scripts.push(script);return script.includes('do script')?'15:/dev/ttys008':'closed'},
  refresh:async id=>view(id,{cliInstalled:true,connected:loggedIn,cliAuthState:loggedIn?'connected':'needs-login'})};
 await assert.rejects(manager.start('kimi','logout',{},deps),/退出登录待适配/);assert.equal(scripts.length,0);
 await manager.start('cursor','logout',{},deps);assert.match(scripts[0],/'\/fixture\/cursor agent' 'logout'/);
 assert.equal((await manager.check('cursor')).state,'failed');
 loggedIn=false;await manager.start('cursor','logout',{},deps);assert.equal((await manager.check('cursor')).state,'complete');
 await manager.start('cursor','logout',{},deps);const count=scripts.length;manager.cancel('cursor');assert.equal(scripts.length,count);
});

test('换账号必须成功退出后关闭本家会话再登录；失败与取消不越过顺序',async()=>{
 const manager=createAgentManagement(),order:string[]=[];let code:number|undefined,terminalState='waiting',connected=false;
 const deps:AgentManagementDeps={platform:'darwin',assertAllowed:()=>{},detect:async()=>'/fixture/cursor',pollMs:60000,
  terminal:async script=>script.includes('do script')?'17:/dev/ttys009':terminalState,exitCode:()=>code,
  rejectCredentials:id=>{order.push(`reject:${id}`)},closeSessions:async id=>{order.push(`close:${id}`)},
  loginStart:async id=>{order.push(`login:${id}`);return {waiting:true,connection:view(id,{cliInstalled:true,connected:false})}},
  loginCheck:async id=>({waiting:!connected,connection:view(id,{cliInstalled:true,connected})}),loginCancel:async()=>{order.push('cancel-login')},
  refresh:async id=>view(id,{cliInstalled:true})};
 await manager.start('cursor','switch-account',{},deps);assert.equal((await manager.check('cursor')).phase,'logout');assert.deepEqual(order,['reject:cursor']);
 terminalState='closed';assert.equal((await manager.check('cursor')).state,'failed');assert.deepEqual(order,['reject:cursor']);order.length=0;
 code=0;await manager.start('cursor','switch-account',{},deps);assert.equal((await manager.check('cursor')).phase,'login');assert.deepEqual(order,['reject:cursor','close:cursor','login:cursor']);
 assert.equal((await manager.check('cursor')).state,'waiting');connected=true;assert.equal((await manager.check('cursor')).state,'complete');
 connected=false;await manager.start('cursor','switch-account',{},deps);await manager.check('cursor');manager.cancel('cursor');assert.equal(order.at(-1),'cancel-login');assert.equal((await manager.check('cursor')).state,'cancelled');
});

test('升级仅接受本家官方固定命令，退出码为0且版本复查达标才成功',async()=>{
 const manager=createAgentManagement();let code=1,old=true,refreshes=0;const scripts:string[]=[];
 const deps:AgentManagementDeps={platform:'darwin',assertAllowed:()=>{},detect:async()=>'/fixture/qwen',pollMs:60000,exitCode:()=>code,
 terminal:async script=>{scripts.push(script);return script.includes('do script')?'18:/dev/ttys010':'finished'},
 refresh:async id=>{refreshes++;return view(id,{cliInstalled:true,cliVersion:old?'0.6.0':'0.6.1',filmOutdated:old})}};
 const command=connectionDefinition('qwen').upgradeCommand!;
 await assert.rejects(manager.start('qwen','upgrade',{command:command+'; false'},deps),/未经确认/);assert.equal(scripts.length,0);
 await manager.start('qwen','upgrade',{command},deps);assert.equal((await manager.check('qwen')).state,'failed');assert.equal(refreshes,0);
 code=0;await manager.start('qwen','upgrade',{command},deps);assert.equal((await manager.check('qwen')).state,'failed');assert.equal(refreshes,1);
 old=false;await manager.start('qwen','upgrade',{command},deps);assert.equal((await manager.check('qwen')).state,'complete');assert.equal(refreshes,2);
});

test('取消后旧检查迟到失败不能解锁新换账号；登录超时会清掉登录等待',async()=>{
 const {assertAgentWorkAllowed}=await import('./agent-connections.ts');
 const manager=createAgentManagement();let rejectClose:(error:Error)=>void=()=>{};let hold=true,now=0,cancels=0;
 const deps:AgentManagementDeps={platform:'darwin',assertAllowed:()=>{},detect:async()=>'/fixture/cursor',pollMs:60000,now:()=>now,timeoutMs:100,
  terminal:async script=>script.includes('do script')?'19:/dev/ttys011':'finished',exitCode:()=>0,rejectCredentials:()=>{},
  closeSessions:async()=>{if(hold)await new Promise<void>((_resolve,reject)=>{rejectClose=reject})},
  loginStart:async id=>({waiting:true,connection:view(id)}),loginCheck:async id=>({waiting:true,connection:view(id)}),loginCancel:async()=>{cancels++}};
 await manager.start('cursor','switch-account',{},deps);const old=manager.check('cursor');await new Promise(resolve=>setImmediate(resolve));manager.cancel('cursor');
 await manager.start('cursor','switch-account',{},deps);rejectClose(Error('old close failed'));await old;
 assert.throws(()=>assertAgentWorkAllowed('cursor'),/正在换账号/);
 hold=false;await manager.check('cursor');now=200;assert.equal((await manager.check('cursor')).state,'failed');assert.equal(cancels,1);assert.doesNotThrow(()=>assertAgentWorkAllowed('cursor'));
});

test('两版诊断分别列出十家候选结果，只复制公开的系统、位置与接口字段',async()=>{
 const {agentDiagnosticReport}=await import('./agent-diagnostic-report.ts');
 const {AGENT_CONNECTION_IDS}=await import('../shared/agent-connections.ts');
 const env={PATH:'private-path',COOKIE:'fixture-cookie',TOKEN:'fixture-token'};
 for(const edition of ['Pro','标准版'] as const){
  const seen:ConnectionId[]=[];
  const report=await agentDiagnosticReport(edition,{
   systemProxy:async()=>edition==='Pro'?'开':'关',
   home:'C:\\Users\\fixture-account',system:'Windows_NT 10.0.26100 x64',appVersion:'1.2.3',
   environment:()=>({env,pathSources:['process','registry-user','registry-system'],loginShellTimedOut:false}),
   config:id=>({...defaultConnection(id),mode:'api',baseUrl:'https://fixture-account:fixture-password@relay.example/fixture-tenant/v1?key=fixture-token#cookie',lastApiTest:{category:'credentials',httpStatus:401},message:'fixture-account'}),
   inventory:id=>{
    seen.push(id);
    const path='C:\\Users\\fixture-account\\AppData\\Local\\pnpm\\';
    return {id,name:connectionDefinition(id).name,mode:'auto',notice:undefined,acpVerification:undefined,
     candidates:[{path:path+'codex.cmd',status:'executable'},{path:path+'claude.exe',status:'missing'},
      {path:path+'qwen.ps1',status:'invalid'},{path:['','Users','another-account','fixture-secret','kimi'].join('/'),status:'version-unreadable'}]};
   },
  });
  assert.deepEqual(seen,AGENT_CONNECTION_IDS);
  for(const expected of [edition,'系统代理　'+(edition==='Pro'?'开':'关'),'1.2.3','Windows_NT 10.0.26100','用户注册表','系统注册表','~/AppData/Local/pnpm/codex.cmd','找到','不存在','不可执行','版本读不出','relay.example/[自定','/v1','HTTP 401','密钥不正确'])assert.ok(report.includes(expected),expected);
  assert.doesNotMatch(report,/fixture-|another-account|cookie|https:|[?#]/);
 }
});

test('单家诊断能区分文件不存在和没有执行权限',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'task57-stat-'));
 try{
  const file=path.join(root,process.platform==='win32'?'qwen.exe':'qwen');
  const inventory=()=>getAgentDiagnostics('qwen',{home:root,env:{PATH:root},configured:file}).candidates;
  assert.equal(inventory()[0].status,'missing');
  fs.mkdirSync(file);
  assert.equal(inventory()[0].status,'invalid');
 }finally{fs.rmSync(root,{force:true,recursive:true});}
});

test('Windows 安装把已确认的本家命令交给可见 PowerShell，拒绝过期及篡改命令',async()=>{
 const {ROSTER_AGENTS,rosterInstaller,rosterInstallCommand}=await import('./agent-roster.ts');
 const official={
  kimi:'irm https://code.kimi.com/kimi-code/install.ps1 | iex',
  minimax:'irm https://filecdn.minimax.chat/public/install.ps1 | iex',
  codebuddy:'irm https://www.codebuddy.cn/cli/install.ps1 | iex',
  cursor:"irm 'https://cursor.com/install?win32=true' | iex",
  opencode:'npm install -g opencode-ai',
  qwen:'irm https://qwen-code-assets.oss-cn-hangzhou.aliyuncs.com/installation/install-qwen-standalone.ps1 | iex',
  copilot:'winget install GitHub.Copilot',
 } as const;
 for(const [id,command] of Object.entries(official) as [keyof typeof official,string][]){
  const roster=ROSTER_AGENTS.find(row=>row.id===id)!;
  assert.equal(rosterInstaller(roster,'win32','x64'),command);
  assert.equal(rosterInstallCommand(id,command,'win32','x64'),command);
  assert.throws(()=>rosterInstallCommand(id,roster.installer,'win32','x64'),/未经确认/);
  let calls=0;
  const deps:AgentManagementDeps={platform:'win32',arch:'x64',assertAllowed:()=>{},detect:async()=>undefined,pollMs:60000,
   startWindowsTerminal:async(file,args)=>{
    calls++;
    if(command.startsWith('irm ')){
     assert.match(file,/WindowsPowerShell\\v1\.0\\powershell\.exe$/i);
     assert.deepEqual(args,['-NoLogo','-NoProfile','-Command',command]);
    }else if(id==='copilot'){assert.equal(file,'winget.exe');assert.deepEqual(args,['install','GitHub.Copilot']);}
    else{assert.equal(file,'npm.cmd');assert.deepEqual(args,['install','-g','opencode-ai']);}
    return 777;
   }};
  const manager=createAgentManagement();
  await assert.rejects(manager.start(id,'install',{command:command+' extra'},deps),/未经确认/);
  await assert.rejects(manager.start(id,'install',{command:roster.installer},deps),/未经确认/);
  assert.equal(calls,0);
  const session=await manager.start(id,'install',{command},deps);assert.equal(session.state,'waiting');assert.equal(calls,1);
  manager.cancel(id);
 }
 const codebuddy=ROSTER_AGENTS.find(agent=>agent.id==='codebuddy')!;
 assert.equal(rosterInstaller(codebuddy,'win32','arm64'),official.codebuddy);
 assert.equal(rosterInstaller(codebuddy,'win32','ia32'),'npm install -g @tencent-ai/codebuddy-code');
 assert.throws(()=>rosterInstallCommand('codebuddy',official.codebuddy,'win32','ia32'),/未经确认/);
 const deepseek=ROSTER_AGENTS.find(agent=>agent.id==='deepseek')!;
 assert.equal(rosterInstaller(deepseek,'win32'),undefined);assert.equal(deepseek.page,'https://www.deepseek.com/download/');
 assert.throws(()=>rosterInstallCommand('deepseek',deepseek.installer,'win32'),/安装页/);
 const pageOnly=ROSTER_AGENTS.find(row=>row.kind==='tool')!;
 assert.equal(rosterInstaller(pageOnly,'win32'),undefined);
 assert.throws(()=>rosterInstallCommand(pageOnly.id,undefined,'win32'),/下载页/);
});

test('统一表单先验证手动路径，验证失败保留原程序和密钥',async()=>{
 const {saveAgentConnection,getConnectionConfig}=await import('./agent-connections.ts');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'task57-pin-')),old=process.env.LINKREADER_CONNECTION_SETTINGS_FILE;
 process.env.LINKREADER_CONNECTION_SETTINGS_FILE=path.join(root,'connections.json');
 try{
  const good=fakeNodeCli(path.join(root,'qwen'),"console.error('qwen 1.2.3')");
  const bad=fakeNodeCli(path.join(root,'wrong'),"console.log('fixture private text')");
  const writes:string[]=[];
  const deps={detect:async()=>undefined,store:{write:async()=>{writes.push('write')},read:async()=>'',remove:async()=>{}}};
  await saveAgentConnection('qwen',{cliPath:good},deps);
  await assert.rejects(saveAgentConnection('qwen',{cliPath:bad,apiKey:'fixture-only'},deps),/未能回答 --version/);
  assert.equal(getConnectionConfig('qwen').cliPath,good);assert.deepEqual(writes,[]);
  fs.unlinkSync(good);
  const missing=await saveAgentConnection('qwen',{cliPath:good,model:'default'},deps);
  assert.equal(missing.cliInstalled,false);assert.equal(missing.cliPath,good);
  assert.equal((await saveAgentConnection('qwen',{cliPath:''},deps)).cliPath,'');
 }finally{if(old===undefined)delete process.env.LINKREADER_CONNECTION_SETTINGS_FILE;else process.env.LINKREADER_CONNECTION_SETTINGS_FILE=old;fs.rmSync(root,{recursive:true,force:true})}
});

test('系统代理只返回开关，读取失败和意外输出不当成关',async()=>{
 const {systemProxySwitch}=await import('./agent-diagnostic-report.ts');
 const fake=(stdout:string)=>async()=>({stdout,stderr:'private proxy endpoint'});
 for(const key of ['HTTP','HTTPS','SOCKS','ProxyAutoDiscovery','ProxyAutoConfig']){
  assert.equal(await systemProxySwitch('darwin',fake('<dictionary> {\n '+key+'Enable : 1\n HTTPProxy : proxy.fixture.test\n HTTPPort : 54321\n}')),'开');
 }
 for(const [data,expected] of [['<dictionary> {\n HTTPEnable : 0\n}','关'],['<dictionary> {\n ExceptionsList : <array> {\n }\n}','关'],['','未能读取'],['<dictionary> {\n HTTPEnable : malformed\n}','未能读取']])
  assert.equal(await systemProxySwitch('darwin',fake(data)),expected);
 for(const [data,expected] of [['1','开'],['0','关'],['-1','未能读取'],['https://proxy.fixture.test:54321','未能读取']]){
  assert.equal(await systemProxySwitch('win32',async(file,args)=>{
   assert.match(file,/powershell\.exe$/i);
   assert.ok(args!.includes('-EncodedCommand'));
   assert.match(Buffer.from(args!.at(-1)!,'base64').toString('utf16le'),/WinHttpGetIEProxyConfigForCurrentUser/);
   return fake(data)();
  }),expected);
 }
 assert.equal(await systemProxySwitch('win32',async()=>{throw Error('private proxy endpoint')}),'未能读取');
});

test('CodeBuddy 版本从完整输出提取，Git Bash 安装提示不能当作版本',async()=>{
 const {cliVersionNumber}=await import('../shared/agent-connections.ts');
 const advice='Note: Git Bash not detected. Install Git for Windows 2.52.0';
 assert.equal(cliVersionNumber('codebuddy',advice),undefined);
 assert.equal(cliVersionNumber('codebuddy',advice+'\n2.176.0 (CodeBuddy Code)'), '2.176.0');
 assert.equal(cliVersionNumber('codebuddy','CodeBuddy Code v2.176.0\r\n'+advice),'2.176.0');
});

test('Windows 登录终端只启动独立 CodeBuddy，脚本不序列化凭据',async()=>{
 const {windowsAgentScript}=await import('./windows-agent-terminal.ts');
 const root='C:\\测试程序',entry=root+'\\resources\\app.asar.unpacked\\cli\\dist\\codebuddy-lite-wb.mjs';
 const exe=root+'\\codebuddy\\bin\\codebuddy.exe';
 const env={CODEBUDDY_INTERNET_ENVIRONMENT:'ioa',CODEBUDDY_API_KEY:'fake-credential-should-not-be-in-script'};
 assert.throws(()=>windowsAgentScript(entry,[],root+'\\exit-code',env),/腾讯官方独立/);
 const script=windowsAgentScript(exe,[],root+'\\exit-code',env);
 assert.ok(script.includes("$start.FileName='"+exe+"'"));
 assert.doesNotMatch(script,/fake-credential|CODEBUDDY_API_KEY|ELECTRON_RUN_AS_NODE/);
 const codex=windowsAgentScript('C:\\tests\\codex.exe',['login'],root+'\\exit-code',env);
 for(const key of ['OT_UTF8_SCRIPT','OT_UTF8_NODE','OT_UTF8_ENTRY','OT_UTF8_REQUEST'])assert.ok(codex.includes("$start.EnvironmentVariables['"+key+"']"));
});

test('WorkBuddy 一键安装在可见终端运行官方命令，找到独立 CLI 后仅开启一次登录并等到接通',async()=>{
 for(const platform of ['win32','darwin'] as const){
  const manager=createAgentManagement(),command=platform==='win32'?'irm https://www.codebuddy.cn/cli/install.ps1 | iex':'curl -fsSL https://www.codebuddy.cn/cli/install.sh | bash';
  let found=false,connected=false,loginCount=0,checkCount=0,installCount=0;
  const connection=()=>view('codebuddy',{cliInstalled:found,connected,cliAuthState:connected?'connected':'needs-login'});
  const deps:AgentManagementDeps={platform,arch:'arm64',assertAllowed:()=>{},pollMs:60000,detect:async()=>undefined,
   startWindowsTerminal:async(exe,args,resultDir)=>{
    installCount++;assert.match(exe,/powershell\.exe$/i);assert.deepEqual(args,['-NoLogo','-NoProfile','-Command',command]);
    fs.writeFileSync(path.join(resultDir,'exit-code'),'0');return 12345;
   },
   terminal:async script=>{if(!script.includes('do script'))return 'finished';installCount++;assert.ok(script.includes(command));return '23:/dev/ttys023'},
   exitCode:()=>0,refresh:async()=>connection(),
   loginStart:async()=>{loginCount++;return {waiting:true,connection:connection()}},
   loginCheck:async()=>{checkCount++;return {waiting:!connected,connection:connection()}}};
  assert.equal(await manager.workBuddySetup(),null);
  await assert.rejects(manager.start('qwen','install-and-login',{command},deps),/仅适用于 CodeBuddy/);
  await assert.rejects(manager.start('codebuddy','install-and-login',{command:command+' extra'},deps),/未经确认/);
  assert.equal(installCount,0);
  assert.equal((await manager.start('codebuddy','install-and-login',{command},deps)).state,'waiting');
  assert.equal((await manager.workBuddySetup())?.state,'waiting');assert.equal(loginCount,0);
  found=true;
  const [a,b]=await Promise.all([manager.check('codebuddy'),manager.check('codebuddy')]);
  assert.equal(a.phase,'login');assert.equal(a.state,'waiting');assert.equal(a.message,'输入 /login 回车，在浏览器里确认');
  assert.deepEqual(a,b);assert.equal(loginCount,1);assert.equal(installCount,1);
  assert.equal((await manager.check('codebuddy')).state,'waiting');connected=true;
  const result=await manager.check('codebuddy');assert.equal(result.state,'complete');assert.equal(result.message,'已接通');assert.equal(checkCount,2);
 }
});

test('一键安装失败或取消时不打开登录终端，已有有效命令行登录时直接完成',async()=>{
 const manager=createAgentManagement(),command='curl -fsSL https://www.codebuddy.cn/cli/install.sh | bash';
 let exitCode=1,loginCount=0,refreshCount=0;
 const deps:AgentManagementDeps={platform:'darwin',assertAllowed:()=>{},pollMs:60000,detect:async()=>undefined,exitCode:()=>exitCode,
  terminal:async script=>script.includes('do script')?'23:/dev/ttys023':'finished',
  refresh:async id=>{refreshCount++;return view(id,{cliInstalled:true,connected:true})},loginStart:async()=>{loginCount++;throw Error('unexpected login')}};
 await manager.start('codebuddy','install-and-login',{command},deps);
 assert.equal((await manager.check('codebuddy')).state,'failed');assert.equal(refreshCount,0);
 exitCode=0;await manager.start('codebuddy','install-and-login',{command},deps);
 manager.cancel('codebuddy');assert.equal((await manager.check('codebuddy')).state,'cancelled');assert.equal(refreshCount,0);
 await manager.start('codebuddy','install-and-login',{command},deps);
 assert.equal((await manager.check('codebuddy')).message,'已接通');assert.equal(refreshCount,1);assert.equal(loginCount,0);
});

test('Windows 安装脚本的 exit 仅结束内层进程，可见父窗口记录退出码并返回自己的 PID',async()=>{
 const {systemPowerShell,startWindowsAgentTerminal}=await import('./windows-agent-terminal.ts');
 const exe=systemPowerShell(),command='irm https://www.codebuddy.cn/cli/install.ps1 | iex';
 const pid=await startWindowsAgentTerminal(exe,['-NoLogo','-NoProfile','-Command',command],'C:\\fixture',{},async(file,args,options)=>{
  assert.equal(file,exe);assert.equal(options.windowsHide,true);
  const opener=args.at(-1)!;assert.match(opener,/Start-Process .* -WindowStyle Normal -PassThru/);
  const wrapper=Buffer.from(opener.match(/-EncodedCommand ([A-Za-z0-9+/=]+)/)![1],'base64').toString('utf16le');
  assert.ok(wrapper.includes("$start.FileName='"+exe+"'"));assert.ok(wrapper.includes(command));
  assert.match(wrapper,/\$operation\.WaitForExit\(\)[\s\S]*\$operationCode=\$operation.ExitCode[\s\S]*Set-Content -LiteralPath[^\r\n]*exit-code\.tmp[\s\S]*Move-Item[^\r\n]*-Destination [^\r\n]*exit-code'/);
  return {stdout:'5678\r\n'};
 });
 assert.equal(pid,5678);
});

test('旧的内置路径恢复自动查找，桌面和 PATH 别名均不能触发登录或版本探测',{skip:process.platform!=='darwin'},async t=>{
 const {getConnectionConfig,getConnectionStatus}=await import('./agent-connections.ts');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'task57c-desktop-'));
 const previousHome=process.env.HOME,previousFile=process.env.LINKREADER_CONNECTION_SETTINGS_FILE;
 const settings=path.join(root,'connections.json');
 process.env.HOME=root;process.env.LINKREADER_CONNECTION_SETTINGS_FILE=settings;
 t.after(()=>{
  if(previousHome===undefined)delete process.env.HOME;else process.env.HOME=previousHome;
  if(previousFile===undefined)delete process.env.LINKREADER_CONNECTION_SETTINGS_FILE;else process.env.LINKREADER_CONNECTION_SETTINGS_FILE=previousFile;
  fs.rmSync(root,{recursive:true,force:true});
 });
 const app=path.join(root,'Applications','WorkBuddy.app'),bin=path.join(root,'bin');
 fs.mkdirSync(app,{recursive:true});fs.mkdirSync(bin);
 const bundled=path.join(app,'测试替身'),alias=path.join(bin,'codebuddy');
 fs.writeFileSync(bundled,'fixture',{mode:0o755});fs.symlinkSync(bundled,alias);
 fs.writeFileSync(settings,JSON.stringify({codebuddy:{...defaultConnection('codebuddy'),cliPath:'D:\\旧目录\\resources\\app.asar.unpacked\\cli\\dist\\codebuddy-lite-wb.mjs',connected:true}}));
 assert.equal(getConnectionConfig('codebuddy').cliPath,'');
 const probes:string[]=[];
 const deps={discoveryEnv:{HOME:root,PATH:bin},version:async(file:string)=>{probes.push(file);return '2.185.0'},cliTest:async(_id:ConnectionId,file:string)=>{probes.push(file);return {connected:true}}};
 const missing=await getConnectionStatus('codebuddy',deps);
 assert.equal(missing.workBuddyNeedsCli,true);assert.equal(missing.cliAuthMessage,'已装 WorkBuddy。出片还需要腾讯官方的 CodeBuddy 命令行（约 94 MB），装好后登录一次。');
 assert.equal(missing.cliLoginAvailable,false);assert.equal(missing.connected,false);assert.deepEqual(probes,[]);
 await assert.rejects(setAgentProgramPath('codebuddy',alias,{assertAllowed:()=>{},version:deps.version}),/腾讯官方独立/);
 fs.unlinkSync(alias);fs.writeFileSync(alias,'fixture',{mode:0o755});
 const ready=await getConnectionStatus('codebuddy',deps);
 assert.equal(ready.executable,alias);assert.equal(ready.workBuddyNeedsCli,undefined);assert.equal(ready.cliAuthState,'connected');
 assert(probes.length>0&&probes.every(file=>file===alias));
});
