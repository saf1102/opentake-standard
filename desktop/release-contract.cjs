const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {spawnSync}=require('node:child_process');
const REPOSITORY='saf1102/opentake-standard';
function desktopTag(version,build){
 if(!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)||!Number.isSafeInteger(build)||build<1)throw Error('Invalid desktop version/build');
 return `desktop-v${version}-${build}`;
}
async function fileSha256(file){const hash=crypto.createHash('sha256');for await(const chunk of fs.createReadStream(file))hash.update(chunk);return hash.digest('hex')}
async function writeInstallerReceipt(root,installer,platform,arch){
 const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
 const metadata=JSON.parse(fs.readFileSync(path.join(root,'desktop/windows-version.json'),'utf8'));
 const source=JSON.parse(fs.readFileSync(path.join(root,'release-source.json'),'utf8'));
 const git=args=>{const r=spawnSync('git',args,{cwd:root,encoding:'utf8',windowsHide:true});return r.status===0?r.stdout.trim():undefined};
 const current=git(['rev-parse','HEAD']);
 const receipt={schemaVersion:1,repository:REPOSITORY,version:pkg.version,desktopBuild:metadata.windowsBuild,
  tag:desktopTag(pkg.version,metadata.windowsBuild),platform,arch,commit:source.commit||null,
  modified:source.localCandidate===true||source.modified===true||Boolean(git(['status','--porcelain']))||Boolean(current&&current!==source.commit),
  filename:path.basename(installer),sha256:await fileSha256(installer),bytes:fs.statSync(installer).size,
  signing:platform==='darwin'?'adhoc':'unsigned',notarized:false};
 fs.writeFileSync(installer+'.build.json',JSON.stringify(receipt,null,2)+'\n');
 return receipt;
}
module.exports={REPOSITORY,desktopTag,fileSha256,writeInstallerReceipt};
