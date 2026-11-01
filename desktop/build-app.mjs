import platform from './platform.cjs';
import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';import {spawnSync} from 'node:child_process';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const target=platform.buildTarget();
const run=(command,args)=>{const r=spawnSync(command,args,{cwd:root,stdio:'inherit',env:{...process.env,CSC_IDENTITY_AUTO_DISCOVERY:'false'}});if(r.error)throw r.error;if(r.status!==0)throw Error(command+' 失败')};
if(target==='mac'){
const icons=path.join(root,'release','OpenTake.iconset');fs.mkdirSync(icons,{recursive:true});
for(const size of [16,32,128,256,512])for(const scale of [1,2])run('sips',['-z',String(size*scale),String(size*scale),'public/opentake-icon-512.png','--out',path.join(icons,`icon_${size}x${size}${scale===2?'@2x':''}.png`)]);
run('iconutil',['-c','icns',icons,'-o','release/OpenTake.icns']);
run(process.execPath,['node_modules/electron-builder/cli.js','--config','desktop/builder.config.cjs','--mac','dir','--publish','never']);
}else{
run(process.execPath,['node_modules/electron-builder/cli.js','--config','desktop/builder.config.cjs','--win','dir','--x64','--publish','never','--config.directories.output=release/'+target]);
}
console.log(target==='mac'?'本地未签名 OpenTake Standard.app 已生成在 release 下。拖进「应用程序」就能用。媒体运行库的安装说明见 README。':`本地 Windows 测试程序已生成在 release/${target}，尚未通过 Windows 实机验收，不可发布。`);
