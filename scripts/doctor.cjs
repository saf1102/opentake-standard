(async()=>{
 if(process.platform==='win32'){
  const result=require('../desktop/media-tools.cjs').doctor();
  if(result.ok){for(const name of ['ffmpeg','ffprobe'])console.log(`${name}: ${result.versions[name]}\n路径：${result[name]}`)}else{console.error('\x1b[38;2;152;105;220m'+result.message+'\x1b[0m');process.exitCode=1}
  return;
 }
 const {checkCreationEnvironment}=await import('../server/standard/creation-tools.ts');
 const result=await checkCreationEnvironment();
 for(const item of result.items)console.log(item.ok?`${item.label}：通过\n${item.path}\n${item.version}`:`\x1b[38;2;152;105;220m${item.label}：${item.message}\n${item.install}\x1b[0m`);
 if(!result.ok)process.exitCode=1;
})().catch(()=>{console.error('环境检查失败，请重试');process.exitCode=1;});
