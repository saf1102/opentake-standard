// 纯版本配置：不得导入组件、hook 或部署状态库，避免首屏 ESM 循环初始化。
import {IS_MAC} from '../general/platform';
export const DEPLOY_ITEMS=[{id:'agent',title:IS_MAC?'智能体 · 至少要有一个':'Codex'},{id:'disk',title:'工程文件夹'},{id:'openscreen',title:'OpenScreen 录屏',optional:true}] as const;

export const deployDescription=IS_MAC?'自动检查智能体、工程文件夹和 OpenScreen。缺什么，点一下就补上。':'检查 Codex、工程文件夹和 OpenScreen。缺什么，点一下就补上。';
export const pendingAgents=IS_MAC?['codex','claude','kimi','deepseek','minimax','codebuddy','copilot','cursor','opencode','qwen'] as const:['codex'] as const;
