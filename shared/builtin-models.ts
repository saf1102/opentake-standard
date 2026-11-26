export type BuiltinProtocol = 'auto' | 'chat' | 'responses' | 'anthropic';

// 官方接口与视觉模型核对日期 2026-11-20。每项链接对应服务商示例。
export const builtinPresets = [
  {name:'DeepSeek', baseUrl:'https://api.deepseek.com', model:'deepseek-flash', source:'https://api-docs.deepseek.com/guides/vision/'},
  {name:'Kimi（月之暗面）', baseUrl:'https://api.moonshot.cn/v1', model:'kimi-k3.1-pro', source:'https://platform.kimi.com/docs/guide/kimi-k3-1-pro-quickstart.md'},
  {name:'通义千问（百炼）', baseUrl:'https://dashscope.aliyuncs.com/compatible-mode/v1', model:'qwen3-vl-plus', source:'https://help.aliyun.com/zh/model-studio/qwen-api-via-openai-chat-completions/'},
  {name:'豆包（火山方舟）', baseUrl:'https://ark.cn-beijing.volces.com/api/v3', model:'doubao-seed-2-0-pro-260215', source:'https://console.volcengine.com/ark/region:cn-beijing/docs/model-release-announcement'},
  {name:'MiniMax', baseUrl:'https://api.minimax.cn/v1', model:'MiniMax-M3', source:'https://platform.minimax.cn/docs/api-reference/text-openai-api'},
  {name:'智谱', baseUrl:'https://open.bigmodel.cn/api/paas/v4', model:'glm-4.6v', source:'https://docs.bigmodel.cn/cn/guide/models/vlm/glm-4.6v'},
] as const;
export function builtinSupportsModule(module:string|undefined){return ['generalEditing','screenEditing','captionTranslation'].includes(module??'');}
export function builtinProtocol(address:string, format:BuiltinProtocol='auto'):Exclude<BuiltinProtocol,'auto'> {
  if(format!=='auto')return format;
  try {
    const url=new URL(address.includes('://')?address:'https://'+address);
    if(/\/(anthropic|messages)(\/|$)/i.test(url.pathname)||url.hostname==='api.anthropic.com') return 'anthropic';
    if(/\/chat\/completions\/?$/i.test(url.pathname))return 'chat';
    if(/\/responses\/?$/i.test(url.pathname)||url.hostname==='api.openai.com')return 'responses';
  }catch{/* 保存时验证地址。 */}
  return 'chat';
}
