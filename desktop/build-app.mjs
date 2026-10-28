import platform from './platform.cjs';
import crypto from 'node:crypto';
import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';import {spawnSync} from 'node:child_process';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const receiptFile=path.join(root,'release-source.json');
if(!fs.existsSync(receiptFile)&&fs.existsSync(path.join(root,'.git'))){
 const git=args=>{const r=spawnSync('git',args,{cwd:root,encoding:'utf8'});if(r.status!==0)throw Error('源码身份未确认，请交给智能体更新');return r.stdout.trim()};
 const origin=git(['remote','get-url','origin']),version=JSON.parse(fs.readFileSync(path.join(root,'package.json'))).version;
 if(!['https://github.com/saf1102/opentake-standard.git','https://github.com/saf1102/opentake-standard','git@github.com:saf1102/opentake-standard.git'].includes(origin)||git(['status','--porcelain'])||git(['describe','--tags','--exact-match','HEAD'])!=='v'+version)throw Error('请在干净的官方版本标签上构建，或交给智能体保留你的源码改动');
 const entries=git(['ls-tree','-rz','HEAD']).split('\0').filter(Boolean).map(line=>{const m=/^(100644|100755) blob ([a-f0-9]+)\t([\s\S]+)$/.exec(line);if(!m)throw Error('不支持的源码项');return [m[3],m[2]]});
 fs.writeFileSync(receiptFile,JSON.stringify({repository:'saf1102/opentake-standard',version,commit:git(['rev-parse','HEAD']),files:Object.fromEntries(entries)}));
}
if(fs.existsSync(receiptFile)){
 const receipt=JSON.parse(fs.readFileSync(receiptFile));
 if(receipt.repository!=='saf1102/opentake-standard'||!receipt.files)throw Error('源码来源记录无效，请交给智能体更新');
 for(const [rel,expected] of Object.entries(receipt.files)){
  const file=path.resolve(root,rel);if(!file.startsWith(root+path.sep))throw Error('源码记录路径无效');
  const bytes=fs.readFileSync(file),actual=crypto.createHash('sha1').update(Buffer.from(`blob ${bytes.length}\0`)).update(bytes).digest('hex');
  if(actual!==expected)throw Error('源码已有改动，请保留并交给智能体更新：'+rel);
 }
 if(fs.existsSync(path.join(root,'.git'))){const result=spawnSync('git',['status','--porcelain'],{cwd:root,encoding:'utf8'});if(result.status!==0||result.stdout.trim())throw Error('源码工作区不干净，请交给智能体更新');}
}
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
