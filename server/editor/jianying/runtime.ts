import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {runExportTool} from '../../export-diagnostics.ts';
import {execFileSync} from 'node:child_process';
export function jianyingRuntime() {
 const windows=process.platform==='win32';
 const python=windows?process.env.OPENTAKE_JIANYING_PYTHON:path.join(os.homedir(),'Library','Application Support','LinkReader','jianying-runtime-0.3.0','bin','python');
 const packages=windows?process.env.OPENTAKE_JIANYING_PACKAGES:undefined;
 if(!python||!fs.existsSync(python)||windows&&(!packages||!fs.existsSync(path.join(packages,'pyJianYingDraft','__init__.py'))))
  throw Object.assign(Error(windows?'剪映草稿生成组件缺失，请重新安装完整 OpenTake Windows 包；安装剪映不会补齐此组件。':'缺少本机剪映导出组件，请先安装离线组件'),{status:503});
 return {python,packages};
}
export async function requireJianyingRuntime(signal?:AbortSignal) {
 const runtime=jianyingRuntime();
 try{await runExportTool(runtime.python,['-I','-X','utf8',fileURLToPath(new URL('./runtime-check.py',import.meta.url)),runtime.packages||''],{timeout:20000,maxBuffer:2<<20,signal});}
 catch(error){throw Object.assign(Error(`剪映草稿组件预检失败，尚未开始渲染：${error instanceof Error?error.message:error}`),{status:503})}
 return runtime;
}
/** The existing screen-export reservation API is synchronous. Validate before reserving output. */
export function requireJianyingRuntimeSync() {
 const runtime=jianyingRuntime();
 try{execFileSync(runtime.python,['-I','-X','utf8',fileURLToPath(new URL('./runtime-check.py',import.meta.url)),runtime.packages||''],{timeout:20000,maxBuffer:2<<20,windowsHide:true,encoding:'utf8'});}
 catch(error){throw Object.assign(Error(`剪映草稿组件预检失败，尚未开始渲染：${error instanceof Error?error.message:error}`),{status:503})}
 return runtime;
}
export async function jianyingCapabilities() {
 try{await requireJianyingRuntime();return {available:false,draftBuilderReady:true,warning:process.platform==='win32'?'草稿组件已就绪。导出后保存并退出剪映，运行文件夹中的「导入剪映-Windows.cmd」。':'草稿组件已就绪，导出后使用随包导入脚本。'}}
 catch(error){return {available:false,draftBuilderReady:false,warning:error instanceof Error?error.message:String(error)}}
}
