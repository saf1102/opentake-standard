import {builtinPresets,builtinProtocol,type BuiltinProtocol} from './builtin-models.ts';
/** 两个版本共用的接入契约。这里不保存、返回或记录密钥。 */
export const CONNECTION_IDS = ['builtin','codex','claude','kimi','deepseek','minimax','codebuddy','copilot','cursor','opencode','qwen','dreamina','minimax-speech','hailuo'] as const;
export type ConnectionId = typeof CONNECTION_IDS[number];
export type ConnectionMode = 'cli'|'api';
export type CliAuthState='connected'|'needs-login'|'unknown'|'pending'|'disabled'|'missing';
export const AGENT_CONNECTION_IDS=['builtin','codex','claude','kimi','deepseek','minimax','codebuddy','copilot','cursor','opencode','qwen'] as const;
export type AgentConnectionId=typeof AGENT_CONNECTION_IDS[number];
export const LIGHT_AGENT_MODULES=['smallCard','captionTranslation','spokenScript','brollPrompt'] as const;
export type ConnectionModel = {id:string;name:string;isDefault?:boolean};
export const API_TEST_CATEGORIES = ['success','credentials','permission','balance','address','protocol','model','timeout','rate-limit','busy','provider','configuration'] as const;
export type ApiTestCategory = typeof API_TEST_CATEGORIES[number];
export type ConnectionConfig = {deepseekVerifiedRoute?:'official'|'account';deepseekKeyRejected?:boolean;keyId?:string;profileId?:string;profileName?:string;format?:BuiltinProtocol;lastApiTest?:{httpStatus?:number;category:ApiTestCategory};authRejectedAt?:string;blockedReason?:string;revision?:number;mode:ConnectionMode;enabled:boolean;baseUrl:string;model:string;cliPath:string;hasKey:boolean;models:ConnectionModel[];checkedAt?:string;connected?:boolean;message?:string};
export type ConnectionView = ConnectionConfig & {deepseekVerified?:boolean;deepseekRoute?:'official'|'account';workBuddyNeedsCli?:boolean;profiles?:{id:string;name:string}[];cliNotice?:string;installCommand?:string;installPage?:string;filmUnavailableReason?:string;cliVersion?:string;filmMinimumVersion?:string;filmOutdated?:boolean;upgradeCommand?:string;acpModelSelection?:boolean;acpVerification?:'local'|'docs'|'pending';acpNote?:string;loginHint?:string;cliAuthState?:CliAuthState;cliAuthMessage?:string;cliLoginAvailable?:boolean;id:ConnectionId;name:string;kind:'agent'|'service';cliInstalled:boolean;executable?:string;relay:boolean;heavySupported:boolean;state:'connected'|'disabled'|'unconfigured'|'pending';protocol:string;cliReason?:string;apiReason?:string};
export type ConnectionDefinition = {id:ConnectionId;name:string;kind:'agent'|'service';baseUrl:string;hosts:string[];protocol:'responses'|'anthropic'|'chat'|'voices'|'hailuo'|'ark'|'pending';cliNames:string[];heavySupported:boolean;acpArgs?:readonly string[];loginArgs?:readonly string[];logoutArgs?:readonly string[];filmMinimumVersion?:string;upgradeCommand?:string;authStatusArgs?:readonly string[];installCommand?:string;acpVerification?:'local'|'docs'|'pending';acpNote?:string;loginHint?:string;cliReason?:string;apiReason?:string;page:string};
export const CONNECTION_DEFINITIONS:readonly ConnectionDefinition[] = [
 {id:'builtin',name:'内置智能体 · 用自己的密钥',kind:'agent',baseUrl:builtinPresets[0].baseUrl,hosts:builtinPresets.map(p=>new URL(p.baseUrl).hostname),protocol:'chat',cliNames:[],heavySupported:true,acpArgs:[],page:builtinPresets[0].source},
 {id:'codex',name:'Codex',kind:'agent',baseUrl:'https://api.openai.com/v1',hosts:['api.openai.com'],protocol:'responses',cliNames:['codex'],heavySupported:true,loginArgs:['login'],logoutArgs:['logout'],authStatusArgs:['login','status'],page:'https://developers.openai.com/codex/cli/'},
 {id:'claude',name:'Claude Code',kind:'agent',baseUrl:'https://api.anthropic.com',hosts:['api.anthropic.com'],protocol:'anthropic',cliNames:['claude'],heavySupported:true,loginArgs:['auth','login'],logoutArgs:['auth','logout'],authStatusArgs:['auth','status','--json'],page:'https://code.claude.com/docs/en/overview'},
 {id:'kimi',name:'Kimi',kind:'agent',baseUrl:'https://api.moonshot.cn/v1',hosts:['api.moonshot.cn','api.moonshot.ai','api.kimi.com','api.kimi.ai'],protocol:'chat',cliNames:['kimi'],heavySupported:true,acpArgs:['acp'],loginArgs:['login'],acpVerification:'local',acpNote:'本机 ACP 与登录参数已核实；真实出片待验收',page:'https://www.kimi.com/code/docs/en/kimi-code-cli/'},
 {id:'deepseek',name:'DeepSeek',kind:'agent',baseUrl:'https://api.deepseek.com',hosts:['api.deepseek.com'],protocol:'chat',cliNames:['dsh'],heavySupported:true,acpArgs:['--profile','acp'],acpVerification:'local',acpNote:'Windows 虚拟机已验证 Harness 0.2.2-rc.5 的 ACP 握手和桌面账号回复',installCommand:'npm install -g @deepseek-ai/dsh',page:'https://github.com/deepseek-ai/deepseek-harness'},
 {id:'minimax',name:'MiniMax Code',kind:'agent',baseUrl:'https://api.minimax.io/v1',hosts:['api.minimax.io','api.minimax.cn','api.minimaxi.com'],protocol:'chat',cliNames:['mcode','mmx-code'],heavySupported:true,acpArgs:['acp'],loginArgs:['login'],logoutArgs:['logout'],acpVerification:'docs',acpNote:'官方文档已核实；本机帮助被权限拦截，未实机验证',page:'https://platform.minimax.io/docs/api-reference/text-openai-api'},
 {id:'codebuddy',name:'CodeBuddy / WorkBuddy',kind:'agent',baseUrl:'',hosts:[],protocol:'pending',cliNames:['codebuddy','cbc'],heavySupported:true,acpArgs:['--acp','--permission-mode','bypassPermissions'],loginArgs:[],loginHint:'终端打开后输入 /login',acpVerification:'local',acpNote:'Windows 11 ARM 已验证独立 CodeBuddy 2.185.0 的登录、ACP 会话和流式回复',apiReason:'官方通用 API 接入格式待适配',page:'https://www.codebuddy.cn/docs/cli/installation'},
 {id:'copilot',filmMinimumVersion:'0.0.397',upgradeCommand:'npm install -g @github/copilot',name:'GitHub Copilot',kind:'agent',baseUrl:'',hosts:[],protocol:'pending',cliNames:['copilot'],heavySupported:true,acpArgs:['--acp','--stdio','--allow-all'],loginArgs:['login'],installCommand:'npm install -g @github/copilot',acpVerification:'docs',acpNote:'官方文档已核实，未实机验证',apiReason:'使用本机 Copilot 登录，通用 API 待适配',page:'https://docs.github.com/en/copilot/reference/copilot-cli-reference/acp-server'},
 {id:'cursor',name:'Cursor',kind:'agent',baseUrl:'',hosts:[],protocol:'pending',cliNames:['agent','cursor-agent'],heavySupported:true,acpArgs:['--force','acp'],loginArgs:['login'],logoutArgs:['logout'],authStatusArgs:['status'],installCommand:'curl https://cursor.com/install -fsS | bash',acpVerification:'docs',acpNote:'官方文档已核实，未实机验证',apiReason:'使用本机 Cursor 登录，通用 API 待适配',page:'https://cursor.com/docs/cli/acp'},
 {id:'opencode',name:'OpenCode',kind:'agent',baseUrl:'',hosts:[],protocol:'pending',cliNames:['opencode'],heavySupported:true,acpArgs:['acp'],loginArgs:['auth','login'],logoutArgs:['auth','logout'],authStatusArgs:['auth','list'],installCommand:'curl -fsSL https://opencode.ai/install | bash',acpVerification:'docs',acpNote:'官方文档已核实，未实机验证',apiReason:'在 OpenCode 自己的终端配置服务商',page:'https://opencode.ai/docs/acp/'},
 {id:'qwen',filmMinimumVersion:'0.6.1',upgradeCommand:'npm install -g @qwen-code/qwen-code@latest',name:'Qwen Code',kind:'agent',baseUrl:'',hosts:[],protocol:'pending',cliNames:['qwen'],heavySupported:true,acpArgs:['--acp','--approval-mode','yolo'],loginArgs:[],loginHint:'终端打开后输入 /auth',installCommand:'npm install -g @qwen-code/qwen-code@latest',acpVerification:'docs',acpNote:'官方文档已核实，未实机验证',apiReason:'在 Qwen Code 自己的终端配置服务商',page:'https://qwenlm.github.io/qwen-code-docs/en/users/configuration/settings/'},
 {id:'dreamina',name:'即梦 · Seedance 视频 / Seedream 图片',kind:'service',baseUrl:'https://ark.cn-beijing.volces.com/api/v3',hosts:['ark.cn-beijing.volces.com'],protocol:'ark',cliNames:['dreamina'],heavySupported:false,page:'https://www.volcengine.com/docs/82379'},
 {id:'minimax-speech',name:'MiniMax 语音',kind:'service',baseUrl:'https://api.minimax.io/v1',hosts:['api.minimax.io','api.minimax.cn','api.minimaxi.com'],protocol:'voices',cliNames:[],heavySupported:false,cliReason:'官方没有提供命令行，只能用 API 密钥',page:'https://platform.minimax.io/docs/api-reference/voice-management-get'},
 {id:'hailuo',name:'MiniMax 视频 · 海螺',kind:'service',baseUrl:'https://api.minimax.io/v2',hosts:['api.minimax.io','api.minimax.cn','api.minimaxi.com'],protocol:'hailuo',cliNames:[],heavySupported:false,cliReason:'官方没有提供命令行，只能用 API 密钥',page:'https://platform.minimax.io/docs/api-reference/video-generation-intro'},
];
export function connectionDefinition(id:ConnectionId){const definition=CONNECTION_DEFINITIONS.find(item=>item.id===id);if(!definition)throw Error('未知接入项');return definition;}
// Kimi Coding documents separate roots for Messages and Chat. MiniMax and DeepSeek
// likewise publish an /anthropic root alongside their Chat API. Keep custom relay prefixes.
export function connectionProtocol(id:ConnectionId,baseUrl:string,format?:BuiltinProtocol):ConnectionDefinition['protocol'] {
 if(id==='builtin')return builtinProtocol(baseUrl,format);
 const definition=connectionDefinition(id);
 if(definition.protocol!=='chat')return definition.protocol;
 try {
  const url=new URL(baseUrl);
  const path=url.pathname.replace(/\/{2,}/g,'/').replace(/\/+$/,'');
  if((id==='minimax'||id==='deepseek')&&/\/anthropic(?:\/v1(?:\/.*)?)?$/i.test(path))return 'anthropic';
  if(id==='kimi'&&['api.kimi.com','api.kimi.ai'].includes(url.hostname)&&/^\/coding(?:\/v1\/messages(?:\/count_tokens)?)?$/.test(path))return 'anthropic';
 }catch{/* The settings validator reports invalid addresses. */}
 return definition.protocol;
}
export function normalizeConnectionBaseUrl(id:ConnectionId,value:string,format?:BuiltinProtocol){
 const definition=connectionDefinition(id);
 if(definition.kind!=='agent'||!['responses','anthropic','chat'].includes(definition.protocol)||!value)return value;
 let url:URL;
 try{url=new URL(value.trim().includes('://')?value.trim():'https://'+value.trim())}catch{return value}
 if(url.username||url.password||url.search||url.hash)return value;
 let route=url.pathname.replace(/\/{2,}/g,'/').replace(/\/+$/,'');
 const protocol=connectionProtocol(id,url.href,format);
 route=route.replace(/(?:\/(?:messages(?:\/count_tokens)?|responses(?:\/input_tokens)?|chat\/completions|completions|models))+$/i,'');
 if(protocol==='anthropic')route=route.replace(/\/v1$/i,'');
 else if(!route&&id==='builtin'&&url.hostname==='api.openai.com')route='/v1';
 else if(!route&&id==='kimi'&&['api.kimi.com','api.kimi.ai'].includes(url.hostname))route='/coding/v1';
 else if(!route&&definition.hosts.includes(url.hostname)&&['codex','minimax','kimi'].includes(id))route='/v1';
 return url.origin+route;
}
// 2026-11-20: https://api-docs.deepseek.com/zh-cn/guides/responses_api/
// https://api-docs.deepseek.com/quick_start/pricing/ also documents both legacy Flash aliases.
export const DEEPSEEK_CODEX_MODEL='deepseek-flash';
export const DEEPSEEK_CODEX_URL='https://api.deepseek.com';
export function deepseekCodexEndpoint(id:ConnectionId,baseUrl:string){
 if(id!=='codex')return false;
 const root=normalizeConnectionBaseUrl(id,baseUrl);
 return root===DEEPSEEK_CODEX_URL||root===DEEPSEEK_CODEX_URL+'/v1';
}
export function deepseekResponsesModel(model:string){
 return [DEEPSEEK_CODEX_MODEL,'deepseek-v4-pro','deepseek-v4-flash','deepseek-v4-flash-vision-exp'].includes(model);
}
export function isRelay(id:ConnectionId,baseUrl:string){if(deepseekCodexEndpoint(id,baseUrl))return false;try{return !connectionDefinition(id).hosts.includes(new URL(baseUrl).hostname)}catch{return false}}
export function defaultConnection(id:ConnectionId):ConnectionConfig {return {...(id==='builtin'?{profileId:'main',profileName:'我的模型',format:'auto' as const}:{}),mode:id==='builtin'?'api':'cli',enabled:id!=='claude',baseUrl:connectionDefinition(id).baseUrl,model:id==='builtin'?builtinPresets[0].model:'default',cliPath:'',hasKey:false,models:[]};}
/** Shared Windows policy for both editions; connection/login settings remain available. */
export function agentFilmUnavailableReason(id:ConnectionId,target=(globalThis as {process?:{platform?:string}}).process?.platform||(typeof navigator!=='undefined'&&/Win/.test(navigator.platform||navigator.userAgent||'')?'win32':'darwin')){
 return id==='claude'&&target==='win32'?'Windows 上暂不能出片，请先用 Codex 等其他智能体':undefined;
}
/** API film adapters only exist for Codex and Claude; native ACP providers require CLI login. */
export function connectionReadyForFilm(view:ConnectionView){return !!(!agentFilmUnavailableReason(view.id)&&!view.filmUnavailableReason&&view.enabled&&view.connected&&!view.filmOutdated&&(view.id==='builtin'||view.cliInstalled)&&view.heavySupported&&(view.mode==='cli'||view.id==='builtin'||view.id==='codex'||view.id==='claude'));}
export function harnessRouteLabel(view:ConnectionView){
 if(!view.deepseekRoute)return '等待检查';
 const label=view.deepseekRoute==='account'?'DeepSeek 桌面账号':'DeepSeek API 密钥';
 return view.connected&&!view.deepseekVerified?label+' · 待验证':label;
}
export function connectionMethodLabel(view:ConnectionView){
 if(view.mode==='api')return 'API 密钥';
 return view.id==='deepseek'?'Harness · '+harnessRouteLabel(view):'命令行 · 账号登录';
}
export function selectableAgentModels(view?:ConnectionView){
 return view?.id==='builtin'?[{id:view.model,name:view.model,isDefault:true}]:view?.models||[];
}
export function connectionReadyForLight(view:ConnectionView){return !!(view.kind==='agent'&&view.enabled&&view.connected&&(view.mode==='api'?!view.apiReason:view.cliInstalled&&view.heavySupported));}
export function agentAcpArgs(id:ConnectionId):string[]|undefined {const args=connectionDefinition(id).acpArgs;return args?[...args]:undefined;}
export function agentCliLoginArgs(id:ConnectionId):string[]|undefined {const args=connectionDefinition(id).loginArgs;return args?[...args]:undefined;}

// A Windows installation without Git Bash prints installation advice alongside its version.
export function cliVersionNumber(id:string,output:string){
 const number=/\b(?:v)?(\d{1,6}\.\d{1,6}\.\d{1,6}(?:[-+][a-zA-Z0-9.-]{1,40})?)\b/i;
 if(id==='codebuddy'){
  for(const line of output.split(/\r?\n/).map(value=>value.trim())){
   if(/^(?:v?\d+\.|(?:@genie\/agent-cli|codebuddy(?:[ -]code)?|cbc)\s*[:@v\d -])/i.test(line)){
    const version=line.match(number)?.[1];
    if(version)return version;
   }
  }
  return undefined;
 }
 return output.match(number)?.[1];
}

/** Only documented command-introduction releases are floors; unknown/malformed versions never imply obsolete. */
export function filmVersionOutdated(version:string|undefined,minimum:string|undefined){
 if(!version||!minimum)return false;
 const parse=(v:string)=>/^([0-9]+)\.([0-9]+)\.([0-9]+)(?:[-+].*)?$/.exec(v)?.slice(1,4).map(Number);
 const current=parse(version),floor=parse(minimum);if(!current||!floor)return false;
 for(let i=0;i<3;i++){if(current[i]!==floor[i])return current[i]<floor[i];}
 return /-/.test(version)&&!/-/.test(minimum);
}
