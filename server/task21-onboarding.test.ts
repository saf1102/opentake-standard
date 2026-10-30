import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {fileURLToPath,pathToFileURL} from 'node:url';import {build} from 'esbuild';
const root=fileURLToPath(new URL('../',import.meta.url));
test('S11：公共部署检查覆盖 Codex 未装/未登录/就绪、工程库离线和 OpenScreen 下载/权限，不启动录制',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'task21-deploy-'));fs.symlinkSync(path.join(root,'node_modules'),path.join(dir,'node_modules'),'dir');
 try{
  const outfile=path.join(dir,'checks.mjs');await build({entryPoints:[path.join(root,'server/onboarding-common.ts')],outfile,bundle:true,platform:'node',format:'esm',packages:'external',logLevel:'silent',plugins:[{name:'probe-fixtures',setup(b){
   b.onResolve({filter:/agent-installations\.ts$|agent-settings\.ts$|system-settings\.ts$|editor\/openscreen\.ts$/},a=>({path:a.path,namespace:'fixture'}));
   b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:a.path.endsWith('agent-installations.ts')?`export const agentInstallationStatus=async()=>globalThis.__task21Codex;`:a.path.endsWith('agent-settings.ts')?`export const agentSettingsFile=()=>'/unused';export const atomicAgentJson=()=>{};`:a.path.endsWith('system-settings.ts')?`export const defaultProjectRoot=()=>'/fixture';export const pathStatus=()=>globalThis.__task21Disk;`:`export const openScreenEnvironmentStatus=()=>globalThis.__task21Screen;`,loader:'js'}));
  }}]});
  const c=await import(pathToFileURL(outfile).href),g=globalThis as any;
  g.__task21Codex={state:'missing'};assert.equal((await c.codex()).action.target,'agents');g.__task21Codex={state:'needs-login',executable:'/codex'};assert.equal((await c.codex()).action.kind,'codex-login');g.__task21Codex={state:'ready',executable:'/codex'};assert.equal((await c.codex()).state,'ok');
  g.__task21Disk={path:'/fixture',online:false,writable:false,error:'离线'};assert.equal(c.disk().action.target,'storage');g.__task21Disk={path:'/fixture',online:true,writable:true};assert.equal(c.disk().state,'ok');
  g.__task21Screen={installed:false};assert.equal((await c.openscreen()).action.kind,'link');g.__task21Screen={installed:true,version:'1.10.0'};assert.match((await c.openscreen()).text,/版本太旧/);g.__task21Screen={installed:true,version:'2.1.2'};assert.equal((await c.openscreen()).action.target,'screen-recording');
 }finally{delete (globalThis as any).__task21Codex;delete (globalThis as any).__task21Disk;delete (globalThis as any).__task21Screen;fs.rmSync(dir,{recursive:true,force:true})}
});

// Do not bundle this graph: bundlers can turn const into var and conceal the
// native ESM temporal-dead-zone failure that Vite's browser modules exposed.
test('S11：版本入口先加载时，原生 ESM 的部署状态库正常初始化',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'task21-deploy-esm-'));
 fs.symlinkSync(path.join(root,'node_modules'),path.join(dir,'node_modules'),'dir');
 try{
  for(const file of ['edition.tsx','edition-config.ts','onboarding-store.ts']){
   const source=fs.readFileSync(path.join(root,'src/onboarding',file),'utf8')
    .replaceAll("'./onboarding-store'","'./onboarding-store.mjs'")
    .replaceAll("'./edition'","'./edition.mjs'")
    .replaceAll("'./edition-config'","'./edition-config.mjs'")
    .replaceAll("'../desktop/DesktopSession'","'./desktop.mjs'");
   await build({stdin:{contents:source,loader:'tsx',resolveDir:root},outfile:path.join(dir,file.replace(/\.tsx?$/,'.mjs')),bundle:false,format:'esm',target:'esnext',logLevel:'silent'});
  }
  fs.writeFileSync(path.join(dir,'desktop.mjs'),`export function useDesktopAccount(){throw Error('导入阶段不得调用账号 hook')}`);
  const edition=await import(pathToFileURL(path.join(dir,'edition.mjs')).href);
  const store=await import(pathToFileURL(path.join(dir,'onboarding-store.mjs')).href);
  assert.equal(store.DEPLOY_ITEMS,edition.DEPLOY_ITEMS);
  assert.equal(store.summary({rows:{},running:false,checked:false}).total,edition.DEPLOY_ITEMS.length);
  assert.ok([3,10].includes(edition.DEPLOY_ITEMS.length));
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
});
