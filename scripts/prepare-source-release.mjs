/** Archive a selected, already-public main commit; never archive working files. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
export const PUBLIC_REPOSITORY='saf1102/opentake-standard';
export function prepareSourceRelease({cwd=process.cwd(),ref='main',out,localCandidate=false}){
 if(!out || (ref!=='main'&&!/^[a-f0-9]{40}$/i.test(ref)))throw new Error('Select main or a full 40-character main commit SHA');
 const git=(args)=>{const r=spawnSync('git',args,{cwd,encoding:'utf8',maxBuffer:10_000_000});if(r.error||r.status!==0)throw new Error('Source Git verification failed');return r.stdout;};
 const origin=git(['remote','get-url','origin']).trim();
 if(![`https://github.com/${PUBLIC_REPOSITORY}.git`,`git@github.com:${PUBLIC_REPOSITORY}.git`,`https://github.com/${PUBLIC_REPOSITORY}`].includes(origin))throw new Error('Source ZIP must come from the public Standard repository');
 const sha=git(['rev-parse','--verify',`${ref==='main'?(localCandidate?'refs/heads/main':'refs/remotes/origin/main'):ref}^{commit}`]).trim();
 if(!/^[a-f0-9]{40}$/.test(sha))throw new Error('Invalid resolved commit');
 git(['merge-base','--is-ancestor',sha,localCandidate?'refs/heads/main':'refs/remotes/origin/main']);
 const entries=git(['ls-tree','-rz','--full-tree',sha]).split('\0').filter(Boolean).map(line=>{
  const match=/^(\d+) blob ([a-f0-9]+)\t([\s\S]+)$/.exec(line);
  if(!match)throw new Error('Unsupported source tree entry');
  return {mode:match[1],blob:match[2],path:match[3]};
 });
 const names=new Set(entries.map(e=>e.path));
 if(names.has('release-source.json'))throw new Error('Generated source receipt must not be tracked');
 for(const required of ['README.md','LICENSE','NOTICE','package.json','package-lock.json'])if(!names.has(required))throw new Error('Not a complete Standard source tree');
 for(const entry of entries){
  if(!['100644','100755'].includes(entry.mode)||entry.path.includes('\\')||entry.path.split('/').includes('..'))throw new Error('Unsafe source tree entry');
  if(/^(?:internal-service|artifacts|exports|downloads|output|data|logs|experiments|node_modules|dist|release|scripts\/standard)(?:\/|$)/i.test(entry.path)
   ||/(^|\/)(?:\.git|\.env(?:\..*)?|id_rsa|id_ed25519|[^/]*\.(?:pem|p12|pfx|key))$/i.test(entry.path))throw new Error('Source tree contains a forbidden private or generated path');
 }
 const folder=path.resolve(out);
 fs.mkdirSync(folder,{recursive:true});
 const filename='OpenTake-Standard-source.zip',archive=path.join(folder,filename);
 for(const name of [filename,filename+'.sha256','source-release.json','release-notes.md','upgrade.json'])if(fs.existsSync(path.join(folder,name)))throw new Error('Refusing to overwrite a prepared source bundle');
 const pkg=JSON.parse(git(['show',sha+':package.json']));if(pkg.name!=='opentake-standard'||!/^\d+\.\d+\.\d+$/.test(pkg.version))throw Error('Invalid Standard version');
 const receipt=JSON.stringify({repository:PUBLIC_REPOSITORY,commit:sha,version:pkg.version,...(localCandidate?{localCandidate:true}:{}),files:Object.fromEntries(entries.map(e=>[e.path,e.blob]))});
 const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'standard-source-'));
 try{const receiptFile=path.join(temporary,'release-source.json');fs.writeFileSync(receiptFile,receipt);git(['archive','--format=zip','--prefix=opentake-standard/',`--add-file=${receiptFile}`,`--output=${archive}`,sha]);}finally{fs.rmSync(temporary,{recursive:true,force:true})}
 const checksum=crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex');
 fs.writeFileSync(archive+'.sha256',`${checksum}  ${filename}\n`);
 const manifest={...(localCandidate?{localCandidate:true}:{}),schemaVersion:1,repository:PUBLIC_REPOSITORY,commit:sha,tag:`v${pkg.version}`,version:pkg.version,filename,sha256:checksum,bytes:fs.statSync(archive).size,trackedFiles:entries.length};
 fs.writeFileSync(path.join(folder,'source-release.json'),JSON.stringify(manifest,null,2)+'\n');
 const standard={version:pkg.version,notes:'新增标准版检查更新、亮紫提醒和更新窗口。\n模型跟随 Codex 默认，缺少模型时自动回退并保留记录。\n修复 FFmpeg 查找与 Windows 兼容问题。',url:`https://github.com/${PUBLIC_REPOSITORY}/releases/download/v${pkg.version}/${filename}`,sha256:checksum,publishedAt:new Date().toISOString()};
 fs.writeFileSync(path.join(folder,'upgrade.json'),JSON.stringify({... (names.has('upgrade.json')?JSON.parse(git(['show',sha+':upgrade.json'])):{mode:'beta',notice:''}),standard},null,2)+'\n');
 fs.writeFileSync(path.join(folder,'release-notes.md'),`# OpenTake Standard ${pkg.version}\n\n公开 main 提交：${sha}\n\n请下载附件 **${filename}**，解压后按 README 安装；这不是预编译安装包。\n\nSHA-256：\`${checksum}\`（另附 .sha256 文件）。\n\n由 git archive 从已跟踪源码生成，不包含本机未提交文件、依赖缓存或用户工程。此源码附件不覆盖；每个版本使用独立 v 版本标签。\n\nRelease 附件下载次数用于仓库聚合统计，不是人数或安装成功数。GitHub 自动 Source code ZIP 是另一个入口，无法提供相同计数。\n`);
 return manifest;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{const args=process.argv.slice(2),options={};for(let i=0;i<args.length;i+=2){if(!['--ref','--out'].includes(args[i])||!args[i+1])throw new Error('Usage: --ref main|full-sha --out folder');options[args[i]]=args[i+1];}const manifest=prepareSourceRelease({ref:options['--ref'],out:options['--out']});console.log(`Prepared ${manifest.tag}: ${manifest.bytes} bytes, SHA-256 ${manifest.sha256}`);}
 catch(error){console.error(error.message);process.exitCode=1;}
}
