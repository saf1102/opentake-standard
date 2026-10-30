import {IS_MAC} from '../../general/platform';
import {AgentPicker as UnifiedAgentPicker} from './AgentPicker';
export function AgentPicker(props:Parameters<typeof UnifiedAgentPicker>[0]){return IS_MAC?<UnifiedAgentPicker {...props}/>:<span className="agent-picker" aria-label={`${props.work}使用的 Agent：Codex`}>Codex</span>}
export function VoiceSettings(){return null}
export const modelsDescription=IS_MAC?'通用剪辑与录屏共用已接通的智能体，每个工程还能单独选择。':'使用你自己的 Codex。检测安装、选择程序路径，并测试当前工作模块所选的模型连接。';
export const testAllCatalogModels=false;
