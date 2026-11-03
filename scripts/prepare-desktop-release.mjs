/** Prepare a combined release locally. Upload/publication is a separate maintainer action. */
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import release from '../desktop/release-contract.cjs';
import windows from '../desktop/windows-update-manifest.cjs';
export async function prepareDesktopRelease({source,artifacts,out,commit}){
 if(!/^[a-f0-9]{40}$/.test(commit||''))throw Error('A full reviewed main commit is required');
 const manifest=JSON.parse(fs.readFileSync(path.join(source,'source-release.json'),'utf8'));
 const version=manifest.version,tag=manifest.tag;
 const pkg=JSON.parse(fs.readFileSync(new URL('../package.json',import.meta.url),'utf8'));
 if(version!==pkg.version)throw Error('Current app version differs from the source bundle');
 if(manifest.repository!==release.REPOSITORY||manifest.commit!==commit||manifest.localCandidate||manifest.filename!=='OpenTake-Standard-source.zip')throw Error('Source does not identify the reviewed official commit');
 const zip=path.join(source,manifest.filename);
 if(await release.fileSha256(zip)!==manifest.sha256||fs.statSync(zip).size!==manifest.bytes||fs.readFileSync(zip+'.sha256','utf8')!==`${manifest.sha256}  ${manifest.filename}\n`)throw Error('Source checksum differs');
 const receipts=[];
 for(const [platform,arch,name] of [['darwin','arm64',`OpenTake-Standard-${version}-mac-arm64.dmg`],['win32','x64',`OpenTake-Standard-Setup-${version}-x64.exe`]]){
  const file=path.join(artifacts,name),receipt=JSON.parse(fs.readFileSync(file+'.build.json','utf8'));
  if(receipt.schemaVersion!==1||receipt.repository!==release.REPOSITORY||receipt.commit!==commit||receipt.modified||receipt.version!==version||receipt.tag!==tag||receipt.platform!==platform||receipt.arch!==arch||receipt.filename!==name||release.desktopTag(version,receipt.desktopBuild)!==tag)throw Error('Installer identity differs: '+name);
  if(await release.fileSha256(file)!==receipt.sha256||fs.statSync(file).size!==receipt.bytes)throw Error('Installer checksum differs: '+name);
  receipts.push(receipt);
 }
 if(receipts[0].desktopBuild!==receipts[1].desktopBuild)throw Error('Installer builds differ');
 const win=receipts[1];
 const metadata=JSON.parse(fs.readFileSync(new URL('../desktop/windows-version.json',import.meta.url),'utf8'));
 if(win.desktopBuild!==metadata.windowsBuild||tag!==release.desktopTag(version,metadata.windowsBuild))throw Error('Current release build differs');
 if(fs.existsSync(out)&&fs.readdirSync(out).length)throw Error('Refusing to replace a prepared release');
 fs.mkdirSync(out,{recursive:true});
 const copy=(from,name)=>fs.copyFileSync(from,path.join(out,name),fs.constants.COPYFILE_EXCL);
 for(const name of [manifest.filename,manifest.filename+'.sha256','source-release.json','upgrade.json'])copy(path.join(source,name),name);
 for(const receipt of receipts){copy(path.join(artifacts,receipt.filename),receipt.filename);copy(path.join(artifacts,receipt.filename+'.build.json'),receipt.filename+'.build.json');}
 const notes=fs.readFileSync(new URL('../RELEASE-NOTES-1.1.0.md',import.meta.url),'utf8');
 fs.writeFileSync(path.join(out,'release-notes.md'),notes+`\n\n源码提交：${commit}\n发布标签：${tag}\n构建号：${win.desktopBuild}\n`);
 const handoff=fileURLToPath(new URL('../RELEASE-HANDOFF-1.1.0.md',import.meta.url));
 copy(handoff,'RELEASE-HANDOFF-1.1.0.md');
 const windowsManifest=windows.windowsRelease({schemaVersion:1,product:'opentake-standard',platform:'win32',arch:'x64',channel:'stable',version,windowsBuild:win.desktopBuild,revision:metadata.windowsRevision,notes:notes.slice(0,16000),url:`https://github.com/${release.REPOSITORY}/releases/download/${tag}/${win.filename}`,sha256:win.sha256,size:win.bytes});
 if(!windowsManifest)throw Error('Windows update manifest is invalid');
 fs.writeFileSync(path.join(out,'windows-update.json'),JSON.stringify(windowsManifest,null,2)+'\n');
 fs.writeFileSync(path.join(out,'desktop-release.json'),JSON.stringify({schemaVersion:1,repository:release.REPOSITORY,version,tag,commit,desktopBuild:win.desktopBuild,installers:receipts,publicationStatus:'prepared-not-published'},null,2)+'\n');
 const lines=[];for(const name of fs.readdirSync(out).sort())lines.push(`${await release.fileSha256(path.join(out,name))}  ${name}`);
 fs.writeFileSync(path.join(out,'SHA256SUMS.txt'),lines.join('\n')+'\n');
 return {version,tag,commit,desktopBuild:win.desktopBuild,files:lines.length+1,out:path.resolve(out)};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2),options={};
 for(let i=0;i<args.length;i+=2){if(!['--source','--artifacts','--out'].includes(args[i])||!args[i+1])throw Error('Usage: --source folder --artifacts folder --out empty-folder');options[args[i].slice(2)]=path.resolve(args[i+1]);}
 const git=args=>{const r=spawnSync('git',args,{encoding:'utf8'});if(r.error||r.status!==0)throw Error('Official Git identity could not be verified');return r.stdout.trim()};
 const origin=git(['remote','get-url','origin']);
 if(![`https://github.com/${release.REPOSITORY}.git`,`https://github.com/${release.REPOSITORY}`,`git@github.com:${release.REPOSITORY}.git`].includes(origin))throw Error('Prepare the final bundle from the official repository');
 const commit=git(['rev-parse','HEAD']);git(['merge-base','--is-ancestor',commit,'refs/remotes/origin/main']);
 console.log(JSON.stringify(await prepareDesktopRelease({...options,commit}),null,2));
}
