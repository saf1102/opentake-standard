/** Manual, draft-only operation. No publication or Latest promotion. */
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import release from '../desktop/release-contract.cjs';
import {findReleaseByTag} from './publish-source-release.mjs';
function gh(args,options={}){
 const r=spawnSync('gh',args,{encoding:'utf8',timeout:120000,maxBuffer:10*1024*1024});
 if(r.error||r.status!==0){if(options.optional404&&/HTTP 404/.test(r.stderr||''))return null;throw Error('Intel 草稿操作失败；保留已有草稿，不覆盖或删除');}
 return r.stdout;
}
export async function publishMacIntelDraft({folder,repo=process.env.GITHUB_REPOSITORY,makeLatest=false,run=gh}){
 if(repo!==release.REPOSITORY||makeLatest!==false)throw Error('Intel 草稿只能属于官方仓库，且必须保留 Latest');
 const manifest=JSON.parse(fs.readFileSync(path.join(folder,'desktop-release.json'),'utf8'));
 if(manifest.schemaVersion!==1||manifest.repository!==repo||!release.isMacIntelTag(manifest.tag,manifest.version)||!/^[a-f0-9]{40}$/.test(manifest.commit||'')||manifest.makeLatest!==false||manifest.publicationStatus!=='prepared-not-published'||manifest.installers?.length!==1)throw Error('Intel 草稿清单不匹配');
 release.macIntelTag(manifest.version,manifest.tag.split('-').at(-1));
 const receipt=manifest.installers[0],filename=`OpenTake-Standard-${manifest.version}-mac-x64.dmg`;
 if(receipt.schemaVersion!==1||receipt.repository!==repo||receipt.version!==manifest.version||receipt.signing!=='adhoc'||receipt.notarized!==false||receipt.filename!==filename||receipt.platform!=='darwin'||receipt.arch!=='x64'||receipt.commit!==manifest.commit||receipt.tag!==manifest.tag||receipt.modified!==false)throw Error('Intel 草稿回执不匹配');
 const expected=[filename,filename+'.build.json','desktop-release.json','release-notes.md','SHA256SUMS.txt'].sort();
 if(JSON.stringify(fs.readdirSync(folder).sort())!==JSON.stringify(expected))throw Error('Intel 草稿只允许 DMG、回执和说明；禁止附带更新清单');
 const rows=fs.readFileSync(path.join(folder,'SHA256SUMS.txt'),'utf8').trim().split('\n');
 if(rows.length!==expected.length-1)throw Error('Intel 草稿校验清单不完整');
 const seen=new Set();
 for(const row of rows){const match=/^([a-f0-9]{64})  (.+)$/.exec(row);if(!match||!expected.includes(match[2])||match[2]==='SHA256SUMS.txt'||seen.has(match[2])||await release.fileSha256(path.join(folder,match[2]))!==match[1])throw Error('Intel 草稿文件校验失败');seen.add(match[2]);}
 const stored=JSON.parse(fs.readFileSync(path.join(folder,filename+'.build.json'),'utf8'));
 if(JSON.stringify(stored)!==JSON.stringify(receipt)||await release.fileSha256(path.join(folder,filename))!==receipt.sha256||fs.statSync(path.join(folder,filename)).size!==receipt.bytes)throw Error('Intel DMG 回执校验失败');
 if(findReleaseByTag(repo,manifest.tag,run))throw Error('已有同名 Release 或草稿，拒绝覆盖');
 if(run(['api',`repos/${repo}/git/ref/tags/${encodeURIComponent(manifest.tag)}`],{optional404:true})!==null)throw Error('已有同名标签，拒绝覆盖');
 run(['release','create',manifest.tag,...expected.map(name=>path.resolve(folder,name)),'--repo',repo,'--target',manifest.commit,'--title',`OpenTake Standard ${manifest.version} · Intel Mac`,'--notes-file',path.resolve(folder,'release-notes.md'),'--draft','--latest=false']);
 const draft=findReleaseByTag(repo,manifest.tag,run);
 if(!draft||draft.draft!==true||draft.target_commitish!==manifest.commit)throw Error('草稿状态未确认，请检查现有草稿，勿重建');
 return {tag:manifest.tag,draft:true,makeLatest:false};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 if(process.argv.length!==5||process.argv[2]!=='--bundle'||process.argv[4]!=='--latest=false')throw Error('Usage: --bundle prepared-folder --latest=false');
 console.log(JSON.stringify(await publishMacIntelDraft({folder:process.argv[3]}),null,2));
}
