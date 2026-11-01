import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import distribution from './distribution.cjs';
import {prepareRuntimeManifest} from './prepare-runtimes.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
if(process.platform!=='win32'||process.arch!=='x64')throw Error('此安装器仅用于 Windows x64；本轮验收系统为 Win11。');
await prepareRuntimeManifest(root);
const result=spawnSync(process.execPath,['node_modules/electron-builder/cli.js','--config','desktop/installer.builder.config.cjs','--win','nsis','--x64','--publish','never'],
 {cwd:root,stdio:'inherit',env:distribution.unsignedBuildEnvironment(process.env)});
if(result.error)throw result.error;
if(result.status!==0)throw Error(`Windows 安装器构建失败（${result.status}）。`);
console.log('OpenTake Standard Windows 完整离线安装器已生成；未签名、未发布。');
