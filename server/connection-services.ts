/** Standard 不包含 Pro 的视频生成与配音服务；共用接入核心只通过这三个装配钩子访问。 */
import type {ConnectionId} from '../shared/agent-connections.ts';
export function serviceCliPath(_id:ConnectionId):string|undefined{return undefined;}
export function saveServiceCliPath(_id:ConnectionId,_cliPath:string){}
export async function testServiceCli(_id:ConnectionId):Promise<string>{throw Error('标准版不提供此服务');}
