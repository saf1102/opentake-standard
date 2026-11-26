import type {ConnectionModel} from '../shared/agent-connections.ts';

export type DeepseekProvider='deepseek-official'|'deepseek-account';
export const deepseekLoginHint='请在 DeepSeek Harness 桌面版里登录账号，或在这里填 DeepSeek API 密钥。';
export const deepseekInvalidKeyHint='DeepSeek 说这个 API 密钥无效，请到 platform.deepseek.com 重新创建。';
export const deepseekModelHint='所选模型不在 DeepSeek Harness 当前接入方式的可用列表中，请重新选择模型。';
export const deepseekSwitchHint='DeepSeek Harness 未确认模型切换，请重新检查接入。';

type Option={id?:unknown;type?:unknown;category?:unknown;name?:unknown;value?:unknown;currentValue?:unknown;options?:unknown};
type Route={configId:string;value:string;model:string;current:boolean;models:ConnectionModel[]};
const option=(value:unknown):Option=>value&&typeof value==='object'?value:{};

/** dsh packs its provider and model in a JSON string. Send that exact wire value back. */
export function deepseekHarnessRoute(configOptions:unknown,provider:DeepseekProvider,requestedModel='default'):Route|undefined {
 if(!Array.isArray(configOptions))return;
 const config=configOptions.map(option).find(item=>(item.id==='model'||item.category==='model')&&item.type==='select');
 if(!config||typeof config.id!=='string'||!Array.isArray(config.options))return;
 const entries=config.options.map(option).flatMap(item=>Array.isArray(item.options)?item.options.map(option):[item]);
 const candidates=new Map<string,{value:string;model:string;name:string}>();
 for(const entry of entries){
  if(typeof entry.value!=='string'||entry.value.length>1024)continue;
  let pair:unknown;
  try{pair=JSON.parse(entry.value)}catch{continue}
  if(!Array.isArray(pair)||pair.length!==2||pair[0]!==provider||typeof pair[1]!=='string'||!/^[\w./:,-]{1,180}$/.test(pair[1]))continue;
  const model=pair[1];
  if(candidates.has(model)&&entry.value!==config.currentValue)continue;
  const name=typeof entry.name==='string'?entry.name.replace(/[\r\n\0]/g,' ').trim().slice(0,100):'';
  candidates.set(model,{model,value:entry.value,name:name||model});
 }
 if(!candidates.size)return;
 const all=[...candidates.values()],preferred=all.find(item=>item.value===config.currentValue)??all[0];
 const chosen=requestedModel==='default'?preferred:candidates.get(requestedModel);
 if(!chosen)throw Error(deepseekModelHint);
 return {configId:config.id,value:chosen.value,model:chosen.model,current:chosen.value===config.currentValue,
  models:all.map(item=>({id:item.model,name:item.name,isDefault:item===preferred}))};
}

const errorText=(error:unknown)=>error instanceof Error?error.message:typeof error==='string'?error:JSON.stringify(error)||'';

export function deepseekNoKey(error:unknown){
 return /no API key for provider route ['"]?deepseek-official\b/i.test(errorText(error));
}
export function deepseekKeyRejected(error:unknown){
 const text=errorText(error);
 return /\b401\b|invalid[_ -](?:api[_ -]?)?key|(?:your\s+)?api[_ -]?key\b[^\r\n]{0,160}?\bis invalid\b/i.test(text);
}

export function deepseekAccountRejected(error:unknown){
 const text=errorText(error);
 return /\b401\b|auth_required|authentication[_ -](?:required|fail)|not (?:logged in|authenticated)|login required|未登录|请.{0,12}登录/i.test(text);
}

export const deepseekFallbackHint=deepseekInvalidKeyHint+'已改用桌面版账号。';
export const deepseekBothRejectedHint=deepseekInvalidKeyHint+deepseekLoginHint;
export const deepseekPartialTurnHint=deepseekInvalidKeyHint+'本轮已产生输出或工具操作，请检查工程进度后再继续。';

// Some dsh versions deliver a provider error as the entire assistant reply.
const authReplyPrefixes=['authentication fails','invalid api key','no api key for provider route','not logged in','authentication required','login required','please log in','未登录','请先登录','401','http 401','error:'];
export function possibleDeepseekAuthReply(text:string){
 const start=text.trimStart().toLowerCase();
 return start.length<=768&&authReplyPrefixes.some(prefix=>prefix.startsWith(start)||start.startsWith(prefix));
}
export function deepseekAuthReply(text:string):'invalid-key'|'missing-key'|'login'|'unauthorized'|undefined {
 if(!text||text.length>768)return;
 if(/^(?:error:\s*)?(?:http\s+)?401(?:\s*[:,-]?\s*(?:unauthorized|authentication failed))?[.!]?$/i.test(text.trim()))return 'unauthorized';
 const message=text.trim().replace(/^error:\s*/i,'').replace(/^(?:HTTP\s+)?401(?:\s*[:,-]\s*|\s+)/i,'').trim();
 if(/^(?:authentication fails?[,.:]?\s+)?(?:your\s+)?api\s+key\s+[^\s]{1,160}\s+is invalid[.!]?$/i.test(message)||/^invalid api key[.!]?$/i.test(message))return 'invalid-key';
 if(/^no api key for provider route ['"]?deepseek-official['"]?[.!]?$/i.test(message))return 'missing-key';
 if(/^(?:not logged in|authentication required|login required|please log in|未登录|请先登录)[.!。]?$/i.test(message))return 'login';
}
