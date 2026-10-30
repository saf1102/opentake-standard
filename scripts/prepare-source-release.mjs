/** Archive a selected, already-public main commit; never archive working files. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
export const PUBLIC_REPOSITORY='saf1102/opentake-standard';

export function releaseNotes(version){
 return `OpenTake Standard ${version} · 优化流程，提高生片速度
仅支持 macOS（Apple 芯片）；Windows 适配中，暂不支持。
通用剪辑出片更快，进度实时显示；导出统一为画质、编码（H.264 / HEVC / ProRes）和帧率三组选项。
修复录屏帧率、上传、声音峰值和页面出错恢复，补齐完整时间线、文件目录设置与录屏备份。
统一智能体命令行与 API 密钥接入，可测试连接；首次打开通用剪辑引导选择智能体，录屏页增加引导卡，模型不可用时回退默认。
npm run setup 一条命令安装；修复本机 App 签名失效导致的「已损坏」提示，构建后自动清理隔离标记并严格验签。已知项：API 密钥连通未实测（没有密钥）。`;
}
export function prepareSourceRelease({cwd=process.cwd(),ref='main',out,localCandidate=false,frozenManifest}){
 if(frozenManifest)return prepareFrozenSourceRelease({cwd,out,localCandidate,frozenManifest});
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
 const standard={version:pkg.version,notes:releaseNotes(pkg.version),url:`https://github.com/${PUBLIC_REPOSITORY}/releases/download/v${pkg.version}/${filename}`,sha256:checksum,publishedAt:new Date().toISOString()};
 fs.writeFileSync(path.join(folder,'upgrade.json'),JSON.stringify({... (names.has('upgrade.json')?JSON.parse(git(['show',sha+':upgrade.json'])):{mode:'beta',notice:''}),standard},null,2)+'\n');
 fs.writeFileSync(path.join(folder,'release-notes.md'),`# OpenTake Standard ${pkg.version}\n\n${releaseNotes(pkg.version)}\n\n公开 main 提交：${sha}\n\n请下载附件 **${filename}**，解压后按 README 安装；这不是预编译安装包。\n\nSHA-256：\`${checksum}\`（另附 .sha256 文件）。\n\n由 git archive 从已跟踪源码生成，不包含本机未提交文件、依赖缓存或用户工程。此源码附件不覆盖；每个版本使用独立 v 版本标签。\n\nRelease 附件下载次数用于仓库聚合统计，不是人数或安装成功数。GitHub 自动 Source code ZIP 是另一个入口，无法提供相同计数。\n`);
 return manifest;
}
// Offline preparation only: no Git writes, remote access, or claim of a public commit.
// The caller supplies the reviewed SHA-256 file inventory; every byte is checked.
function prepareFrozenSourceRelease({cwd,out,localCandidate,frozenManifest}){
 if(!out)throw Error('Missing output folder');
 const inventoryBytes=fs.readFileSync(frozenManifest), inventory=JSON.parse(inventoryBytes);
 const files=Object.create(null), sha256Files=Object.create(null);
 for(const rel of Object.keys(inventory).sort()){
  if(!rel||path.isAbsolute(rel)||rel.includes('\\')||rel.split('/').some(p=>['..','.',''].includes(p))||
   /(^|\/)(?:\.git|node_modules|dist|release|internal-service|\.env(?:\..*)?|\.npmrc|id_rsa|id_ed25519|[^/]*\.(?:pem|key|p12|pfx))($|\/)/i.test(rel)||
   /^(?:artifacts|exports|downloads|output|data|logs|experiments|scripts\/standard)(?:\/|$)/i.test(rel)||rel==='release-source.json')throw Error('Unsafe frozen source path');
  const file=path.resolve(cwd,rel);let parent=file;
  while(parent!==path.resolve(cwd)){if(fs.lstatSync(parent).isSymbolicLink())throw Error('Frozen source contains symlink');parent=path.dirname(parent)}
  const bytes=fs.readFileSync(file),sum=crypto.createHash('sha256').update(bytes).digest('hex');
  if(sum!==inventory[rel])throw Error('Frozen source changed: '+rel);
  sha256Files[rel]=sum;files[rel]=crypto.createHash('sha1').update(Buffer.from(`blob ${bytes.length}\0`)).update(bytes).digest('hex');
 }
 for(const name of ['README.md','AGENTS.md','LICENSE','NOTICE','package.json','package-lock.json'])if(!files[name])throw Error('Incomplete frozen source');
 const pkg=JSON.parse(fs.readFileSync(path.join(cwd,'package.json')));
 if(pkg.name!=='opentake-standard'||!/^\d+\.\d+\.\d+$/.test(pkg.version))throw Error('Invalid Standard version');
 const folder=path.resolve(out),filename='OpenTake-Standard-source.zip';
 fs.mkdirSync(folder,{recursive:true});
 for(const name of [filename,filename+'.sha256','source-release.json','release-notes.md','upgrade.json'])if(fs.existsSync(path.join(folder,name)))throw Error('Refusing to overwrite prepared source');
 const sourceSha256=crypto.createHash('sha256').update(inventoryBytes).digest('hex');
 const receipt={repository:PUBLIC_REPOSITORY,commit:null,version:pkg.version,sourceType:'frozen-directory',sourceSha256,...(localCandidate?{localCandidate:true}:{}),files};
 const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'standard-frozen-'));
 try{
  const root=path.join(temporary,'opentake-standard');fs.mkdirSync(root);
  for(const rel of Object.keys(files)){const dest=path.join(root,rel);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.copyFileSync(path.join(cwd,rel),dest);if(crypto.createHash('sha256').update(fs.readFileSync(dest)).digest('hex')!==sha256Files[rel])throw Error('Frozen source changed during copy: '+rel);fs.chmodSync(dest,fs.statSync(path.join(cwd,rel)).mode&0o777)}
  fs.writeFileSync(path.join(root,'release-source.json'),JSON.stringify(receipt));
  const r=spawnSync('/usr/bin/zip',['-q','-X','-r',path.join(folder,filename),'opentake-standard'],{cwd:temporary,encoding:'utf8'});
  if(r.error||r.status!==0)throw Error('Frozen source archive failed');
 }finally{fs.rmSync(temporary,{recursive:true,force:true})}
 const archive=path.join(folder,filename),checksum=crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex');
 const notes=releaseNotes(pkg.version);
 const manifest={schemaVersion:1,repository:PUBLIC_REPOSITORY,commit:null,sourceType:'frozen-directory',sourceSha256,publicationStatus:'not-published',...(localCandidate?{localCandidate:true,testOnly:true}:{}),version:pkg.version,tag:`v${pkg.version}`,filename,sha256:checksum,bytes:fs.statSync(archive).size,trackedFiles:Object.keys(files).length,files:sha256Files};
 fs.writeFileSync(archive+'.sha256',`${checksum}  ${filename}\n`);
 fs.writeFileSync(path.join(folder,'source-release.json'),JSON.stringify(manifest,null,2)+'\n');
 fs.writeFileSync(path.join(folder,'upgrade.json'),JSON.stringify({...JSON.parse(fs.readFileSync(path.join(cwd,'upgrade.json'))),standard:{version:pkg.version,notes,url:`https://github.com/${PUBLIC_REPOSITORY}/releases/download/v${pkg.version}/${filename}`,sha256:checksum}},null,2)+'\n');
 fs.writeFileSync(path.join(folder,'release-notes.md'),notes+'\n');
 return manifest;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{const args=process.argv.slice(2),options={};for(let i=0;i<args.length;i+=2){if(!['--ref','--out'].includes(args[i])||!args[i+1])throw new Error('Usage: --ref main|full-sha --out folder');options[args[i]]=args[i+1];}const manifest=prepareSourceRelease({ref:options['--ref'],out:options['--out']});console.log(`Prepared ${manifest.tag}: ${manifest.bytes} bytes, SHA-256 ${manifest.sha256}`);}
 catch(error){console.error(error.message);process.exitCode=1;}
}
