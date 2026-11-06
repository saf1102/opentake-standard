const {redact}=require('../shared/redaction.mjs');
const MARKER='OPENTAKE_BROWSER_FAILURE ';
function browserDiagnostic(error,scope='host',fallback='launch'){
 const stderr=String(error?.stderr||'');
 let detail;for(const line of stderr.split(/\r?\n/)){const at=line.indexOf(MARKER);if(at>=0)try{detail=JSON.parse(line.slice(at+MARKER.length))}catch{}}
 const text=redact([detail?.message,error?.message,stderr].filter(Boolean).join('\n')).slice(-8000);
 const stage=detail?.stage||error?.stage||(/MODULE_NOT_FOUND|Cannot find module|\b(?:EPERM|EACCES)\b[^\n]*,\s*(?:stat|open)\b/i.test(text)?'script-load':fallback);
 const label=({'script-load':'探测脚本加载失败','permission':'应用目录读取权限配置失败','launch':'浏览器启动失败','page':'页面加载失败','screenshot':'页面截图失败','protocol':'探测未完成'})[stage]||'探测失败';
 const result=Error(`Chromium ${scope==='sandbox'?'出片沙盒':'服务端渲染模式'}：${label}\n${text||'没有底层错误信息'}`,{cause:error});
 result.diagnostic={scope,stage,code:error?.code,message:text};return result;
}
module.exports={MARKER,browserDiagnostic};
