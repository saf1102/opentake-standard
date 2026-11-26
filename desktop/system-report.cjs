const os=require('node:os');
// Which kind of computer is asking: Mac with an Apple or Intel chip, or the Windows build number (10 and 11 differ by it).
// No computer name, serial number or account. Sent with the version report so the admin can see the platform.
function systemReport({platform=process.platform,arch=process.arch,model=os.cpus()[0]?.model||'',release=os.release()}={}){
 if(platform==='darwin')return arch==='arm64'||/Apple/i.test(model)?'mac-arm64':'mac-x64';
 if(platform==='win32'){const build=/^10\.0\.(\d{5,6})(?:\.|$)/.exec(release)?.[1];return build?`win/10.0.${build}`:''}
 return '';
}
module.exports={systemReport};
