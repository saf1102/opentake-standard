/** Intel-only draft bundle. Never creates a Windows or backend update feed. */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import release from '../desktop/release-contract.cjs';
export async function prepareMacIntelRelease({artifacts,out,commit,tag}){
 const version=JSON.parse(fs.readFileSync(new URL('../package.json',import.meta.url),'utf8')).version;
 if(!/^[a-f0-9]{40}$/.test(commit||'')||!release.isMacIntelTag(tag,version))throw Error('Intel 草稿须使用完整提交和独立 Intel 标签');
 const filename=`OpenTake-Standard-${version}-mac-x64.dmg`,file=path.join(artifacts,filename);
 const receipt=JSON.parse(fs.readFileSync(file+'.build.json','utf8'));
 if(receipt.schemaVersion!==1||receipt.repository!==release.REPOSITORY||receipt.version!==version||receipt.commit!==commit||receipt.modified!==false||receipt.tag!==tag||receipt.platform!=='darwin'||receipt.arch!=='x64'||receipt.filename!==filename||receipt.signing!=='adhoc'||receipt.notarized!==false)throw Error('Intel 安装包回执不匹配');
 if(await release.fileSha256(file)!==receipt.sha256||fs.statSync(file).size!==receipt.bytes)throw Error('Intel 安装包校验失败');
 if(fs.existsSync(out)&&fs.readdirSync(out).length)throw Error('拒绝覆盖已有 Intel 草稿');
 fs.mkdirSync(out,{recursive:true});
 for(const name of [filename,filename+'.build.json'])fs.copyFileSync(path.join(artifacts,name),path.join(out,name),fs.constants.COPYFILE_EXCL);
 const manifest={schemaVersion:1,repository:release.REPOSITORY,version,tag,commit,makeLatest:false,publicationStatus:'prepared-not-published',installers:[receipt]};
 fs.writeFileSync(path.join(out,'desktop-release.json'),JSON.stringify(manifest,null,2)+'\n');
 fs.writeFileSync(path.join(out,'release-notes.md'),`# OpenTake Standard ${version} · Intel Mac\n\n只补充 Intel x64 安装包，不更新 Windows 或 Apple 芯片版本，不改变 Latest。\n\n提交：${commit}\n标签：${tag}\n\n本机临时签名，未公证。GitHub Intel 构建和测试记录须单独核对；尚未完成 Intel 用户真机录屏和导出验收，Rosetta 不能代替真机编码能力验证。\n`);
 const lines=[];for(const name of fs.readdirSync(out).sort())lines.push(`${await release.fileSha256(path.join(out,name))}  ${name}`);
 fs.writeFileSync(path.join(out,'SHA256SUMS.txt'),lines.join('\n')+'\n');
 return manifest;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2),options={};
 for(let i=0;i<args.length;i+=2){if(!['--artifacts','--out','--commit','--tag'].includes(args[i])||!args[i+1])throw Error('Usage: --artifacts dir --out dir --commit full-sha --tag intel-tag');options[args[i].slice(2)]=args[i+1];}
 console.log(JSON.stringify(await prepareMacIntelRelease(options),null,2));
}
