import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import distribution from './distribution.cjs';
import {prepareRuntimeManifest} from './prepare-runtimes.mjs';
import windowsSource from './windows-source.cjs';
import release from './release-contract.cjs';
import {prepareWindowsRuntimes} from '../scripts/prepare-windows-runtimes.mjs';
import runtimePaths from './runtime-paths.cjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
if(process.platform==='darwin'){
 const {buildMacInstaller}=await import('./build-mac-installer.mjs');
 await buildMacInstaller(root);
}else{
if(process.platform!=='win32'||process.arch!=='x64')throw Error('此安装器仅用于 Windows x64。');
await prepareWindowsRuntimes({root:runtimePaths.windowsRuntimeRoot(root)});
windowsSource.writeWindowsSourceReceipt(root);
await prepareRuntimeManifest(root);
const result=spawnSync(process.execPath,['node_modules/electron-builder/cli.js','--config','desktop/installer.builder.config.cjs','--win','nsis','--x64','--publish','never'],
 {cwd:root,stdio:'inherit',env:distribution.unsignedBuildEnvironment(process.env)});
if(result.error)throw result.error;
if(result.status!==0)throw Error(`Windows 安装器构建失败（${result.status}）。`);
const version=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).version;
await release.writeInstallerReceipt(root,path.join(root,`release/windows/OpenTake-Standard-Setup-${version}-x64.exe`),'win32','x64');
console.log('OpenTake Standard Windows 完整离线安装器已生成；未签名、未发布。');
}
