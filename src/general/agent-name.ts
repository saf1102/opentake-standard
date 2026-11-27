import { connectionDefinition } from '@/studio/connections'

/** 界面上称呼正在干活的智能体：用它的短名（「内置智能体 · 用自己的密钥」取「内置智能体」）；不知道是哪家时写「智能体」。 */
export function agentShortName(id?: string): string {
  if (!id) return '智能体'
  try { return connectionDefinition(id as Parameters<typeof connectionDefinition>[0]).name.split(' · ')[0] || '智能体' } catch { return '智能体' }
}
