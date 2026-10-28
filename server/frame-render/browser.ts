import {renderArgs} from '../../shared/browser-launch.cjs';
import {VideoFrames} from './decode.ts';
import {chromium,type Browser} from 'playwright-core';import {motionBrowserExecutable} from '../editor/motion-browser.ts';import {createMotionCaptureQueue} from '../editor/motion-capture.ts';
export type HeadlessBrowser={browser:Browser;decoder:VideoFrames;capture:ReturnType<typeof createMotionCaptureQueue>;onRecovered?:()=>void;close:(options?:{silent?:boolean})=>Promise<void>};
export type BrowserOptions={browserExecutable?:string;chromeMode?:string;chromiumOptions?:{gl?:string};logLevel?:string};
export async function openBrowser(_kind='chrome',options:BrowserOptions={}):Promise<HeadlessBrowser>{const browser=await chromium.launch({executablePath:options.browserExecutable||motionBrowserExecutable(),headless:true,args:renderArgs(options.chromiumOptions?.gl||'angle'),timeout:30000});const decoder=new VideoFrames();return {browser,decoder,capture:createMotionCaptureQueue(),close:async()=>{decoder.close();await browser.close();}};}
