// Build a disk image from the existing local/ad-hoc Mac assembly. No public signing.
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import release from './release-contract.cjs';
export function macInstallerPlan(root,version,arch){
 if(arch!=='arm64')throw Error('本轮 macOS 安装包仅支持已支持的 Apple 芯片，未扩展 Intel 支持。');
 return {app:path.join(root,'release/mac-arm64/OpenTake Standard.app'),
  installer:path.join(root,`release/OpenTake-Standard-${version}-mac-arm64.dmg`)};
}
export async function buildMacInstaller(root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..')){
 if(process.platform!=='darwin')throw Error('macOS 安装包必须在 Apple 芯片 Mac 上构建。');
 const version=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).version;
 const {app,installer}=macInstallerPlan(root,version,process.arch);
 if(fs.existsSync(installer)||fs.existsSync(installer+'.build.json'))throw Error('已有同名 DMG，请先保留到其他位置再构建。');
 const run=(file,args)=>{const r=spawnSync(file,args,{cwd:root,stdio:'inherit'});if(r.error)throw r.error;if(r.status!==0)throw Error(path.basename(file)+' 构建失败')};
 run(process.execPath,['desktop/build-app.mjs']);
 const stage=fs.mkdtempSync(path.join(root,'release/mac-dmg-'));
 // ditto retains Electron framework links and extended attributes.
 run('/usr/bin/ditto',['--rsrc',app,path.join(stage,'OpenTake Standard.app')]);
 fs.symlinkSync('/Applications',path.join(stage,'Applications'));
 run('/usr/bin/hdiutil',['create','-volname','OpenTake Standard','-srcfolder',stage,'-format','UDZO',installer]);
 run('/usr/bin/hdiutil',['verify',installer]);
 await release.writeInstallerReceipt(root,installer,'darwin','arm64');
 console.log('macOS DMG 已生成并校验；沿用本机临时签名，未公证：'+installer);
 return installer;
}
