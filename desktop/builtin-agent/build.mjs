// Build a platform-independent Node/Electron entry from the locked Pi SDK modules.
// Only the four official tool definitions used by the editor are reachable.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';

const source = path.dirname(fileURLToPath(import.meta.url));
const toolModules = ['read','write','bash','powershell'];
const licenses = /^(?:licen[cs]e|notice|copying|copyright)(?:[._-]|$)/i;

export async function buildInstalledAgent(directory, target) {
  fs.mkdirSync(target,{recursive:true});
  const output = path.join(target,'agent.mjs');
  const sdkTools = path.join(directory,'node_modules/@earendil-works/pi-coding-agent/dist/core/tools');
  const result = await build({
    absWorkingDir:directory, entryPoints:['agent.mjs'], outfile:output,
    bundle:true, platform:'node', format:'esm', target:'node22', minify:true, metafile:true,
    banner:{js:"import {createRequire as _opentakeRequire} from 'node:module';const require=_opentakeRequire(import.meta.url);"},
    plugins:[{name:'pi-sdk-tools',setup(b){
      b.onResolve({filter:/^@earendil-works\/pi-coding-agent$/},()=>({path:'definitions',namespace:'pi-sdk'}));
      b.onLoad({filter:/.*/,namespace:'pi-sdk'},()=>({
        resolveDir:sdkTools,contents:toolModules.map(name=>"export * from './"+name+".js'").join('\n'),
      }));
    }}],
  });
  const inputs = Object.values(result.metafile.outputs)[0].inputs;
  const modules = new Map();
  for (const [file,{bytesInOutput}] of Object.entries(inputs)) {
    if (!bytesInOutput || !file.includes('node_modules/')) continue;
    let dir = path.dirname(path.resolve(directory,file));
    while (dir !== directory) {
      if (fs.existsSync(path.join(dir,'package.json'))) {
        const pkg = JSON.parse(fs.readFileSync(path.join(dir,'package.json'),'utf8'));
        if (pkg.name && pkg.version) {modules.set(dir,pkg);break;}
      }
      dir = path.dirname(dir);
    }
  }
  const sections = ['OpenTake 内置智能体 · 随附组件与开源许可'];
  for (const [dir,pkg] of [...modules].sort((a,b)=>a[1].name.localeCompare(b[1].name))) {
    const files = fs.readdirSync(dir,{withFileTypes:true}).filter(e=>e.isFile() && licenses.test(e.name)).map(e=>path.join(dir,e.name));
    if (!files.length && pkg.name.startsWith('@earendil-works/pi-')) files.push(path.join(source,'LICENSE.pi'));
    // https://github.com/standard-webhooks/standard-webhooks/blob/daee8284cfe9d4e435ec16e3e68a8f30084d6aaf/libraries/LICENSE
    if (!files.length && pkg.name === 'standardwebhooks' && pkg.version === '1.3.0') files.push(path.join(source,'LICENSE.standardwebhooks'));
    if (!files.length) throw Error('随附组件缺少许可原文：'+pkg.name+' '+pkg.version);
    sections.push(pkg.name+' '+pkg.version+' · '+pkg.license,...files.map(file=>fs.readFileSync(file,'utf8')));
  }
  sections.push('接入方案评估致谢 · pi-acp 0.0.34 · Sergii Kozak（独立适配器，未随附其代码）',fs.readFileSync(path.join(source,'LICENSE.pi-acp'),'utf8'));
  fs.writeFileSync(path.join(target,'THIRD-PARTY-NOTICES.txt'),sections.join('\n\n'));
  return {packages:modules.size,bytes:fs.statSync(output).size};
}

export async function stageBuiltinAgent(target) {
  // Source setup installs this isolated lock. Once installed, staging needs no network.
  const installedLock=path.join(source,'node_modules','.package-lock.json');
  if(fs.existsSync(installedLock)){
    const locked=JSON.parse(fs.readFileSync(path.join(source,'package-lock.json'),'utf8')).packages;
    const installed=JSON.parse(fs.readFileSync(installedLock,'utf8')).packages;
    for(const [name,entry] of Object.entries(locked)){
      if(!name||entry.optional&&!installed[name])continue;
      if(!entry.integrity||installed[name]?.integrity!==entry.integrity||installed[name]?.version!==entry.version)
        throw Error('内置智能体依赖与锁文件不一致，请重新运行 npm ci。');
    }
    return buildInstalledAgent(source,target);
  }
  const temp = fs.mkdtempSync(path.join(os.tmpdir(),'opentake-pi-build-'));
  try {
    for (const name of ['package.json','package-lock.json','agent.mjs','engine.mjs']) fs.copyFileSync(path.join(source,name),path.join(temp,name));
    // Windows .cmd wrappers cannot be execFile'd. npm's CLI is invoked through
    // the Node executable used by the enclosing build in both editions.
    const npm = process.env.npm_execpath;
    const args = ['ci','--omit=optional','--ignore-scripts','--no-audit','--no-fund'];
    if (npm && fs.existsSync(npm)) execFileSync(process.execPath,[npm,...args],{cwd:temp,stdio:'inherit'});
    else if (process.platform === 'win32') execFileSync(process.env.ComSpec || 'cmd.exe',['/d','/s','/c','npm.cmd '+args.join(' ')],{cwd:temp,stdio:'inherit'});
    else execFileSync('npm',args,{cwd:temp,stdio:'inherit'});
    return await buildInstalledAgent(temp,target);
  } finally { fs.rmSync(temp,{recursive:true,force:true}); }
}
