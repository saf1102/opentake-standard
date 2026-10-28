import {chromePath} from '../general/kit-env.ts';
export function motionBrowserExecutable(){return chromePath();}
export function motionBrowserOptions(){return {browserExecutable:chromePath(),chromeMode:'headless-shell' as const};}
