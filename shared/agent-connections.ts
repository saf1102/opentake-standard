/** 两个版本共用的接入契约。这里不保存、返回或记录密钥。 */
export const CONNECTION_IDS = ['codex','claude','kimi','deepseek','minimax','codebuddy','dreamina','minimax-speech','hailuo'] as const;
export type ConnectionId = typeof CONNECTION_IDS[number];
export type ConnectionMode = 'cli'|'api';
export const AGENT_CONNECTION_IDS=['codex','claude','kimi','deepseek','minimax','codebuddy'] as const;
export type AgentConnectionId=typeof AGENT_CONNECTION_IDS[number];
export const LIGHT_AGENT_MODULES=['smallCard','captionTranslation','spokenScript','brollPrompt'] as const;
export type ConnectionModel = {id:string;name:string;isDefault?:boolean};
export type ConnectionConfig = {revision?:number;mode:ConnectionMode;enabled:boolean;baseUrl:string;model:string;cliPath:string;hasKey:boolean;models:ConnectionModel[];checkedAt?:string;connected?:boolean;message?:string};
export type ConnectionView = ConnectionConfig & {id:ConnectionId;name:string;kind:'agent'|'service';cliInstalled:boolean;executable?:string;relay:boolean;heavySupported:boolean;state:'connected'|'disabled'|'unconfigured'|'pending';protocol:string;cliReason?:string;apiReason?:string};
export type ConnectionDefinition = {id:ConnectionId;name:string;kind:'agent'|'service';baseUrl:string;hosts:string[];protocol:'responses'|'anthropic'|'chat'|'voices'|'hailuo'|'ark'|'pending';cliNames:string[];heavySupported:boolean;cliReason?:string;apiReason?:string;page:string};
export const CONNECTION_DEFINITIONS:readonly ConnectionDefinition[] = [
 {id:'codex',name:'Codex',kind:'agent',baseUrl:'https://api.openai.com/v1',hosts:['api.openai.com'],protocol:'responses',cliNames:['codex'],heavySupported:true,page:'https://developers.openai.com/codex/cli/'},
 {id:'claude',name:'Claude Code',kind:'agent',baseUrl:'https://api.anthropic.com',hosts:['api.anthropic.com'],protocol:'anthropic',cliNames:['claude'],heavySupported:true,page:'https://code.claude.com/docs/en/overview'},
 {id:'kimi',name:'Kimi',kind:'agent',baseUrl:'https://api.moonshot.cn/v1',hosts:['api.moonshot.cn','api.moonshot.ai'],protocol:'chat',cliNames:['kimi'],heavySupported:false,cliReason:'命令行连通检测及出片待适配：官方未提供已确认的无消耗非交互账号检查；可用 API 密钥处理纯文字',page:'https://www.kimi.com/code/docs/en/kimi-code-cli/'},
 {id:'deepseek',name:'DeepSeek',kind:'agent',baseUrl:'https://api.deepseek.com',hosts:['api.deepseek.com'],protocol:'chat',cliNames:['dsh'],heavySupported:false,cliReason:'命令行接入待适配；可用 API 密钥处理纯文字',page:'https://api-docs.deepseek.com/'},
 {id:'minimax',name:'MiniMax Code',kind:'agent',baseUrl:'https://api.minimax.io/v1',hosts:['api.minimax.io','api.minimax.cn','api.minimaxi.com'],protocol:'chat',cliNames:['mcode','mmx-code'],heavySupported:false,cliReason:'命令行连通检测及出片待适配：官方未提供已确认的无消耗非交互账号检查；可用 API 密钥处理纯文字',page:'https://platform.minimax.io/docs/api-reference/text-openai-api'},
 {id:'codebuddy',name:'CodeBuddy',kind:'agent',baseUrl:'',hosts:[],protocol:'pending',cliNames:['codebuddy','cbc'],heavySupported:false,cliReason:'命令行接入待适配',apiReason:'官方通用 API 接入格式待适配',page:'https://www.codebuddy.cn/docs/cli/installation'},
 {id:'dreamina',name:'即梦 · Seedance 视频 / Seedream 图片',kind:'service',baseUrl:'https://ark.cn-beijing.volces.com/api/v3',hosts:['ark.cn-beijing.volces.com'],protocol:'ark',cliNames:['dreamina'],heavySupported:false,page:'https://www.volcengine.com/docs/82379'},
 {id:'minimax-speech',name:'MiniMax 语音',kind:'service',baseUrl:'https://api.minimax.io/v1',hosts:['api.minimax.io','api.minimax.cn','api.minimaxi.com'],protocol:'voices',cliNames:[],heavySupported:false,cliReason:'官方没有提供命令行，只能用 API 密钥',page:'https://platform.minimax.io/docs/api-reference/voice-management-get'},
 {id:'hailuo',name:'MiniMax 视频 · 海螺',kind:'service',baseUrl:'https://api.minimax.io/v2',hosts:['api.minimax.io','api.minimax.cn','api.minimaxi.com'],protocol:'hailuo',cliNames:[],heavySupported:false,cliReason:'官方没有提供命令行，只能用 API 密钥',page:'https://platform.minimax.io/docs/api-reference/video-generation-intro'},
];
export function connectionDefinition(id:ConnectionId){const definition=CONNECTION_DEFINITIONS.find(item=>item.id===id);if(!definition)throw Error('未知接入项');return definition;}
export function isRelay(id:ConnectionId,baseUrl:string){try{return !connectionDefinition(id).hosts.includes(new URL(baseUrl).hostname)}catch{return false}}
export function defaultConnection(id:ConnectionId):ConnectionConfig {return {mode:'cli',enabled:id!=='claude',baseUrl:connectionDefinition(id).baseUrl,model:'default',cliPath:'',hasKey:false,models:[]};}
export function connectionReadyForFilm(view:ConnectionView){return view.enabled&&view.connected&&view.cliInstalled&&view.heavySupported;}
