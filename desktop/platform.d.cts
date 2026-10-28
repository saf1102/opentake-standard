declare const platform: {
 appDataRoot(platform?:string,env?:NodeJS.ProcessEnv,home?:string):string;
 standardDataRoot():string;projectsRoot():string;
 killTree(pid:number,signal?:NodeJS.Signals):void;
 revealCommand(target:string,platform?:string):{command:string;args:string[]};
 buildTarget(platform?:string,arch?:string,release?:string):string;
};
export = platform;
