/** Archive a selected, already-public main commit; never archive working files. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
export const PUBLIC_REPOSITORY='saf1102/opentake-standard';
export function prepareSourceRelease({cwd=process.cwd(),ref='main',out}){
 if(!out || (ref!=='main'&&!/^[a-f0-9]{40}$/i.test(ref)))throw new Error('Select main or a full 40-character main commit SHA');
 const git=(args)=>{const r=spawnSync('git',args,{cwd,encoding:'utf8',maxBuffer:10_000_000});if(r.error||r.status!==0)throw new Error('Source Git verification failed');return r.stdout;};
 const origin=git(['remote','get-url','origin']).trim();
 if(![`https://github.com/${PUBLIC_REPOSITORY}.git`,`git@github.com:${PUBLIC_REPOSITORY}.git`,`https://github.com/${PUBLIC_REPOSITORY}`].includes(origin))throw new Error('Source ZIP must come from the public Standard repository');
 const sha=git(['rev-parse','--verify',`${ref==='main'?'refs/remotes/origin/main':ref}^{commit}`]).trim();
 if(!/^[a-f0-9]{40}$/.test(sha))throw new Error('Invalid resolved commit');
 git(['merge-base','--is-ancestor',sha,'refs/remotes/origin/main']);
 const entries=git(['ls-tree','-rz','--full-tree',sha]).split('\0').filter(Boolean).map(line=>{
  const match=/^(\d+) blob ([a-f0-9]+)\t([\s\S]+)$/.exec(line);
  if(!match)throw new Error('Unsupported source tree entry');
  return {mode:match[1],path:match[3]};
 });
 const names=new Set(entries.map(e=>e.path));
 for(const required of ['README.md','LICENSE','NOTICE','package.json','package-lock.json'])if(!names.has(required))throw new Error('Not a complete Standard source tree');
 for(const entry of entries){
  if(!['100644','100755'].includes(entry.mode)||entry.path.includes('\\')||entry.path.split('/').includes('..'))throw new Error('Unsafe source tree entry');
  if(/^(?:internal-service|artifacts|exports|downloads|output|data|logs|experiments|node_modules|dist|release|scripts\/standard)(?:\/|$)/i.test(entry.path)
   ||/(^|\/)(?:\.git|\.env(?:\..*)?|id_rsa|id_ed25519|[^/]*\.(?:pem|p12|pfx|key))$/i.test(entry.path))throw new Error('Source tree contains a forbidden private or generated path');
 }
 const folder=path.resolve(out);
 fs.mkdirSync(folder,{recursive:true});
 const filename='OpenTake-Standard-source.zip',archive=path.join(folder,filename);
 for(const name of [filename,filename+'.sha256','source-release.json','release-notes.md'])if(fs.existsSync(path.join(folder,name)))throw new Error('Refusing to overwrite a prepared source bundle');
 git(['archive','--format=zip','--prefix=opentake-standard/',`--output=${archive}`,sha]);
 const checksum=crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex');
 fs.writeFileSync(archive+'.sha256',`${checksum}  ${filename}\n`);
 const manifest={schemaVersion:1,repository:PUBLIC_REPOSITORY,commit:sha,tag:`source-${sha}`,filename,sha256:checksum,bytes:fs.statSync(archive).size,trackedFiles:entries.length};
 fs.writeFileSync(path.join(folder,'source-release.json'),JSON.stringify(manifest,null,2)+'\n');
 fs.writeFileSync(path.join(folder,'release-notes.md'),`# OpenTake Standard 源码快照\n\n公开 main 提交：${sha}\n\n请下载附件 **${filename}**，解压后按 README 安装；这不是预编译安装包。\n\nSHA-256：\`${checksum}\`（另附 .sha256 文件）。\n\n由 git archive 从已跟踪源码生成，不包含本机未提交文件、依赖缓存或用户工程。此快照附件不覆盖；更新使用新的 source-commit tag。\n\nRelease 附件下载次数用于仓库聚合统计，不是人数或安装成功数。GitHub 自动 Source code ZIP 是另一个入口，无法提供相同计数。\n`);
 return manifest;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{const args=process.argv.slice(2),options={};for(let i=0;i<args.length;i+=2){if(!['--ref','--out'].includes(args[i])||!args[i+1])throw new Error('Usage: --ref main|full-sha --out folder');options[args[i]]=args[i+1];}const manifest=prepareSourceRelease({ref:options['--ref'],out:options['--out']});console.log(`Prepared ${manifest.tag}: ${manifest.bytes} bytes, SHA-256 ${manifest.sha256}`);}
 catch(error){console.error(error.message);process.exitCode=1;}
}
