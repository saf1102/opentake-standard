import fs from 'node:fs';
import path from 'node:path';
import {Agent} from '@earendil-works/pi-agent-core';
import {streamSimple as chat} from '@earendil-works/pi-ai/api/openai-completions';
import {streamSimple as responses} from '@earendil-works/pi-ai/api/openai-responses';
import {streamSimple as anthropic} from '@earendil-works/pi-ai/api/anthropic-messages';
import {createReadToolDefinition, createWriteToolDefinition, createBashToolDefinition, createPowerShellToolDefinition} from '@earendil-works/pi-coding-agent';

const protocols = {
  chat: ['openai-completions',chat], responses:['openai-responses',responses], anthropic:['anthropic-messages',anthropic],
};

// Resolve ancestors one by one. A dangling link must not become a way to create an outside file.
function checkedPath(root, file) {
  const absolute = path.resolve(root,file);
  const rel = path.relative(root,absolute);
  if (rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)) throw Error('工程范围外的路径');
  let current = root;
  for (const part of rel.split(path.sep).filter(Boolean)) {
    current = path.join(current,part);
    if (fs.lstatSync(current,{throwIfNoEntry:false})?.isSymbolicLink()) {
      const target = fs.realpathSync(current);
      const targetRel = path.relative(root,target);
      if (targetRel === '..' || targetRel.startsWith('..'+path.sep) || path.isAbsolute(targetRel)) throw Error('链接指向工程之外');
    }
  }
  return absolute;
}

function projectPrompt(root) {
  return ['你是 OpenTake 的视频剪辑智能体。按照用户的出片任务和工程工作流执行，完成后检查实际文件与画面。只处理本工程中授权的素材、工具和产物。',projectInstructions(root)].join('\n\n');
}
function projectInstructions(root) {
  const instructions = [];
  for (const name of ['AGENTS.md','CLAUDE.md']) {
    const file = checkedPath(root,name), stat = fs.statSync(file,{throwIfNoEntry:false});
    if (stat?.isFile() && stat.size <= 256*1024) instructions.push(name+'\n'+fs.readFileSync(file,'utf8'));
  }
  return instructions.join('\n\n');
}

function projectTools(root,cwd) {
  const file = value => checkedPath(root,value);
  const read = createReadToolDefinition(cwd,{autoResizeImages:false,operations:{
    access: async p => fs.promises.access(file(p)),
    readFile: async p => {
      const source = file(p), stat = await fs.promises.stat(source);
      if (!stat.isFile() || stat.size > 16*1024*1024) throw Error('请选择小于 16 MB 的文本或画面截图');
      return fs.promises.readFile(source);
    },
    detectImageMimeType:async p => ({'.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png','.webp':'image/webp','.gif':'image/gif'})[path.extname(file(p)).toLowerCase()],
  }});
  const write = createWriteToolDefinition(cwd,{operations:{
    mkdir: async p => fs.promises.mkdir(file(p),{recursive:true}),
    writeFile: async (p,content) => fs.promises.writeFile(file(p),content,'utf8'),
  }});
  // Do not expose Pi or provider environment variables to command tools. Keep the
  // media runtime paths supplied by the host so the project's own render scripts work.
  const shellVariables = new Set([
    'PATH','PATHEXT','SYSTEMROOT','WINDIR','COMSPEC','TMP','TEMP','TMPDIR','TMPPREFIX','LANG','LC_ALL','HOME','USERPROFILE','ZDOTDIR',
    'CW_WORK','CW_MEDIA','CW_KIT','CW_BIN','CW_FFMPEG','CW_FFPROBE','CW_CHROME','CW_HFX_CHROME','CW_PYTHON','CW_NODE_MODULES',
    'CW_FONT_MANIFEST_SHA256','CW_FONT_DIRS','CW_ICONS_DIR','CW_NETWORK','CW_STYLE','PLAYWRIGHT_CHROMIUM_EXECUTABLE',
    'PYTHONUTF8','PYTHONIOENCODING','PYTHONPATH','PYTHONDONTWRITEBYTECODE','PYTHONNOUSERSITE','PYTHONPYCACHEPREFIX',
    'LINKREADER_PYTHON','LINKREADER_BIN_DIR','OPENTAKE_PYTHON','OPENTAKE_FFMPEG','OPENTAKE_FFPROBE',
    'NPM_CONFIG_OFFLINE','NPM_CONFIG_REGISTRY','NPM_CONFIG_AUDIT','NPM_CONFIG_FUND','YARN_ENABLE_NETWORK','YARN_NPM_REGISTRY_SERVER',
    'BUN_CONFIG_REGISTRY','PIP_NO_INDEX','PIP_INDEX_URL','PIP_DISABLE_PIP_VERSION_CHECK','UV_OFFLINE','UV_INDEX_URL',
    'CARGO_NET_OFFLINE','GOPROXY','GOFLAGS','GEM_HOST','HOMEBREW_NO_AUTO_UPDATE','HOMEBREW_NO_INSTALL_FROM_API',
    'GIT_ALLOW_PROTOCOL','GIT_TERMINAL_PROMPT','HF_HUB_OFFLINE','TRANSFORMERS_OFFLINE',
  ]);
  // Use the host's PATH exactly. Pi otherwise prepends its own bin directory ahead of the project wrappers.
  const env=Object.fromEntries(Object.entries(process.env).filter(([name])=>shellVariables.has(name.toUpperCase())));
  const shellOptions={exposeSessionEnvironment:false,spawnHook:context=>({...context,env})};
  const shell = process.platform === 'win32' ? createPowerShellToolDefinition(cwd,shellOptions) : createBashToolDefinition(cwd,shellOptions);
  return [read,write,shell];
}
export async function createEditorAgent(config,cwd,root,permission,update) {
  checkedPath(root,cwd);
  const spec = Object.hasOwn(protocols,config.protocol) && protocols[config.protocol];
  if (!spec || !config.key || !config.id || !config.baseUrl) throw Error('请先配置接口、密钥和模型');
  const [api,stream] = spec;
  const model = {api,id:config.id,name:config.id,provider:'opentake',baseUrl:config.baseUrl,
    input:['text','image'],reasoning:false,contextWindow:128000,maxTokens:8192,
    cost:{input:0,output:0,cacheRead:0,cacheWrite:0}};
  const agent = new Agent({
    initialState:{systemPrompt:projectPrompt(root) + (cwd === root ? '' : '\n\n' + projectInstructions(cwd)),model,tools:projectTools(root,cwd),thinkingLevel:'off'},
    streamFn:(m,ctx,opts) => stream(m,ctx,{...opts,apiKey:config.key,maxRetries:0,fetch:(url,init)=>fetch(url,{...init,redirect:'error'})}),
    toolExecution:'sequential',
    beforeToolCall:async ({toolCall,args},signal) => {
      const isFile = ['read','write'].includes(toolCall.name);
      // Pi accepts special path spellings. Give the SDK and the permission host the same absolute path.
      const rawInput = isFile ? {path:checkedPath(root,path.resolve(cwd,args.path))} : {cwd,command:args.command};
      if (isFile) args.path = rawInput.path;
      const tool = {toolCallId:toolCall.id,title:toolCall.name,kind:isFile ? (toolCall.name === 'read'?'read':'edit'):'execute',rawInput};
      update({...tool,sessionUpdate:'tool_call',status:'pending'});
      if (!await permission(tool,signal)) return {block:true,reason:'工程权限检查拒绝了这次操作'};
    },
  });
  let failure, usage, cancelled = false;
  agent.subscribe(event => {
    if (event.type === 'message_end' && event.message.role === 'assistant') {
      const msg = event.message;
      if (msg.stopReason === 'error') failure = msg.errorMessage || '模型请求失败';
      if (msg.stopReason === 'length') failure = '模型输出达到长度上限，未完成本次任务';
      if (msg.stopReason === 'aborted') cancelled = true;
      for(const block of msg.content) if(block.type === 'text' && block.text)
        update({sessionUpdate:'agent_message_chunk',content:{type:'text',text:block.text}});
      usage.inputTokens += msg.usage.input;
      usage.outputTokens += msg.usage.output;
      usage.cachedReadTokens += msg.usage.cacheRead;
    }
    if (event.type === 'tool_execution_end')
      update({sessionUpdate:'tool_call_update',toolCallId:event.toolCallId,status:event.isError?'failed':'completed'});
  });
  return {
    abort:()=>agent.abort(),
    async prompt(text,images) {
      failure = undefined; cancelled = false; usage = {inputTokens:0,outputTokens:0,cachedReadTokens:0};
      await agent.prompt(text,images);
      if (failure || agent.state.errorMessage) throw Error(failure || agent.state.errorMessage);
      return {stopReason:cancelled?'cancelled':'end_turn',usage};
    },
  };
}
