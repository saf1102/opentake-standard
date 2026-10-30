(async()=>{
 if(process.platform==='win32'){
  const result=require('../desktop/media-tools.cjs').doctor();
  if(result.ok){for(const name of ['ffmpeg','ffprobe'])console.log(`${name}: ${result.versions[name]}\n路径：${result[name]}`)}else{console.error('\x1b[38;2;152;105;220m'+result.message+'\x1b[0m');process.exitCode=1}
  return;
 }
 const fs=require('node:fs'),path=require('node:path');
 const root=path.resolve(__dirname,'..'),signature=require('../desktop/sign-local-app.cjs');
 const candidates=['mac-arm64','mac'].map(n=>path.join(root,'release',n,'OpenTake Standard.app'));
 const app=process.env.OPENTAKE_STANDARD_CHECK_APP||candidates.find(p=>fs.existsSync(p))||candidates[0];
 const signed=signature.diagnoseLocalApp(app);console.log(signed.message);
 if(!signed.ok){console.error('请先退出这个 Standard 测试 App，在源码目录运行：\n'+signed.repair);process.exitCode=1;}
 console.log('常见问题：若提示「已损坏」，仅修复自己从官方源码构建的产物；运行 npm run build:app 重建，或按 README「常见问题」运行本机签名修复命令。不要关闭 Gatekeeper。');
 const {checkCreationEnvironment}=await import('../server/standard/creation-tools.ts');
 const result=await checkCreationEnvironment();
 for(const item of result.items)console.log(item.ok?`${item.label}：通过\n${item.path}\n${item.version}`:`\x1b[38;2;152;105;220m${item.label}：${item.message}\n${item.install}\x1b[0m`);
 const {openscreen}=await import('../server/onboarding-common.ts');
 const screen=await openscreen();
 console.log(`OpenScreen（可选）：${screen.text}`);
 if(screen.state!=='ok')console.log('官方安装：https://github.com/getopenscreen/openscreen/releases/latest；不影响通用剪辑。');
 if(!result.ok)process.exitCode=1;
})().catch(()=>{console.error('环境检查失败，请重试');process.exitCode=1;});
