/** Prepare only the locked Windows FFmpeg pair needed by the CI media tests. */
import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
import {lockedDownload,safeArchivePaths} from './prepare-windows-runtimes.mjs';

if(process.platform!=='win32'||!process.env.RUNNER_TEMP||!process.env.GITHUB_ENV)throw Error('Run this helper in Windows GitHub Actions');
const lock=JSON.parse(await fs.readFile(new URL('../WINDOWS-RUNTIME-LOCK.json',import.meta.url),'utf8'));
const item=lock.components.find(row=>row.name==='FFmpeg / ffprobe');
if(!item)throw Error('FFmpeg runtime lock missing');
const root=await fs.mkdtemp(path.join(process.env.RUNNER_TEMP,'opentake-ci-media-'));
const archive=await lockedDownload(item,path.join(root,'downloads'));
const require=createRequire(import.meta.url);
const seven=await require('app-builder-lib/out/toolsets/7zip').getPath7za();
const run=(file,args)=>{
 const result=spawnSync(file,args,{windowsHide:true,encoding:'utf8',maxBuffer:32<<20});
 if(result.error)throw result.error;
 if(result.status!==0)throw Error('CI media preparation failed: '+result.stderr);
 return result.stdout;
};
safeArchivePaths(run(seven,['l','-slt','-sccUTF-8',archive]));
const extracted=path.join(root,'extracted');
await fs.mkdir(extracted);
run(seven,['x','-y','-bd','-sccUTF-8',archive,'-o'+extracted]);
const entries=await fs.readdir(extracted);
if(entries.length!==1)throw Error('Unexpected locked FFmpeg archive layout');
const bin=path.join(extracted,entries[0],'bin');
for(const name of ['ffmpeg','ffprobe'])console.log(run(path.join(bin,name+'.exe'),['-version']).split('\n')[0]);
await fs.appendFile(process.env.GITHUB_ENV,`LINKREADER_BIN_DIR=${bin}\n`);
