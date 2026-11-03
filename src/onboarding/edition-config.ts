// 纯版本配置：不得导入组件、hook 或部署状态库，避免首屏 ESM 循环初始化。
import {UNIFIED_AGENTS} from '../general/platform';
export const DEPLOY_ITEMS=[{id:'agent',title:UNIFIED_AGENTS?'智能体 · 至少要有一个':'Codex'},{id:'disk',title:'工程文件夹'},{id:'openscreen',title:'OpenScreen 录屏',optional:true}] as const;

export const deployDescription=UNIFIED_AGENTS?'自动检查智能体、工程文件夹和 OpenScreen。缺什么，点一下就补上。':'检查 Codex、工程文件夹和 OpenScreen。缺什么，点一下就补上。';
export const pendingAgents=UNIFIED_AGENTS?['codex','claude','kimi','deepseek','minimax','codebuddy','copilot','cursor','opencode','qwen'] as const:['codex'] as const;
