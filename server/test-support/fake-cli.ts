/** Real subprocess fixtures: POSIX shebangs or a small Windows PE launcher.
 * Never uses a real provider, account, shell profile or NODE_OPTIONS. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {execFileSync,spawnSync} from 'node:child_process';

export function fakeNodeCli(file:string,source:string,module=false):string {
 source=source.replace(/^#![^\n]*\n/,'');
 if(process.platform!=='win32'){
  fs.writeFileSync(file,`#!${process.execPath}\n${source}`,{mode:0o755});return file;
 }
 const code=fileURLToPath(new URL('./fixture-launcher.cs',import.meta.url));
 const key=crypto.createHash('sha256').update(fs.readFileSync(code)).digest('hex').slice(0,16);
 const cache=path.join(os.tmpdir(),'opentake-test-launcher-'+key);fs.mkdirSync(cache,{recursive:true});
 const binary=path.join(cache,'fixture.exe');
 if(!fs.existsSync(binary)){
  const candidate=path.join(cache,`${process.pid}-${crypto.randomUUID()}.exe`);
  const compiler=path.join(process.env.SystemRoot||'C:\\Windows','Microsoft.NET','Framework64','v4.0.30319','csc.exe');
  execFileSync(compiler,['/nologo','/target:exe','/optimize+','/out:'+candidate,code],{windowsHide:true});
  try{fs.copyFileSync(candidate,binary,fs.constants.COPYFILE_EXCL)}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error}finally{fs.rmSync(candidate,{force:true})}
 }
 const executable=file.endsWith('.exe')?file:file+'.exe';
 const script=executable+(module?'.mjs':'.cjs');
 if(!fs.existsSync(executable)||!fs.readFileSync(executable).equals(fs.readFileSync(binary)))fs.copyFileSync(binary,executable);
 fs.writeFileSync(script,source);fs.writeFileSync(executable+'.script-path',script);fs.writeFileSync(executable+'.node-path',process.execPath);
 return executable;
}

/** The product creates .cmd wrappers on Windows; execute those through cmd.exe. */
export function runToolWrapper(file:string,env:NodeJS.ProcessEnv):string {
 const options={env,encoding:'utf8' as const,windowsHide:true};
 if(process.platform!=='win32')return execFileSync(file,[],options);
 const result=spawnSync(path.join(process.env.SystemRoot||'C:\\Windows','System32','cmd.exe'),['/d','/s','/c',`""${file}.cmd""`],{...options,windowsVerbatimArguments:true});
 if(result.error)throw result.error;
 if(result.status!==0)throw Error(`Wrapper failed (${result.status}): ${result.stderr}`);
 return result.stdout;
}
