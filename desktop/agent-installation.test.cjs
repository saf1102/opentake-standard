const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');const tools=require('./agent-installation.cjs');
test('discovers app-only installs, selects newest, pins manual paths and rejects impostors',()=>{
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'cw-agents-'));const applicationDirs=[path.join(home,'Applications')];
 const make=(p,text)=>{fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,`#!/bin/sh\nprintf '%s\\n' '${text}'\n`,{mode:0o755});return p};
 const env={HOME:home,PATH:path.join(home,'bin')};
 try{
 const app=make(path.join(applicationDirs[0],'Codex.app/Contents/Resources/codex'),'codex-cli 1.2.0');
 assert.equal(tools.detectAgent('codex',{home,env,applicationDirs}).executable,app);
 const old=make(path.join(home,'bin/codex'),'codex-cli 1.1.0');
 assert.equal(tools.detectAgent('codex',{home,env,applicationDirs}).executable,app);
 assert.equal(tools.detectAgent('codex',{home,env,applicationDirs,configured:old}).executable,old);
 assert.equal(tools.detectAgent('codex',{home,env,applicationDirs,configured:path.join(home,'missing')}).state,'invalid');
 const fake=make(path.join(home,'fake'),'Text Editor 9.9.9');
 assert.equal(tools.detectAgent('codex',{home,env,applicationDirs,configured:fake}).state,'invalid');
 assert.deepEqual(tools.sanitizeAgentEnv({PATH:'/bin',CLAUDECODE:'1',CLAUDE_CODE_SESSION_ID:'x',ANTHROPIC_BASE_URL:'x'}),{PATH:'/bin'});
 }finally{fs.rmSync(home,{recursive:true,force:true})}
});
test('reads login shell environment after marker, limits inherited values and refreshes PATH',()=>{
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'cw-shell-'));const shell=path.join(home,'shell');
 try{
 fs.writeFileSync(shell,"#!/bin/sh\nprintf 'startup noise\\n__CW_LOGIN_ENV_7B31__\\0PATH=/test/bin:/bin\\0CLAUDECODE=bad\\0CODEBUDDY_INTERNET_ENVIRONMENT=ioa\\0CODEBUDDY_CONFIG_DIR=/fixture/settings\\0LANG=en_US.UTF-8\\0'\n",{mode:0o755});
 const result=tools.loginEnvironment({HOME:home,SHELL:shell,PATH:'/bin'},true);
 assert.deepEqual(result.PATH.split(':').slice(0,2),['/test/bin','/bin']);assert.equal(result.CLAUDECODE,undefined);assert.equal(result.CODEBUDDY_INTERNET_ENVIRONMENT,'ioa');assert.equal(result.CODEBUDDY_CONFIG_DIR,'/fixture/settings');
 }finally{fs.rmSync(home,{recursive:true,force:true})}
});

test('compares numeric prerelease identifiers and stable versions',()=>{assert(tools.compareVersions('1.2.0-alpha.11','1.2.0-alpha.9')>0);assert(tools.compareVersions('1.2.0','1.2.0-alpha.11')>0)});
test('finds Claude Code from its files alone, reads its version from its install folder and never runs it',()=>{
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'cw-claude-'));const applicationDirs=[path.join(home,'Applications')];const ran=path.join(home,'ran');
 // Every fixture records any start; Claude Code detection must start none of them.
 const make=p=>{fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,`#!/bin/sh\necho "$0 $@" >> '${ran}'\necho '9.9.9 (Claude Code)'\n`,{mode:0o755});return p};
 const env={HOME:home,PATH:path.join(home,'bin')};const apps=path.join(home,'Library/Application Support/Claude/claude-code');
 try{
  const old=make(path.join(apps,'2.1.284/claude.app/Contents/MacOS/claude'));
  let found=tools.detectAgent('claude',{home,env,applicationDirs});
  assert.equal(found.executable,old);assert.equal(found.version,'2.1.284');assert.equal(found.state,'installed');
  make(path.join(apps,'2.1.99/claude'));
  assert.equal(tools.detectAgent('claude',{home,env,applicationDirs}).executable,old,'newest version by folder name');
  // Newer Claude apps: claude-code/<version>/<build>/claude.app, version also in its Info.plist.
  const bundle=path.join(apps,'2.1.308/a93ded4b1b47/claude.app');const current=make(path.join(bundle,'Contents/MacOS/claude'));
  fs.writeFileSync(path.join(bundle,'Contents/Info.plist'),'<?xml version="1.0"?><plist><dict><key>CFBundleShortVersionString</key><string>2.1.308</string></dict></plist>');
  found=tools.detectAgent('claude',{home,env,applicationDirs});assert.equal(found.executable,current);assert.equal(found.version,'2.1.308');
  // npm install: the version is in the package beside the linked program.
  const pkg=path.join(home,'lib/node_modules/@anthropic-ai/claude-code');make(path.join(pkg,'cli.js'));
  fs.writeFileSync(path.join(pkg,'package.json'),JSON.stringify({name:'@anthropic-ai/claude-code',version:'2.2.0'}));
  fs.mkdirSync(path.join(home,'bin'));fs.symlinkSync(path.join(pkg,'cli.js'),path.join(home,'bin/claude'));
  found=tools.detectAgent('claude',{home,env,applicationDirs});assert.equal(found.executable,path.join(home,'bin/claude'));assert.equal(found.version,'2.2.0');
  // Native installer: ~/.local/bin/claude links to ~/.local/share/claude/versions/<version>.
  const native=make(path.join(home,'.local/share/claude/versions/2.3.1'));fs.mkdirSync(path.join(home,'.local/bin'),{recursive:true});fs.symlinkSync(native,path.join(home,'.local/bin/claude'));
  found=tools.detectAgent('claude',{home,env,applicationDirs});assert.equal(found.executable,path.join(home,'.local/bin/claude'));assert.equal(found.version,'2.3.1');
  // A manual path only counts when the file is there and executable; nothing about it is run.
  assert.equal(tools.detectAgent('claude',{home,env,applicationDirs,configured:path.join(home,'missing')}).state,'invalid');
  assert.equal(tools.detectAgent('claude',{home,env,applicationDirs,configured:old}).executable,old);
  assert.equal(fs.existsSync(ran),false,'Claude Code was started during detection');
  // Claude Code is never resolved as a program to run.
  assert.throws(()=>tools.resolveAgent('claude',old,{home,env,applicationDirs}),/不调用 Claude Code/);
  assert.throws(()=>tools.resolveAgent('claude','',{home,env,applicationDirs}),/不调用 Claude Code/);
 }finally{fs.rmSync(home,{recursive:true,force:true})}
});
test('Windows: finds the command inside the Store Codex app, which puts nothing on PATH',()=>{
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'cw-store-'));
 const make=(p,text)=>{fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,`#!/bin/sh\nprintf '%s\\n' '${text}'\n`,{mode:0o755});return p};
 try{
  const root=path.join(home,'WindowsApps','OpenAI.Codex_26.1111.9664.0_x64__2p2nqsd0c76g0');
  const asked=[];const packageRoots=prefixes=>{asked.push(...prefixes);return [root]};
  const env={HOME:home,PATH:path.join(home,'bin')};
  assert.equal(tools.detectAgent('codex',{home,env,applicationDirs:[],packageRoots}).state,'missing');
  const store=make(path.join(root,'app','resources','codex.exe'),'codex-cli 0.169.1');
  const found=tools.detectAgent('codex',{home,env,applicationDirs:[],packageRoots});
  assert.equal(found.executable,store);assert.match(found.version,/0\.169\.1/);
  assert.equal(found.candidates.find(c=>c.path===store).source,'app');
  assert(asked.includes('OpenAI.Codex_'));
  // 别的平台不去读注册表；不注入时 Mac 上一个都不列
  assert.deepEqual(tools.windowsCodexCandidates({platform:'darwin',env}),[]);
  assert.deepEqual(tools.windowsCodexCandidates({env,packageRoots}),[path.join(root,'app','resources','codex.exe')]);
 }finally{fs.rmSync(home,{recursive:true,force:true})}
});

test('Windows 每轮重读注册表，展开新变量，忽略未展开和相对地址，启动与查找共用这些目录',()=>{
 const env={Path:'C:\\old;C:\\Common',USERPROFILE:'C:\\Users\\tester',LOCALAPPDATA:'C:\\local',APPDATA:'C:\\roam',NVM_SYMLINK:'C:\\nvm-link',FNM_MULTISHELL_PATH:'C:\\fnm-active'};
 let value='C:\\one',reads=0;
 const options={platform:'win32',registryEnvironment(){reads++;return {user:'"%Fresh%\\bin";c:\\common\\;%Missing%\\x;.\\no',system:'C:\\sys;%Path%',
  variables:{Fresh:'%NewRoot%\\node',NewRoot:value}}}};
 const first=tools.agentEnvironmentSnapshot(env,false,options);
 value='C:\\two';
 const second=tools.agentEnvironmentSnapshot(env,false,options);
 assert.equal(reads,2);assert.deepEqual(first.pathSources,['process','registry-user','registry-system']);
 assert.equal(first.env.Path,undefined);assert.equal(first.loginShellTimedOut,false);
 assert(!second.env.PATH.includes('one'));assert(!second.env.PATH.includes('%'));
 const dirs=second.env.PATH.split(';');
 assert.equal(dirs.filter(dir=>dir.toLowerCase().startsWith('c:\\common')).length,1);
 const files=tools.agentPathCandidates(['agent'],second.env,env.USERPROFILE,'win32');
 for(const dir of ['C:\\two\\node\\bin','C:\\sys','C:\\local\\pnpm','C:\\Users\\tester\\scoop\\shims','C:\\local\\Microsoft\\WinGet\\Links',
  'C:\\local\\Volta\\bin','C:\\nvm-link','C:\\fnm-active','C:\\roam\\fnm\\aliases\\default','C:\\Users\\tester\\.bun\\bin','C:\\Users\\tester\\.local\\bin','C:\\Program Files\\nodejs']){
  assert(dirs.includes(dir),dir);assert(files.includes(dir+'\\agent.cmd'));assert(files.includes(dir+'\\agent.ps1'));
 }
 const file='C:\\test folder\\agent.ps1',args=['--name','a&b'];
 const launch=require('./agent-launch.cjs').agentLaunch(file,args,{env:second.env},'win32');
 assert.equal(launch.options.env.PATH,second.env.PATH);assert.equal(launch.options.shell,false);assert.match(launch.file,/\\powershell\.exe$/i);
 assert.deepEqual(launch.args,['-NoLogo','-NoProfile','-File',file,...args]);
});
test('Mac 登录环境超时后可从最新版 nvm 找到并启动命令；缓存与强制重读真实分开',()=>{
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'task57-shell-'));
 try{
  const env={HOME:home,SHELL:path.join(home,'fixture-shell'),PATH:'/bin',http_proxy:'http://127.0.0.1:1'};
  const called=[];let timeout=true;
  const options={platform:'darwin',home,spawnSync(_shell,_args,opts){called.push(opts.timeout);return timeout?
   {status:null,error:{code:'ETIMEDOUT'}}:{status:0,stdout:'__CW_LOGIN_ENV_7B31__\0PATH=/fresh:/bin\0'};}};
  const dirs=['v20.2.19','v20.12.0','v9.0.0'].map(v=>path.join(home,'.nvm/versions/node',v,'bin'));
  dirs.forEach(d=>fs.mkdirSync(d,{recursive:true}));
  const fake=path.join(dirs[1],'codex');
  fs.writeFileSync(fake,'#!/bin/sh\nfixture-version\n',{mode:0o755});
  fs.writeFileSync(path.join(dirs[1],'fixture-version'),'#!/bin/sh\necho codex-cli 1.2.3\n',{mode:0o755});
  const failed=tools.agentEnvironmentSnapshot(env,true,options),parts=failed.env.PATH.split(':');
  assert.equal(failed.loginShellTimedOut,true);assert.deepEqual(failed.pathSources,['process','fallback']);
  assert(parts.includes(dirs[1]));assert(!parts.includes(dirs[0]));assert(!parts.includes(dirs[2]));
  for(const dir of ['.volta/bin','.bun/bin','.asdf/shims','.local/share/mise/shims','Library/pnpm','.npm-global/bin','Library/Application Support/fnm/aliases/default/bin'])
   assert(parts.includes(path.join(home,dir)),dir);
  assert.equal(tools.detectAgent('codex',{home,env:failed.env,configured:fake}).executable,fake);
  timeout=false;assert.equal(tools.agentEnvironmentSnapshot(env,false,options).loginShellTimedOut,true);
  const refreshed=tools.agentEnvironmentSnapshot(env,true,options);assert.deepEqual(called,[8000,8000]);assert(refreshed.env.PATH.startsWith('/fresh:/bin'));
  assert.deepEqual(refreshed.pathSources,['process','login-shell','fallback']);assert.equal(refreshed.loginShellTimedOut,false);
  fs.writeFileSync(fake,'#!/bin/sh\nexit 1\n',{mode:0o755});
  assert.equal(tools.detectAgent('codex',{home,env:failed.env,configured:fake}).state,'invalid');
  assert.equal(tools.codexVersionUnreadable(fake),true);
  fs.writeFileSync(fake,'#!/bin/sh\necho codex-cli 1.3.0\n',{mode:0o755});
  assert.equal(tools.codexVersionUnreadable(fake),false);
 }finally{fs.rmSync(home,{recursive:true,force:true})}
});
