import {CreationEnvironment} from '../general/CreationEnvironment';
import {AboutUpdate} from '../standard/ClientUpdate';
import {ConnectionList} from '../studio/components/ConnectionSettings';
import {AgentInstallation} from '../studio/components/AgentInstallation';
import {IS_MAC} from '../general/platform';
import pkg from '../../package.json';
export const settingsGroups=['general','agents','models','storage','export','backup','about'];
export function AgentRoster(props:{onDirtyChange?:(value:boolean)=>void;onBusyChange?:(value:boolean)=>void}={}){return IS_MAC?<ConnectionList {...props}/>:<section className="agent-roster"><h2>已接入的 Agent</h2><p className="agent-roster-intro">按运行工作台服务的这台电脑检测。Codex 接入后，可在「工作模块的模型」里选择模型。</p><div className="agent-roster-list"><AgentInstallation kind="codex" {...props} use={<>用于 <b>工作模块</b>（见「工作模块的模型」）</>}/></div></section>}

export function EnhancedAgentSettings(){return null}
export function IntegrationSettings(){return null}
export function PublishDirSetting(){return null}
export function ProjectMigration(_props:{defaultTarget:string;disabled:boolean;onChanged:()=>void}){return null}
export function StandardAbout({environment=true}:{environment?:boolean}={}){return <><AboutUpdate/>{environment&&<CreationEnvironment/>}<section><h3>OpenTake Standard</h3><p>版本 {pkg.version}</p><p>通用剪辑与录屏运镜，开源创作工作台。</p><p>只有升级查询与主动申请时联网。申请收集名字、联系方式、用途和密码摘要；网络地址用于防刷并在 90 天后清理。会话保存在用户数据目录，不在工程里。</p><p>代码采用 AGPL-3.0。OpenTake 名字和 T 图标不随代码授权。</p><a href="/NOTICE" target="_blank" rel="noreferrer">开源许可与第三方署名</a></section></>}
export function DesktopSettings({section}:{section?:string}){return section==='about'?<StandardAbout environment={false}/>:null}
