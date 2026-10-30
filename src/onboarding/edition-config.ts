// 纯版本配置：不得导入组件、hook 或部署状态库，避免首屏 ESM 循环初始化。
export const DEPLOY_ITEMS=[{id:'agent',title:'Codex'},{id:'disk',title:'工程文件夹'},{id:'openscreen',title:'OpenScreen 录屏',optional:true}] as const;

export const deployDescription='检查 Codex、工程文件夹和 OpenScreen。缺什么，点一下就补上。';
export const pendingAgents=['codex'] as const;
