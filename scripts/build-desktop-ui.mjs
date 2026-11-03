/** Compile platform-dependent UI assets without rewriting tracked public snapshots. */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const defaultRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
function execute(file,args,options){
 const result=spawnSync(file,args,{...options,stdio:'inherit',windowsHide:true});
 if(result.error)throw result.error;
 if(result.status!==0)throw Error('Desktop UI build failed: '+result.status);
}
export function buildDesktopUi({root=defaultRoot,preserve=false,run=execute}={}){
 root=path.resolve(root);
 const work=path.join(root,'.build');fs.mkdirSync(work,{recursive:true});
 const stage=fs.mkdtempSync(path.join(work,'ui-public-'));
 for(const entry of fs.readdirSync(path.join(root,'public'))){
  if(entry==='openscreen')continue;
  fs.cpSync(path.join(root,'public',entry),path.join(stage,entry),{recursive:true});
 }
 const vite=path.join(root,'node_modules/vite/bin/vite.js');
 run(process.execPath,[vite,'build','--config','vite.linkreader.config.ts','--outDir',path.join(stage,'openscreen')],{cwd:path.join(root,'vendor/openscreen'),env:{...process.env}});
 run(process.execPath,[vite,'build',...(preserve?['--emptyOutDir','false']:[])],{cwd:root,env:{...process.env,OPENTAKE_BUILD_PUBLIC_DIR:stage}});
 // Retain this task-owned stage for reproducible build inspection, including on failure.
 return stage;
}
if(process.argv[1]&&fs.realpathSync(process.argv[1])===fs.realpathSync(fileURLToPath(import.meta.url))){
 const args=process.argv.slice(2);if(args.some(arg=>arg!=='--preserve'))throw Error('Usage: [--preserve]');
 buildDesktopUi({preserve:args.includes('--preserve')});
}
