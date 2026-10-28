import {createRequire} from 'node:module';
import {resolveCliPath} from '../agent-settings.ts';
import type {CreationTools,EnvironmentCheck} from '../../shared/creation-tools.ts';
const checker = createRequire(import.meta.url)('../../desktop/creation-tools.cjs') as {doctor:(options:{codexPath:()=>string})=>Promise<EnvironmentCheck>};
export const checkCreationEnvironment = () => checker.doctor({codexPath:()=>resolveCliPath()});
export async function requireCreationTools():Promise<CreationTools> {
 const result = await checkCreationEnvironment();
 if(!result.ok || !result.tools) throw Object.assign(Error(result.items.filter(i=>!i.ok).map(i=>`${i.label}：${i.message}\n${i.install}`).join('\n\n')),{status:412,environment:result});
 return result.tools;
}
