import os from 'node:os';
import {execFileAsync} from './proc.ts';
import {systemPowerShell} from './windows-agent-terminal.ts';
import {AGENT_CONNECTION_IDS,connectionProtocol} from '../shared/agent-connections.ts';
import {getConnectionConfig} from './agent-connections.ts';
import {getAgentDiagnostics} from './agent-management.ts';
import installations from './agent-installation.ts';

const sources:Record<string,string>={
 'process':'进程','registry-user':'用户注册表','registry-system':'系统注册表','login-shell':'登录终端','fallback':'兜底目录',
};
const results={'access-denied':'拒绝访问','executable':'找到','missing':'不存在','invalid':'不可执行','version-unreadable':'版本读不出'};
const categories={
 success:'通过',credentials:'密钥不正确',permission:'没有权限',balance:'余额不足',address:'地址或网络',protocol:'协议不匹配',
 model:'模型名不正确',timeout:'请求超时','rate-limit':'请求太频繁',busy:'服务繁忙',provider:'服务异常',configuration:'配置未完成',
};

// Only installation and API vocabulary is public. Private directory/tenant names get stable
// placeholders within this report, so two custom locations can still be distinguished.
const knownSegments=new Set((
 'usr|sbin|bin|opt|local|homebrew|Applications|Contents|Resources|MacOS|Application Support|Library|.local|.npm-global|'+
 '.nvm|versions|node|nodejs|.bun|.volta|.asdf|.local|share|mise|fnm|node-versions|installation|shims|.kimi-code|'+
 '.minimax-code|.opencode|.claude|Program Files|Program Files (x86)|AppData|Local|Roaming|Programs|Microsoft|WindowsApps|'+
 'WorkBuddy|DeepSeek Harness|app.asar.unpacked|dist|codebuddy-lite-wb|WinGet|Links|Volta|pnpm|Yarn|chocolatey|scoop|apps|current|npm|node_modules|vendor|runtime|cli|packages|.codex|@openai|app|'+
 'codex|codex-cli|codexcli|claude|claude-code|kimi|deepseek|dsh|mcode|mmx-code|minimax|codebuddy|cbc|copilot|agent|cursor-agent|cursor|opencode|qwen|'+
 'v1|v2|v3|v4|api|openai|anthropic|compatible-mode|compatibility|coding|gateway|proxy|relay|models|messages|chat|completions|responses|'+
 'x86_64-pc-windows-msvc|codex-win32-x64'
).toLowerCase().split('|'));
function privatePathFormatter(home:string){
 const aliases=new Map<string,string>();
 const segment=(part:string)=>{
  if(!part||part==='~'||knownSegments.has(part.replace(/\.(app|exe|cmd|ps1|bat|mjs)$/i,'').toLowerCase())||/^(?:v?\d+(?:\.\d+){0,3}|[a-z]:)$/i.test(part))return part;
  if(/^OpenAI\.Codex_[\d.]+_(?:x64|arm64|x86)__[a-z0-9]+$/i.test(part))return part;
  let alias=aliases.get(part);
  if(!alias){alias='[自定'+(aliases.size+1)+']';aliases.set(part,alias);}
  return alias;
 };
 const clean=(file:string)=>{
  let normalized=file.replaceAll('\\','/');
  const prefix=home.replaceAll('\\','/').replace(/\/$/,'');
  const windows=/^[a-z]:\//i.test(prefix);
  if(prefix&&(windows?normalized.toLowerCase():normalized).startsWith((windows?prefix.toLowerCase():prefix)+'/'))normalized='~'+normalized.slice(prefix.length);
  normalized=normalized.replace(/^(?:[a-z]:)?\/(?:users|home)\/[^/]+(?=\/|$)/i,'~');
  return normalized.split('/').map(segment).join('/');
 };
 const endpoint=(value:string)=>{
  try{
   const url=new URL(value);
   if(!['http:','https:'].includes(url.protocol))return '地址无效';
   return url.host+url.pathname.split('/').map(segment).join('/');
  }catch{return value?'地址无效':'还没填写';}
 };
 return {clean,endpoint};
}

// WinHTTP reads the active user's Internet Options without resolving a destination or contacting a proxy.
// https://learn.microsoft.com/windows/win32/api/winhttp/nf-winhttp-winhttpgetieproxyconfigforcurrentuser
const windowsProxySwitch=`$ErrorActionPreference='Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class OpenTakeProxy {
 [StructLayout(LayoutKind.Sequential)]
 struct Config { public int AutoDetect; public IntPtr AutoConfig, Proxy, Bypass; }
 [DllImport("winhttp.dll")] static extern bool WinHttpGetIEProxyConfigForCurrentUser(out Config config);
 [DllImport("kernel32.dll")] static extern IntPtr GlobalFree(IntPtr memory);
 public static int Switch() {
  Config config;
  if (!WinHttpGetIEProxyConfigForCurrentUser(out config)) return -1;
  try {
   return config.AutoDetect != 0 || HasText(config.Proxy) || HasText(config.AutoConfig) ? 1 : 0;
  } finally {
   GlobalFree(config.AutoConfig); GlobalFree(config.Proxy); GlobalFree(config.Bypass);
  }
 }
 static bool HasText(IntPtr text) { return text != IntPtr.Zero && Marshal.ReadInt16(text) != 0; }
}
'@
[OpenTakeProxy]::Switch()`;

// Run only when the user asks for diagnostics. Process output and errors never enter the report.
export async function systemProxySwitch(platform:NodeJS.Platform=process.platform,run=execFileAsync):Promise<'开'|'关'|'未能读取'>{
 try{
  if(platform==='darwin'){
   const {stdout}=await run('/usr/sbin/scutil',['--proxy'],{timeout:1000,maxBuffer:65536});
   if(!/^<dictionary>\s*\{[\s\S]*\}\s*$/.test(stdout.trim()))return '未能读取';
   const flags=stdout.split('\n').filter(line=>/^\s*(?:HTTP|HTTPS|SOCKS|FTP|RTSP|Gopher|ProxyAutoConfig|ProxyAutoDiscovery)Enable\s*:/.test(line));
   if(flags.some(line=>/:\s*1\s*$/.test(line)))return '开';
   return flags.every(line=>/:\s*0\s*$/.test(line))?'关':'未能读取';
  }
  if(platform==='win32'){
   const script=Buffer.from(windowsProxySwitch,'utf16le').toString('base64');
   const {stdout}=await run(systemPowerShell(),['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',script],{timeout:5000,maxBuffer:4096,windowsHide:true});
   return stdout.trim()==='1'?'开':stdout.trim()==='0'?'关':'未能读取';
  }
 }catch{/* An unreadable system configuration has no known switch state. */}
 return '未能读取';
}

export async function agentDiagnosticReport(edition:'Pro'|'标准版',deps={
 home:os.homedir(),appVersion:process.env.OPENTAKE_HOST_VERSION,system:os.type()+' '+os.release()+' '+os.arch(),
 systemProxy:systemProxySwitch,environment:()=>installations.agentEnvironmentSnapshot(),config:getConnectionConfig,inventory:getAgentDiagnostics,
}){
 const proxy=deps.systemProxy();
 const {env,pathSources,loginShellTimedOut}=deps.environment();
 const formatter=privatePathFormatter(deps.home);
 const version=deps.appVersion&&/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(deps.appVersion)?deps.appVersion:'源码运行';
 const lines=['OpenTake '+edition+' · '+version,'系统　'+deps.system,'系统代理　'+(await proxy),
  'PATH 来源　'+(pathSources.map(source=>sources[source]).filter(Boolean).join('、')||'无'),
  '登录终端　'+(loginShellTimedOut?'等待超时':pathSources.includes('login-shell')?'已读取':'未读取')];
 for(const id of AGENT_CONNECTION_IDS){
  const config=deps.config(id);
  const agent=deps.inventory(id,{home:deps.home,env});
  lines.push('',agent.name+' · '+(agent.mode==='manual'?'指定位置':'自动查找'));
  for(const item of agent.candidates)lines.push(formatter.clean(item.path)+'　'+results[item.status]);
  if(!agent.candidates.length)lines.push('没有候选位置');
  if(config.mode==='api'){
   const test=config.lastApiTest;
   lines.push('API　'+formatter.endpoint(config.baseUrl)+'　协议　'+connectionProtocol(id,config.baseUrl),
    '最近测试　'+(test?(test.httpStatus?'HTTP '+test.httpStatus:'无 HTTP 状态')+' · '+categories[test.category]:'尚无记录'));
  }
 }
 return lines.join('\n');
}
