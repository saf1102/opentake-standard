import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileAsync} from './proc.ts';
import tools from './agent-installation.ts';
import {appBundleForExecutable,findOpenScreenExecutable} from './editor/openscreen.ts';

/** Shared native-agent discovery. Command contracts come from each provider's official docs; no third-party implementation is read. */
export type RosterAgentId='kimi'|'deepseek'|'minimax'|'codebuddy'|'copilot'|'cursor'|'opencode'|'qwen'|'openscreen';
type RosterAgent={id:RosterAgentId;name:string;kind?:'tool';names:string[];dirs?:(home:string,apps:string[])=>string[];app?:{name:string;match:RegExp};installer?:string;page:string};
export const ROSTER_AGENTS:readonly RosterAgent[]=[
 {id:'kimi',name:'Kimi',names:['kimi'],dirs:home=>[path.join(home,'.kimi-code','bin')],app:{name:'Kimi',match:/^Kimi.*\.app$/i},
  installer:'curl -fsSL https://code.kimi.com/kimi-code/install.sh | bash',page:'https://www.kimi.com/code/docs/en/kimi-code-cli/guides/getting-started.html'},
 // DeepSeek Harness's desktop app carries the command; its own setting only links it into the PATH
 {id:'deepseek',name:'DeepSeek',names:['dsh'],dirs:(_home,apps)=>apps.map(dir=>path.join(dir,'DeepSeek Harness.app','Contents','Resources','runtime','cli','bin')),
  installer:'npm install -g @deepseek-ai/dsh',page:'https://github.com/deepseek-ai/deepseek-harness'},
 {id:'minimax',name:'MiniMax Code',names:['mcode','mmx-code'],dirs:home=>[path.join(home,'.minimax-code','bin')],app:{name:'MiniMax',match:/^MiniMax.*\.app$/i},
  installer:'curl -fsSL https://filecdn.minimax.chat/public/install.sh | bash',page:'https://www.npmjs.com/package/@minimax-ai/code'},
 {id:'codebuddy',name:'CodeBuddy',names:['codebuddy','cbc'],app:{name:'CodeBuddy',match:/^CodeBuddy.*\.app$/i},
  installer:'curl -fsSL https://www.codebuddy.cn/cli/install.sh | bash',page:'https://www.codebuddy.cn/docs/cli/installation'},
 {id:'copilot',name:'GitHub Copilot',names:['copilot'],installer:'npm install -g @github/copilot',page:'https://docs.github.com/en/copilot/get-started/cli-quickstart'},
 {id:'cursor',name:'Cursor',names:['agent','cursor-agent'],app:{name:'Cursor',match:/^Cursor\.app$/i},installer:'curl https://cursor.com/install -fsS | bash',page:'https://cursor.com/docs/cli/overview'},
 {id:'opencode',name:'OpenCode',names:['opencode'],dirs:home=>[path.join(home,'.opencode','bin')],installer:'curl -fsSL https://opencode.ai/install | bash',page:'https://opencode.ai/docs/'},
 {id:'qwen',name:'Qwen Code',names:['qwen'],installer:'npm install -g @qwen-code/qwen-code@latest',page:'https://qwenlm.github.io/qwen-code-docs/en/users/quickstart/'},
 // Its README installs the signed .dmg from the GitHub releases, so the latest stable release is its download page.
 {id:'openscreen',name:'OpenScreen',kind:'tool',names:[],page:'https://github.com/getopenscreen/openscreen/releases/latest'},
];
export type RosterStatus={id:RosterAgentId;name:string;kind:'agent'|'tool';state:'found'|'missing';executable?:string;version?:string;app?:{name:string;path:string};installCommand?:string;page:string};
type RosterOptions={home?:string;env?:NodeJS.ProcessEnv;applicationDirs?:string[];binDirs?:string[];version?:(file:string,env:NodeJS.ProcessEnv)=>Promise<string|undefined>;bundleVersion?:(app:string)=>Promise<string|undefined>;readVersion?:boolean};

/** Prevent another agent's alias/path from starting Claude Code; inspect paths and file identity only. */
export function isClaudeExecutable(file:string,env:NodeJS.ProcessEnv=process.env,configured?:string){
 const real=(value:string)=>{try{return fs.realpathSync(value)}catch{return path.resolve(value)}};
 const target=real(file);
 const named=(value:string)=>/(?:^|[\\/])claude(?:-code)?(?:\.(?:exe|cmd|bat))?$/i.test(value)||/[\\/]@anthropic-ai[\\/]claude-code[\\/]|[\\/]claude[\\/]versions[\\/]|[\\/]Claude[\\/]claude-code[\\/]/i.test(value);
 if(named(file)||named(target))return true;
 const known=[configured,env.LINKREADER_CLAUDE_EXECUTABLE,...String(env.PATH||'').split(path.delimiter).filter(dir=>path.isAbsolute(dir)).map(dir=>path.join(dir,'claude')),path.join(os.homedir(),'.local','bin','claude'),path.join(os.homedir(),'.claude','local','claude')].filter((value):value is string=>!!value);
 for(const candidate of known){
  if(real(candidate)===target)return true;
  // A hard link has a different realpath but still names the same executable.
  try{const a=fs.statSync(candidate),b=fs.statSync(file);if(a.dev===b.dev&&a.ino===b.ino)return true}catch{/* not installed */}
 }
 return false;
}

const runnable=(file:string)=>{try{fs.accessSync(file,fs.constants.X_OK);return fs.statSync(file).isFile()}catch{return false}};
const askVersion=async(file:string,env:NodeJS.ProcessEnv)=>{
 try{const {stdout,stderr}=await execFileAsync(file,['--version'],{env,timeout:5000,maxBuffer:65536});return (stdout||stderr).trim().split('\n')[0]?.slice(0,80)||undefined}
 catch{return undefined}
};
const plistString=(xml:string,key:string)=>xml.match(new RegExp(`<key>${key}</key>\\s*<string>\\s*([^<\\s]{1,40})\\s*</string>`))?.[1];
/** An app's version from its Info.plist, only read (a binary plist is turned into text by plutil): the app is never run. */
export async function bundleVersion(app:string){
 const file=path.join(app,'Contents','Info.plist');
 try{
  const bytes=fs.readFileSync(file);
  const xml=bytes.subarray(0,8).toString('latin1')==='bplist00'
   ?(await execFileAsync('/usr/bin/plutil',['-convert','xml1','-o','-',file],{timeout:3000,maxBuffer:1<<20})).stdout:bytes.toString('utf8');
  return plistString(xml,'CFBundleShortVersionString')??plistString(xml,'CFBundleVersion');
 }catch{return undefined}
}
const appsMatching=(match:RegExp,apps:string[])=>apps.flatMap(dir=>{try{return fs.readdirSync(dir).filter(name=>match.test(name)).map(name=>path.join(dir,name))}catch{return []}});
/** Shared with the diagnostic API; listing candidates never runs a command. */
export function rosterExecutableCandidates(agent:RosterAgent,options:RosterOptions={}):string[]{
 const home=options.home??os.homedir(),apps=options.applicationDirs??['/Applications',path.join(home,'Applications')];
 const env=options.env??tools.loginEnvironment();
 const dirs=[...new Set([...String(env.PATH||env.Path||'').split(path.delimiter),...(process.platform==='win32'?[env.APPDATA&&path.join(env.APPDATA,'npm'),env.LOCALAPPDATA&&path.join(env.LOCALAPPDATA,'Programs')].filter((dir):dir is string=>!!dir):[]),path.join(home,'.local','bin'),path.join(home,'.npm-global','bin'),'/opt/homebrew/bin','/usr/local/bin',...(agent.dirs?.(home,apps)??[])].filter(dir=>path.isAbsolute(dir)))];
 return dirs.flatMap(dir=>agent.names.flatMap(name=>(process.platform==='win32'?['.exe','.cmd','.bat'].map(ext=>name+ext):[name]).map(name=>path.join(dir,name))));
}
/** One agent: its program on the login shell's PATH, in the folders installers use, or inside its maker's app. */
export async function rosterAgentStatus(agent:RosterAgent,options:RosterOptions={}):Promise<RosterStatus>{
 const home=options.home??os.homedir(),apps=options.applicationDirs??['/Applications',path.join(home,'Applications')];
 const base={id:agent.id,name:agent.name,kind:agent.kind??'agent' as const,page:agent.page};
 if(agent.kind==='tool'){
  // the recording module's lookup, in this server's own environment as the module sees it
  const executable=findOpenScreenExecutable({env:options.env??process.env,home,applicationDirs:apps,...(options.binDirs?{binDirs:options.binDirs}:{})});
  if(!executable)return {...base,state:'missing'};
  let app:string|undefined;try{app=appBundleForExecutable(executable)}catch{}
  return {...base,state:'found',executable,...(app?{app:{name:agent.name,path:app},version:await (options.bundleVersion??bundleVersion)(app)}:{})};
 }
 const env=options.env??tools.loginEnvironment();
 const executable=rosterExecutableCandidates(agent,{...options,home,env,applicationDirs:apps}).find(file=>runnable(file)&&!isClaudeExecutable(file,env));
 if(executable)return {...base,state:'found',executable,version:options.readVersion===false?undefined:await (options.version??askVersion)(executable,env)};
 const app=agent.app&&appsMatching(agent.app.match,apps)[0];
 return {...base,state:'missing',...(app?{app:{name:agent.app!.name,path:app}}:{}),...(agent.installer?{installCommand:agent.installer}:{})};
}
export const agentRosterStatus=(options:RosterOptions={})=>Promise.all(ROSTER_AGENTS.map(agent=>rosterAgentStatus(agent,options)));
/** The official installer of a roster agent the person confirmed, exactly as listed: nothing else is run. */
export function rosterInstallCommand(id:string,command:unknown){
 const agent=ROSTER_AGENTS.find(item=>item.id===id);
 if(!agent?.installer)throw Error(`${agent?.name??'这个 Agent'} 没有可在这里运行的官方安装命令，请从它的${agent?.kind==='tool'?'下载页':'安装页'}安装`);
 if(command!==agent.installer)throw Error('安装命令未经确认或已变化，请重新确认后再运行');
 return agent.installer;
}
