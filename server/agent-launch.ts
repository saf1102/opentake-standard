import {spawn, type SpawnOptions} from 'node:child_process';
import {createRequire} from 'node:module';
const launcher = createRequire(import.meta.url)('../desktop/agent-launch.cjs') as typeof import('../desktop/agent-launch.cjs');
export const agentLaunch = launcher.agentLaunch;
export const quoteAgentArgument = launcher.quoteArgument;
/** All agent subprocesses use the same Windows batch boundary. */
export const spawnAgentProcess: typeof spawn = ((file: string, args: string[] = [], options: SpawnOptions = {}) => {
 const launch = agentLaunch(file, args, options);
 return spawn(launch.file, launch.args, launch.options);
}) as typeof spawn;
