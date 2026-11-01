/** 两个版本共用的接入契约。这里不保存、返回或记录密钥。 */
export const CONNECTION_IDS = ['codex','claude','kimi','deepseek','minimax','codebuddy','copilot','cursor','opencode','qwen','dreamina','minimax-speech','hailuo'] as const;
export type ConnectionId = typeof CONNECTION_IDS[number];
export type ConnectionMode = 'cli'|'api';
export type CliAuthState='connected'|'needs-login'|'unknown'|'pending'|'disabled'|'missing';
export const AGENT_CONNECTION_IDS=['codex','claude','kimi','deepseek','minimax','codebuddy','copilot','cursor','opencode','qwen'] as const;
export type AgentConnectionId=typeof AGENT_CONNECTION_IDS[number];
export const LIGHT_AGENT_MODULES=['smallCard','captionTranslation','spokenScript','brollPrompt'] as const;
export type ConnectionModel = {id:string;name:string;isDefault?:boolean};
export type ConnectionConfig = {authRejectedAt?:string;revision?:number;mode:ConnectionMode;enabled:boolean;baseUrl:string;model:string;cliPath:string;hasKey:boolean;models:ConnectionModel[];checkedAt?:string;connected?:boolean;message?:string};
export type ConnectionView = ConnectionConfig & {cliVersion?:string;filmMinimumVersion?:string;filmOutdated?:boolean;upgradeCommand?:string;acpModelSelection?:boolean;acpVerification?:'local'|'docs'|'pending';acpNote?:string;loginHint?:string;cliAuthState?:CliAuthState;cliAuthMessage?:string;cliLoginAvailable?:boolean;id:ConnectionId;name:string;kind:'agent'|'service';cliInstalled:boolean;executable?:string;relay:boolean;heavySupported:boolean;state:'connected'|'disabled'|'unconfigured'|'pending';protocol:string;cliReason?:string;apiReason?:string};
export type ConnectionDefinition = {id:ConnectionId;name:string;kind:'agent'|'service';baseUrl:string;hosts:string[];protocol:'responses'|'anthropic'|'chat'|'voices'|'hailuo'|'ark'|'pending';cliNames:string[];heavySupported:boolean;acpArgs?:readonly string[];loginArgs?:readonly string[];logoutArgs?:readonly string[];filmMinimumVersion?:string;upgradeCommand?:string;authStatusArgs?:readonly string[];installCommand?:string;acpVerification?:'local'|'docs'|'pending';acpNote?:string;loginHint?:string;cliReason?:string;apiReason?:string;page:string};
export const CONNECTION_DEFINITIONS:readonly ConnectionDefinition[] = [
 {id:'codex',name:'Codex',kind:'agent',baseUrl:'https://api.openai.com/v1',hosts:['api.openai.com'],protocol:'responses',cliNames:['codex'],heavySupported:true,loginArgs:['login'],logoutArgs:['logout'],authStatusArgs:['login','status'],page:'https://developers.openai.com/codex/cli/'},
 {id:'claude',name:'Claude Code',kind:'agent',baseUrl:'https://api.anthropic.com',hosts:['api.anthropic.com'],protocol:'anthropic',cliNames:['claude'],heavySupported:true,loginArgs:['auth','login'],logoutArgs:['auth','logout'],authStatusArgs:['auth','status','--json'],page:'https://code.claude.com/docs/en/overview'},
 {id:'kimi',name:'Kimi',kind:'agent',baseUrl:'https://api.moonshot.cn/v1',hosts:['api.moonshot.cn','api.moonshot.ai'],protocol:'chat',cliNames:['kimi'],heavySupported:true,acpArgs:['acp'],loginArgs:['login'],acpVerification:'local',acpNote:'本机 ACP 与登录参数已核实；真实出片待验收',page:'https://www.kimi.com/code/docs/en/kimi-code-cli/'},
 {id:'deepseek',name:'DeepSeek',kind:'agent',baseUrl:'https://api.deepseek.com',hosts:['api.deepseek.com'],protocol:'chat',cliNames:['dsh'],heavySupported:false,acpVerification:'pending',acpNote:'未确认官方原生 ACP 启动方式，待适配',cliReason:'原生 ACP 待适配；可用 API 密钥处理纯文字',page:'https://api-docs.deepseek.com/'},
 {id:'minimax',name:'MiniMax Code',kind:'agent',baseUrl:'https://api.minimax.io/v1',hosts:['api.minimax.io','api.minimax.cn','api.minimaxi.com'],protocol:'chat',cliNames:['mcode','mmx-code'],heavySupported:true,acpArgs:['acp'],loginArgs:['login'],logoutArgs:['logout'],acpVerification:'docs',acpNote:'官方文档已核实；本机帮助被权限拦截，未实机验证',page:'https://platform.minimax.io/docs/api-reference/text-openai-api'},
 {id:'codebuddy',name:'CodeBuddy',kind:'agent',baseUrl:'',hosts:[],protocol:'pending',cliNames:['codebuddy','cbc'],heavySupported:true,acpArgs:['--acp'],loginArgs:[],loginHint:'终端打开后输入 /login',acpVerification:'docs',acpNote:'官方文档已核实，未实机验证',apiReason:'官方通用 API 接入格式待适配',page:'https://www.codebuddy.cn/docs/cli/installation'},
 {id:'copilot',filmMinimumVersion:'0.0.397',upgradeCommand:'npm install -g @github/copilot',name:'GitHub Copilot',kind:'agent',baseUrl:'',hosts:[],protocol:'pending',cliNames:['copilot'],heavySupported:true,acpArgs:['--acp','--stdio'],loginArgs:['login'],installCommand:'npm install -g @github/copilot',acpVerification:'docs',acpNote:'官方文档已核实，未实机验证',apiReason:'使用本机 Copilot 登录，通用 API 待适配',page:'https://docs.github.com/en/copilot/reference/copilot-cli-reference/acp-server'},
 {id:'cursor',name:'Cursor',kind:'agent',baseUrl:'',hosts:[],protocol:'pending',cliNames:['agent','cursor-agent'],heavySupported:true,acpArgs:['acp'],loginArgs:['login'],logoutArgs:['logout'],authStatusArgs:['status'],installCommand:'curl https://cursor.com/install -fsS | bash',acpVerification:'docs',acpNote:'官方文档已核实，未实机验证',apiReason:'使用本机 Cursor 登录，通用 API 待适配',page:'https://cursor.com/docs/cli/acp'},
 {id:'opencode',name:'OpenCode',kind:'agent',baseUrl:'',hosts:[],protocol:'pending',cliNames:['opencode'],heavySupported:true,acpArgs:['acp'],loginArgs:['auth','login'],logoutArgs:['auth','logout'],authStatusArgs:['auth','list'],installCommand:'curl -fsSL https://opencode.ai/install | bash',acpVerification:'docs',acpNote:'官方文档已核实，未实机验证',apiReason:'在 OpenCode 自己的终端配置服务商',page:'https://opencode.ai/docs/acp/'},
 {id:'qwen',filmMinimumVersion:'0.6.1',upgradeCommand:'npm install -g @qwen-code/qwen-code@latest',name:'Qwen Code',kind:'agent',baseUrl:'',hosts:[],protocol:'pending',cliNames:['qwen'],heavySupported:true,acpArgs:['--acp'],loginArgs:[],loginHint:'终端打开后输入 /auth',installCommand:'npm install -g @qwen-code/qwen-code@latest',acpVerification:'docs',acpNote:'官方文档已核实，未实机验证',apiReason:'在 Qwen Code 自己的终端配置服务商',page:'https://qwenlm.github.io/qwen-code-docs/en/users/configuration/settings/'},
 {id:'dreamina',name:'即梦 · Seedance 视频 / Seedream 图片',kind:'service',baseUrl:'https://ark.cn-beijing.volces.com/api/v3',hosts:['ark.cn-beijing.volces.com'],protocol:'ark',cliNames:['dreamina'],heavySupported:false,page:'https://www.volcengine.com/docs/82379'},
 {id:'minimax-speech',name:'MiniMax 语音',kind:'service',baseUrl:'https://api.minimax.io/v1',hosts:['api.minimax.io','api.minimax.cn','api.minimaxi.com'],protocol:'voices',cliNames:[],heavySupported:false,cliReason:'官方没有提供命令行，只能用 API 密钥',page:'https://platform.minimax.io/docs/api-reference/voice-management-get'},
 {id:'hailuo',name:'MiniMax 视频 · 海螺',kind:'service',baseUrl:'https://api.minimax.io/v2',hosts:['api.minimax.io','api.minimax.cn','api.minimaxi.com'],protocol:'hailuo',cliNames:[],heavySupported:false,cliReason:'官方没有提供命令行，只能用 API 密钥',page:'https://platform.minimax.io/docs/api-reference/video-generation-intro'},
];
export function connectionDefinition(id:ConnectionId){const definition=CONNECTION_DEFINITIONS.find(item=>item.id===id);if(!definition)throw Error('未知接入项');return definition;}
export function isRelay(id:ConnectionId,baseUrl:string){try{return !connectionDefinition(id).hosts.includes(new URL(baseUrl).hostname)}catch{return false}}
export function defaultConnection(id:ConnectionId):ConnectionConfig {return {mode:'cli',enabled:id!=='claude',baseUrl:connectionDefinition(id).baseUrl,model:'default',cliPath:'',hasKey:false,models:[]};}
/** API film adapters only exist for Codex and Claude; native ACP providers require CLI login. */
export function connectionReadyForFilm(view:ConnectionView){return !!(view.enabled&&view.connected&&!view.filmOutdated&&view.cliInstalled&&view.heavySupported&&(view.mode==='cli'||view.id==='codex'||view.id==='claude'));}
export function connectionReadyForLight(view:ConnectionView){return !!(view.kind==='agent'&&view.enabled&&view.connected&&(view.mode==='api'?!view.apiReason:view.cliInstalled&&view.heavySupported));}
export function agentAcpArgs(id:ConnectionId):string[]|undefined {const args=connectionDefinition(id).acpArgs;return args?[...args]:undefined;}
export function agentCliLoginArgs(id:ConnectionId):string[]|undefined {const args=connectionDefinition(id).loginArgs;return args?[...args]:undefined;}

/** Only documented command-introduction releases are floors; unknown/malformed versions never imply obsolete. */
export function filmVersionOutdated(version:string|undefined,minimum:string|undefined){
 if(!version||!minimum)return false;
 const parse=(v:string)=>/^([0-9]+)\.([0-9]+)\.([0-9]+)(?:[-+].*)?$/.exec(v)?.slice(1,4).map(Number);
 const current=parse(version),floor=parse(minimum);if(!current||!floor)return false;
 for(let i=0;i<3;i++){if(current[i]!==floor[i])return current[i]<floor[i];}
 return /-/.test(version)&&!/-/.test(minimum);
}
