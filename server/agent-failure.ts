// 智能体失败原因的分类。接通检查（一句话测试）和出片共用，避免两处判断不一致。
import {deepseekBothRejectedHint,deepseekInvalidKeyHint,deepseekLoginHint,deepseekModelHint,deepseekPartialTurnHint,deepseekSwitchHint} from './deepseek-harness.ts';
import {connectionDefinition, CONNECTION_DEFINITIONS, type AgentConnectionId} from '../shared/agent-connections.ts';
import type {GeneralAgentErrorKind} from '../src/general/general-contract.ts';

/** Account identifiers and secrets never belong in user-visible errors or diagnostic excerpts. */
export function redactAcpText(value:string):string {
 return value.replace(/\bBearer\s+\S+/gi,'Bearer [已隐藏]')
  .replace(/\b(?:sk|sess|token|key)-[\w-]+/gi,'[已隐藏]')
  .replace(/((?:api[_ -]?key|access[_ -]?token|refresh[_ -]?token|token|authorization|password|secret|account(?:[_ -]?id)?|user[_ -]?id|email)["']?\s*[=:]\s*["']?)[^\s,"';}]+/gi,'$1[已隐藏]')
  .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g,'[已隐藏邮箱]')
  .replace(/https?:\/\/[^\s"']+/g,'[已隐藏地址]');
}
export type AgentFailure={kind:GeneralAgentErrorKind;message:string;excerpt:string};
export function noAgentResponse(agent:AgentConnectionId):AgentFailure {
 const name=connectionDefinition(agent).name;
 return {kind:'no-response',message:`${name}没有回应。常见原因是套餐不含这项服务或额度用完，请到${name}官网确认。`,excerpt:''};
}
export function classifyAgentFailure(error:unknown):AgentFailure {
 const text=(error instanceof Error?error.message:typeof error==='string'?error:JSON.stringify(error))||'';
 for(const message of [deepseekBothRejectedHint,deepseekPartialTurnHint,deepseekInvalidKeyHint,deepseekLoginHint,deepseekModelHint,deepseekSwitchHint]){
  if(text.trim()===message)return {kind:message===deepseekModelHint||message===deepseekSwitchHint?'other':'credentials',message,excerpt:message};
 }
 // A possible cause in the fixed no-response explanation must not be reclassified as confirmed quota/plan failure.
 const silent=CONNECTION_DEFINITIONS.find(agent=>agent.kind==='agent'&&text.startsWith(`${agent.name}没有回应`));
 if(silent)return noAgentResponse(silent.id as AgentConnectionId);
 const excerpt=redactAcpText(text||'').replace(/\s+/g,' ').slice(0,240);
 // 内置智能体自己写的中文原因已经可读，直接给用户看，不要换成笼统的「本轮未完成」。
 const builtin=/模型一次要写的内容太长，被服务商截断[^\n]*/.exec(text)?.[0];
 if(builtin)return {kind:'other',message:builtin,excerpt};
 // Explicit exhausted-quota codes override HTTP 429; a bare 429 is only transient throttling.
 const kind:AgentFailure['kind']=/insufficient_quota|quota.{0,25}(?:exhaust|exceed)|(?:credit|balance).{0,25}(?:insufficient|exhaust|deplet)|(?:额度|余额).{0,12}(?:不足|耗尽|用完)|payment_required|\b402\b/i.test(text)?'quota'
  :/(?:subscription|plan).{0,50}(?:not include|does not include|not support|not cover|(?:does not|doesn't|do not) have access|no access)|upgrade (?:your )?(?:plan|subscription)|(?:model).{0,40}(?:not available.{0,20}(?:plan|subscription))|(?:订阅|套餐).{0,20}(?:不含|不包含|不支持|无权)|model_not_allowed/i.test(text)?'model-plan'
  :/auth_required|authentication[_ ]required|missing.{0,15}(?:key|credential|token)|invalid[_ ](?:api[_ ]?key|credential)|(?:缺少|未配置|无效|过期).{0,12}(?:密钥|凭据)|(?:密钥|凭据).{0,12}(?:缺失|未配置|过期)|not (?:logged in|authenticated)|\b401\b/i.test(text)?'credentials'
  :/at[ _-]+capacity|overload(?:ed)?|(?:模型|服务).{0,12}(?:繁忙|忙碌)|(?:繁忙|忙碌).{0,12}模型/i.test(text)?'busy'
  :/\b429\b|rate[_ -]?limit|too many requests|请求过于频繁/i.test(text)?'rate-limit':'other';
 const message={quota:'智能体额度或余额已用完，请到该服务商补充额度，或选择其他已接通的智能体。',credentials:'智能体缺少有效登录凭据，请在设置中重新登录或补充 API 密钥。','model-plan':'当前订阅套餐不包含这项服务或所选模型。请到服务商升级套餐，或在设置里改用 API 密钥、内置智能体。','rate-limit':'智能体暂时限流，请稍后重试。',busy:'这个模型现在繁忙，可以稍后重试或换个模型/智能体',other:'智能体本轮未完成，请查看运行记录并重试。'}[kind];
 return {kind,message,excerpt};
}
