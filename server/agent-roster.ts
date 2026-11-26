import {cliVersionNumber} from '../shared/agent-connections.ts';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileAsync} from './proc.ts';
import tools from './agent-installation.ts';
import {appBundleForExecutable,findOpenScreenExecutable} from './editor/openscreen.ts';

/** Shared native-agent discovery. Command contracts come from each provider's official docs; no third-party implementation is read. */
export type RosterAgentId='kimi'|'deepseek'|'minimax'|'codebuddy'|'copilot'|'cursor'|'opencode'|'qwen'|'openscreen';
type RosterAgent={id:RosterAgentId;name:string;kind?:'tool';names:string[];dirs?:(home:string,apps:string[])=>string[];app?:{name:string;match:RegExp};installer?:string;windowsInstaller?:string;page:string};
export const ROSTER_AGENTS:readonly RosterAgent[]=[
 // Windows 官方安装说明（2026-11-20）https://www.kimi.com/code/docs/en/kimi-code-cli/guides/getting-started
 {id:'kimi',name:'Kimi',names:['kimi'],dirs:home=>[path.join(home,'.kimi-code','bin')],app:{name:'Kimi',match:/^Kimi.*\.app$/i},
  windowsInstaller:'irm https://code.kimi.com/kimi-code/install.ps1 | iex',installer:'curl -fsSL https://code.kimi.com/kimi-code/install.sh | bash',page:'https://www.kimi.com/code/docs/en/kimi-code-cli/guides/getting-started.html'},
 // DeepSeek Harness's desktop app carries the command; its own setting only links it into the PATH
 // 2026-11-20，https://github.com/deepseek-ai/deepseek-harness 仅给出临时启动命令；Windows 使用厂商下载页。
 {id:'deepseek',name:'DeepSeek',names:['dsh'],dirs:(_home,apps)=>apps.map(dir=>path.join(dir,'DeepSeek Harness.app','Contents','Resources','runtime','cli','bin')),
  installer:'npm install -g @deepseek-ai/dsh',page:'https://www.deepseek.com/download/'},
 // Windows 官方安装说明（2026-11-20）https://github.com/MiniMax-AI/minimax-code
 {id:'minimax',name:'MiniMax Code',names:['mcode','mmx-code'],dirs:home=>[path.join(home,'.minimax-code','bin')],app:{name:'MiniMax',match:/^MiniMax.*\.app$/i},
  windowsInstaller:'irm https://filecdn.minimax.chat/public/install.ps1 | iex',installer:'curl -fsSL https://filecdn.minimax.chat/public/install.sh | bash',page:'https://github.com/MiniMax-AI/minimax-code'},
 // Windows 官方安装说明（2026-11-20）https://www.codebuddy.cn/docs/cli/installation
 {id:'codebuddy',name:'CodeBuddy / WorkBuddy',names:['codebuddy','cbc'],app:{name:'CodeBuddy',match:/^(?:CodeBuddy|WorkBuddy).*\.app$/i},
  windowsInstaller:'irm https://www.codebuddy.cn/cli/install.ps1 | iex',installer:'curl -fsSL https://www.codebuddy.cn/cli/install.sh | bash',page:'https://www.codebuddy.cn/docs/cli/installation'},
 // Windows 官方安装说明（2026-11-20）https://docs.github.com/en/copilot/how-tos/copilot-cli/set-up-copilot-cli/install-copilot-cli
 {id:'copilot',name:'GitHub Copilot',names:['copilot'],windowsInstaller:'winget install GitHub.Copilot',installer:'npm install -g @github/copilot',page:'https://docs.github.com/en/copilot/get-started/cli-quickstart'},
 // Windows 官方安装说明（2026-11-20）https://cursor.com/docs/cli/installation
 {id:'cursor',name:'Cursor',names:['agent','cursor-agent'],app:{name:'Cursor',match:/^Cursor\.app$/i},windowsInstaller:"irm 'https://cursor.com/install?win32=true' | iex",installer:'curl https://cursor.com/install -fsS | bash',page:'https://cursor.com/docs/cli/overview'},
 // Windows 官方安装说明（2026-11-20）https://github.com/anomalyco/opencode/blob/v1.2.27/packages/web/src/content/docs/index.mdx
 {id:'opencode',name:'OpenCode',names:['opencode'],dirs:home=>[path.join(home,'.opencode','bin')],windowsInstaller:'npm install -g opencode-ai',installer:'curl -fsSL https://opencode.ai/install | bash',page:'https://opencode.ai/docs/'},
 // Windows 官方安装说明（2026-11-20）https://qwenlm.github.io/qwen-code-docs/en/users/quickstart/
 {id:'qwen',name:'Qwen Code',names:['qwen'],windowsInstaller:'irm https://qwen-code-assets.oss-cn-hangzhou.aliyuncs.com/installation/install-qwen-standalone.ps1 | iex',installer:'npm install -g @qwen-code/qwen-code@latest',page:'https://qwenlm.github.io/qwen-code-docs/en/users/quickstart/'},
 // Its README installs the signed .dmg from the GitHub releases, so the latest stable release is its download page.
 {id:'openscreen',name:'OpenScreen',kind:'tool',names:[],page:'https://github.com/getopenscreen/openscreen/releases/latest'},
];
export function rosterInstaller(agent:RosterAgent,platform:NodeJS.Platform=process.platform,arch:NodeJS.Architecture=process.arch){
 // 2026-11-20，https://www.codebuddy.cn/docs/cli/installation 原生安装器提供 x86_64，Windows 11 ARM64 可运行此版本。
 if(agent.id==='codebuddy'&&platform==='win32'&&arch!=='x64'&&arch!=='arm64')return 'npm install -g @tencent-ai/codebuddy-code';
 if(platform==='win32')return agent.windowsInstaller;
 return agent.installer;
}
export type RosterStatus={id:RosterAgentId;name:string;kind:'agent'|'tool';state:'found'|'missing';executable?:string;version?:string;app?:{name:string;path:string};installCommand?:string;page:string};
type RosterOptions={platform?:NodeJS.Platform;installedRoots?:string[];installedApps?:{name:string;path:string}[];home?:string;env?:NodeJS.ProcessEnv;applicationDirs?:string[];binDirs?:string[];version?:(file:string,env:NodeJS.ProcessEnv)=>Promise<string|undefined>;bundleVersion?:(app:string)=>Promise<string|undefined>;readVersion?:boolean};

/** Prevent another agent's alias/path from starting Claude Code; inspect paths and file identity only. */
export function isClaudeExecutable(file:string,env:NodeJS.ProcessEnv=process.env,configured?:string){
 const real=(value:string)=>{try{return fs.realpathSync(value)}catch{return path.resolve(value)}};
 const target=real(file);
 const named=(value:string)=>/(?:^|[\\/])claude(?:-code)?(?:\.(?:exe|cmd|bat|ps1))?$/i.test(value)||/[\\/]@anthropic-ai[\\/]claude-code[\\/]|[\\/]claude[\\/]versions[\\/]|[\\/]Claude[\\/]claude-code[\\/]/i.test(value);
 if(named(file)||named(target))return true;
 if(process.platform==='win32'&&/\.cmd$/i.test(file)){
  const shim=tools.windowsShim(file,env);
  if([shim?.file,...(shim?.args??[])].some(arg=>arg&&(named(arg)||named(real(arg)))))return true;
 }
 const known=[configured,env.LINKREADER_CLAUDE_EXECUTABLE,...String(env.PATH||'').split(path.delimiter).filter(dir=>path.isAbsolute(dir)).map(dir=>path.join(dir,'claude')),path.join(os.homedir(),'.local','bin','claude'),path.join(os.homedir(),'.claude','local','claude')].filter((value):value is string=>!!value);
 for(const candidate of known){
  if(real(candidate)===target)return true;
  // A hard link has a different realpath but still names the same executable.
  try{const a=fs.statSync(candidate),b=fs.statSync(file);if(a.dev===b.dev&&a.ino===b.ino)return true}catch{/* not installed */}
 }
 return false;
}

const askVersion=async(file:string,env:NodeJS.ProcessEnv,id:RosterAgentId)=>{
 try{const {stdout,stderr}=await execFileAsync(file,['--version'],{env,timeout:5000,maxBuffer:65536});return id==='codebuddy'?cliVersionNumber(id,stdout+'\n'+stderr):(stdout||stderr).trim().split('\n')[0]?.slice(0,80)||undefined}
 catch{return undefined}
};
const plistString=(xml:string,key:string)=>xml.match(new RegExp(`<key>${key}</key>\\s*<string>\\s*([^<\\s]{1,40})\\s*</string>`))?.[1];
/** An app's version from its Info.plist, only read (a binary plist is turned into text by plutil): the app is never run. */
export async function bundleVersion(app:string){
 if(process.platform!=='darwin')return undefined;
 const file=path.join(app,'Contents','Info.plist');
 try{
  const bytes=fs.readFileSync(file);
  const xml=bytes.subarray(0,8).toString('latin1')==='bplist00'
   ?(await execFileAsync('/usr/bin/plutil',['-convert','xml1','-o','-',file],{timeout:3000,maxBuffer:1<<20})).stdout:bytes.toString('utf8');
  return plistString(xml,'CFBundleShortVersionString')??plistString(xml,'CFBundleVersion');
 }catch{return undefined}
}
const appsMatching=(match:RegExp,apps:string[])=>apps.flatMap(dir=>{try{return fs.readdirSync(dir).filter(name=>match.test(name)).map(name=>path.join(dir,name)).filter(file=>{try{return fs.statSync(file).isDirectory()}catch{return false}})}catch{return []}});
const windowsDisplayNames:Partial<Record<RosterAgentId,RegExp>>={
 codebuddy:/^(?:CodeBuddy|WorkBuddy)(?:\b|$)/i,kimi:/^Kimi(?:\b|$)/i,minimax:/^MiniMax(?:\b|$)/i,
 deepseek:/^DeepSeek Harness(?:\b|$)/i,opencode:/^OpenCode(?:\b|$)/i,cursor:/^Cursor(?:\b|$)/i,qwen:/^Qwen(?:\b|$)/i,
};
function registeredApps(agent:RosterAgent,options:RosterOptions){
 const match=windowsDisplayNames[agent.id];
 if(!match)return [];
 return (options.installedApps??(options.installedRoots?[]:tools.windowsInstalledApps(options.env??process.env))).filter(app=>match.test(app.name));
}
export function rosterDesktopApp(agent:RosterAgent,options:RosterOptions={}):{name:string;path:string}|undefined{
 const osName=options.platform??process.platform;
 if(osName==='win32'){
  const registered=registeredApps(agent,options);
  if(agent.id==='codebuddy'){
   const desktop=registered.find(app=>/^WorkBuddy/i.test(app.name));
   if(desktop)return desktop;
   const local=(options.env??process.env).LOCALAPPDATA;
   if(local){
    const root=path.win32.join(local,'Programs','WorkBuddy');
    const markers=['WorkBuddy.exe','resources\\app.asar.unpacked\\cli\\dist\\codebuddy-lite-wb.mjs'];
    if(markers.some(file=>{try{return fs.statSync(path.win32.join(root,file)).isFile()}catch{return false}}))return {name:'WorkBuddy',path:root};
   }
  }
  return registered[0];
 }
 if(osName!=='darwin'||!agent.app)return undefined;
 const apps=options.applicationDirs??['/Applications',path.join(options.home??os.homedir(),'Applications')];
 const matches=appsMatching(agent.app.match,apps);
 const folder=(agent.id==='codebuddy'?matches.find(file=>/^WorkBuddy/i.test(path.basename(file))):undefined)??matches[0];
 return folder?{name:path.basename(folder,'.app'),path:folder}:undefined;
}
/** Shared with the diagnostic API; listing candidates never runs a command. */
export function rosterExecutableCandidates(agent:RosterAgent,options:RosterOptions={}):string[]{
 const home=options.home??os.homedir(),apps=options.applicationDirs??(process.platform==='darwin'?['/Applications',path.join(home,'Applications')]:[]);
 const env=options.env??tools.loginEnvironment();
 const osName=options.platform??process.platform;
 if(osName!=='win32')return tools.agentPathCandidates(agent.names,env,home,osName,agent.dirs?.(home,apps));
 const join=path.win32.join;
 // 厂商目录只列已公开的启动文件，避免把同名桌面编辑器误认作智能体。
 const desktopApps=registeredApps(agent,options),roots=desktopApps.map(app=>app.path);
 const local=env.LOCALAPPDATA||join(home,'AppData','Local');
 let extra:string[]=[];
 switch(agent.id){
  // https://code.kimi.com/kimi-code/install.ps1
  case 'kimi':extra=[env.KIMI_INSTALL_DIR||join(home,'.kimi-code'),...roots].map(root=>join(root,'bin','kimi.exe'));break;
  // https://github.com/MiniMax-AI/minimax-code#quick-start
  case 'minimax':extra=[env.MCODE_INSTALL_DIR||join(home,'.minimax-code'),...roots].flatMap(root=>['mcode.cmd','mcode.ps1'].map(name=>join(root,name)));break;
  // https://www.codebuddy.cn/docs/cli/installation ; https://www.codebuddy.cn/cli/install.ps1
  case 'codebuddy':{
   const independent=[join(local,'codebuddy'),...desktopApps.filter(app=>/^CodeBuddy(?:\b|$)/i.test(app.name)).map(app=>app.path)];
   extra=independent.map(root=>join(root,'bin','codebuddy.exe'));
   break;
  }
  // https://qwen-code-assets.oss-cn-hangzhou.aliyuncs.com/installation/install-qwen-standalone.ps1
  case 'qwen':extra=[...(env.QWEN_INSTALL_BIN_DIR?[env.QWEN_INSTALL_BIN_DIR]:[]),...[env.QWEN_INSTALL_ROOT||join(local,'qwen-code'),...roots].map(root=>join(root,'bin'))].map(dir=>join(dir,'qwen.cmd'));break;
  // https://cursor.com/docs/cli/installation ; https://cursor.com/install?win32=true
  case 'cursor':extra=env.LOCALAPPDATA?['agent.cmd','cursor-agent.cmd','agent.ps1','cursor-agent.ps1'].map(name=>join(env.LOCALAPPDATA!,'cursor-agent',name)):[];break;
  // https://github.com/deepseek-ai/deepseek-harness/blob/master/apps/desktop/README.md#bundled-command-runtime
  // Default current-user root: https://github.com/electron-userland/electron-builder/blob/master/packages/app-builder-lib/templates/nsis/multiUser.nsh
  case 'deepseek':extra=tools.deepseekWindowsBins(env,[...(options.installedRoots??roots),join(local,'Programs','DeepSeek Harness')]).map(dir=>join(dir,'dsh.cmd'));break;
 }
 return [...new Set([...tools.agentPathCandidates(agent.names,env,home,osName),...extra.filter(file=>path.win32.isAbsolute(file))])];
}
/** One agent: its program on the login shell's PATH, in the folders installers use, or inside its maker's app. */
export async function rosterAgentStatus(agent:RosterAgent,options:RosterOptions={}):Promise<RosterStatus>{
 const home=options.home??os.homedir(),apps=options.applicationDirs??(process.platform==='darwin'?['/Applications',path.join(home,'Applications')]:[]);
 const base={id:agent.id,name:agent.name,kind:agent.kind??'agent' as const,page:agent.page};
 if(agent.kind==='tool'){
  // the recording module's lookup, in this server's own environment as the module sees it
  const executable=findOpenScreenExecutable({env:options.env??process.env,home,applicationDirs:apps,...(options.binDirs?{binDirs:options.binDirs}:{})});
  if(!executable)return {...base,state:'missing'};
  let app:string|undefined;try{app=appBundleForExecutable(executable)}catch{}
  return {...base,state:'found',executable,...(app?{app:{name:agent.name,path:app},version:await (options.bundleVersion??bundleVersion)(app)}:{})};
 }
 const env=options.env??tools.loginEnvironment();
 const executable=rosterExecutableCandidates(agent,{...options,home,env,applicationDirs:apps}).find(file=>tools.agentFileStatus(file,options.platform)==='executable'&&!isClaudeExecutable(file,env));
 if(executable)return {...base,state:'found',executable,version:options.readVersion===false?undefined:await (options.version??askVersion)(executable,env,agent.id)};
 const app=rosterDesktopApp(agent,{...options,applicationDirs:apps});
 return {...base,state:'missing',...(app?{app}:{}),installCommand:rosterInstaller(agent,options.platform)};
}
export const agentRosterStatus=(options:RosterOptions={})=>Promise.all(ROSTER_AGENTS.map(agent=>rosterAgentStatus(agent,options)));
/** The official installer of a roster agent the person confirmed, exactly as listed: nothing else is run. */
export function rosterInstallCommand(id:string,command:unknown,platform:NodeJS.Platform=process.platform,arch:NodeJS.Architecture=process.arch){
 const agent=ROSTER_AGENTS.find(item=>item.id===id);
 const installer=agent&&rosterInstaller(agent,platform,arch);
 if(!installer)throw Error(`${agent?.name??'这个 Agent'} 没有可在这里运行的官方安装命令，请从它的${agent?.kind==='tool'?'下载页':'安装页'}安装`);
 if(command!==installer)throw Error('安装命令未经确认或已变化，请重新确认后再运行');
 return installer;
}
