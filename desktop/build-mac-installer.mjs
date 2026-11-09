// Build a disk image from the existing local/ad-hoc Mac assembly. No public signing.
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import release from './release-contract.cjs';
import platform from './platform.cjs';
export function macInstallerPlan(root,version,arch){
 platform.validateMacArch(arch);
 return {app:path.join(root,'release',platform.macAppDirectory(arch),'OpenTake Standard.app'),
  installer:path.join(root,`release/OpenTake-Standard-${version}-mac-${arch}.dmg`)};
}
export async function buildMacInstaller(root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..')){
 if(process.platform!=='darwin')throw Error('macOS 安装包必须在 Mac 上构建。');
 const version=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).version;
 const arch=platform.macBuildArch();
 const {app,installer}=macInstallerPlan(root,version,arch);
 if(fs.existsSync(installer)||fs.existsSync(installer+'.build.json'))throw Error('已有同名 DMG，请先保留到其他位置再构建。');
 const run=(file,args)=>{const r=spawnSync(file,args,{cwd:root,stdio:'inherit'});if(r.error)throw r.error;if(r.status!==0)throw Error(path.basename(file)+' 构建失败')};
 run(process.execPath,['desktop/build-app.mjs']);
 const stage=fs.mkdtempSync(path.join(root,'release/mac-dmg-'));
 // ditto retains Electron framework links and extended attributes.
 run('/usr/bin/ditto',['--rsrc',app,path.join(stage,'OpenTake Standard.app')]);
 fs.symlinkSync('/Applications',path.join(stage,'Applications'));
 // GitHub's macOS runners sometimes report "Resource busy" right after the copy; retry the same create a few times.
 for(let attempt=1;;attempt++){const r=spawnSync('/usr/bin/hdiutil',['create','-volname','OpenTake Standard','-srcfolder',stage,'-format','UDZO',installer],{cwd:root,stdio:'inherit'});if(!r.error&&r.status===0)break;fs.rmSync(installer,{force:true});if(attempt>=4)throw Error('hdiutil 构建失败');console.warn(`hdiutil create 第 ${attempt} 次失败，${attempt*10} 秒后重试`);spawnSync('/bin/sleep',[String(attempt*10)])}
 run('/usr/bin/hdiutil',['verify',installer]);
 await release.writeInstallerReceipt(root,installer,'darwin',arch);
 console.log('macOS DMG 已生成并校验；沿用本机临时签名，未公证：'+installer);
 return installer;
}
