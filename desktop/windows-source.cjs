const fs=require('node:fs');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
function writeWindowsSourceReceipt(root){
 const metadata=JSON.parse(fs.readFileSync(path.join(root,'desktop/windows-version.json'),'utf8'));
 const version=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).version;
 if(metadata.upstreamVersion!==version)throw Error('Windows 版本与上游源码版本不一致');
 const git=args=>{const result=spawnSync('git',args,{cwd:root,encoding:'utf8',windowsHide:true});return result.status===0?result.stdout.trim():undefined};
 const commit=git(['rev-parse','HEAD']);
 const receipt={...metadata,version,distribution:'windows-offline',...(commit?{commit,modified:Boolean(git(['status','--porcelain']))}:{sourceArchive:true})};
 fs.writeFileSync(path.join(root,'release-source.json'),JSON.stringify(receipt,null,2)+'\n');
 return receipt;
}
module.exports={writeWindowsSourceReceipt};
