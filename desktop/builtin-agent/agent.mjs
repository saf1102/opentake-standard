// ACP stdio peer for one OpenTake job. No CLI discovery, account login or global Pi resources.
import {createInterface} from 'node:readline';
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {createEditorAgent} from './engine.mjs';

const model = process.env.OPENTAKE_BUILTIN_MODEL;
const key = process.env.OPENTAKE_BUILTIN_KEY;
delete process.env.OPENTAKE_BUILTIN_KEY;
const config = {id:model, key, baseUrl:process.env.OPENTAKE_BUILTIN_BASE_URL, protocol:process.env.OPENTAKE_BUILTIN_PROTOCOL};
const write = value => process.stdout.write(JSON.stringify({jsonrpc:'2.0', ...value}) + '\n');
let session, agent, sequence = 0, active = false;
const pending = new Map();

function permission(toolCall, signal) {
  if (signal?.aborted) return false;
  const id = 'permission-' + ++sequence;
  const options = [{optionId:'once',kind:'allow_once',name:'允许本次'}, {optionId:'deny',kind:'reject_once',name:'拒绝'}];
  return new Promise(resolve => {
    const finish = allowed => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', cancel);
      pending.delete(id);
      resolve(allowed);
    };
    const cancel = () => finish(false);
    const timer = setTimeout(cancel, 30000);
    pending.set(id, reply => finish(reply.result?.outcome?.outcome === 'selected' && reply.result.outcome.optionId === 'once'));
    signal?.addEventListener('abort', cancel, {once:true});
    write({id,method:'session/request_permission',params:{sessionId:session, toolCall, options}});
  });
}

async function request(method, params) {
  if (method === 'initialize') return {protocolVersion:1,agentCapabilities:{},agentInfo:{name:'opentake-builtin',version:'1'}};
  if (method === 'session/new') {
    if (session || !path.isAbsolute(params.cwd) || fs.realpathSync(params.cwd) !== fs.realpathSync(process.cwd())) throw Error('工程目录无效');
    const data = process.env.PI_CODING_AGENT_DIR;
    if (!data || !path.isAbsolute(data)) throw Error('缺少内置智能体数据目录');
    fs.mkdirSync(data,{recursive:true,mode:0o700});
    session = randomUUID();
    const update = update => write({method:'session/update',params:{sessionId:session,update}});
    agent = await createEditorAgent(config, fs.realpathSync(params.cwd), fs.realpathSync(params.projectRoot || params.cwd), permission, update);
    return {sessionId:session,models:{currentModelId:model,availableModels:[{modelId:model,name:model}]}};
  }
  if (!agent || params.sessionId !== session) throw Error('会话无效');
  if (method === 'session/set_model' && params.modelId === model) return {};
  if (method === 'session/cancel') { agent.abort(); return {}; }
  if (method !== 'session/prompt' || active) throw Error('当前请求不可用');
  active = true;
  try {
    const prompt = params.prompt.filter(item => item.type === 'text').map(item => item.text).join('\n');
    if (!prompt) throw Error('缺少出片指令');
    const images = params.prompt.filter(item => item.type === 'image');
    for (const item of images) if (!['image/png','image/jpeg','image/webp','image/gif'].includes(item.mimeType) || typeof item.data !== 'string')
      throw Error('参考图片格式无效');
    return await agent.prompt(prompt,images);
  } finally { active = false; }
}
async function receive(msg) {
  if (msg.jsonrpc !== '2.0') return;
  if (!msg.method) { pending.get(msg.id)?.(msg); return; }
  try {
    const result = await request(msg.method,msg.params ?? {});
    if (msg.id !== undefined) write({id:msg.id,result});
  } catch (error) {
    const message = String(error?.message || '内置智能体请求失败');
    if (msg.id !== undefined) write({id:msg.id,error:{code:-32603,message:key ? message.replaceAll(key,'[已隐藏密钥]') : message}});
  }
}
const input = createInterface({input:process.stdin,crlfDelay:Infinity});
input.on('line', line => { try { void receive(JSON.parse(line)); } catch { /* ignore incomplete request */ } });
input.once('close', () => { agent?.abort(); for(const reply of [...pending.values()]) reply({}); });
