// macOS installers have their own feed on the latest GitHub release; never accept a Windows/source download.
const {REPOSITORY:repository,desktopTag}=require('./release-contract.cjs');
const endpoint=`https://github.com/${repository}/releases/latest/download/mac-update.json`;
const ARCHES=['arm64','x64'];
const validVersion=value=>typeof value==='string'&&/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value);
const dmgName=(version,arch)=>`OpenTake-Standard-${version}-mac-${arch}.dmg`;
const loopback=value=>/^http:\/\/127\.0\.0\.1:\d+$/.test(value||'');
/** A loopback test origin may serve the same file names; production URLs must be this release's own assets. */
function macRelease(value,testOrigin){
 if(!value||value.schemaVersion!==1||value.product!=='opentake-standard'||value.platform!=='darwin'||value.channel!=='stable'||!validVersion(value.version)||!Number.isSafeInteger(value.desktopBuild)||value.desktopBuild<1||typeof value.notes!=='string'||value.notes.length>16000||!value.installers||typeof value.installers!=='object')return null;
 let tag;try{tag=desktopTag(value.version,value.desktopBuild)}catch{return null}
 const installers={};
 for(const arch of ARCHES){
  const item=value.installers[arch];
  if(!item||typeof item.url!=='string'||typeof item.sha256!=='string'||!/^[a-f0-9]{64}$/i.test(item.sha256)||!Number.isSafeInteger(item.size)||item.size<1||item.size>2*1024*1024*1024)return null;
  const name=dmgName(value.version,arch),official=`https://github.com/${repository}/releases/download/${tag}/${name}`;
  if(item.url!==official&&!(loopback(testOrigin)&&item.url===`${testOrigin}/${name}`))return null;
  installers[arch]={url:item.url,sha256:item.sha256.toLowerCase(),size:item.size};
 }
 return {schemaVersion:1,product:'opentake-standard',platform:'darwin',channel:'stable',version:value.version,desktopBuild:value.desktopBuild,tag,notes:value.notes,installers};
}
/** The release shown to one Mac: its native chip's installer, so Rosetta users move to the Apple Silicon build. */
function macInstallerRelease(release,arch){
 if(!release||!ARCHES.includes(arch))return null;
 const item=release.installers[arch];
 return {kind:'dmg',version:release.version,desktopBuild:release.desktopBuild,notes:release.notes,arch,url:item.url,sha256:item.sha256,size:item.size};
}
function newerBuild(release,currentVersion,currentBuild){
 if(!validVersion(currentVersion)||!validVersion(release?.version))return false;
 const left=release.version.split('.').map(BigInt),right=currentVersion.split('.').map(BigInt);
 for(let i=0;i<3;i++)if(left[i]!==right[i])return left[i]>right[i];
 return Number.isSafeInteger(release.desktopBuild)&&release.desktopBuild>currentBuild;
}
module.exports={repository,endpoint,ARCHES,dmgName,macRelease,macInstallerRelease,newerBuild};
