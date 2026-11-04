import type {SpawnOptions, ExecFileOptions} from 'node:child_process';
declare const launcher: {
 agentLaunch<T extends SpawnOptions | ExecFileOptions>(file: string, args?: readonly string[], options?: T, platform?: NodeJS.Platform): {file:string;args:string[];options:T & {shell:false;windowsVerbatimArguments?:boolean;env?:NodeJS.ProcessEnv}};
 quoteArgument(value:string):string;
};
export = launcher;
