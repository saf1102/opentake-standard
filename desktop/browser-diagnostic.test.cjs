const test=require('node:test');
const assert=require('node:assert/strict');
const {browserDiagnostic}=require('./browser-diagnostic.cjs');

test('Windows 临时目录 EPERM 归入临时目录阶段，而不是浏览器启动失败',()=>{
 const error=Object.assign(Error('EPERM, Permission denied: \\\\?\\C:\\Users\\dev\\AppData\\Local\\Temp\\opentake-browser-check-abc123'),{code:'EPERM'});
 const result=browserDiagnostic(error,'sandbox');
 assert.equal(result.diagnostic.stage,'temp-dir');
 assert.match(result.message,/临时目录权限或占用/);
 assert.doesNotMatch(result.message,/浏览器启动失败/);
});

test('EACCES 的临时目录报错同样归入临时目录阶段',()=>{
 const result=browserDiagnostic(Error('opentake-browser-check-XYZ: EACCES: permission denied, mkdir'));
 assert.equal(result.diagnostic.stage,'temp-dir');
});

test('探测脚本加载失败仍保留原有阶段',()=>{
 const result=browserDiagnostic(Error("EPERM: operation not permitted, stat 'C:\\Temp\\probe-creation-browser.cjs'"),'sandbox');
 assert.equal(result.diagnostic.stage,'script-load');
 assert.match(result.message,/探测脚本加载失败/);
});

test('结构化阶段优先于文本推断',()=>{
 const error=Object.assign(Error('child exit'),{stage:'launch',stderr:'OPENTAKE_BROWSER_FAILURE '+JSON.stringify({stage:'screenshot',message:'capture failed'})});
 assert.equal(browserDiagnostic(error,'sandbox').diagnostic.stage,'screenshot');
});

test('诊断文本不会泄漏密钥',()=>{
 const result=browserDiagnostic(Error('Authorization: Bearer sk-secrettoken1234567890'));
 assert.ok(!result.message.includes('sk-secrettoken1234567890'));
 assert.match(result.message,/REDACTED/);
});
