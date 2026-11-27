import test from 'node:test';
import assert from 'node:assert/strict';
import {bundledWindowsVersion,windowsVersionSupported} from './editor/openscreen-platform.ts';

const manifest=(components:unknown,extra={})=>JSON.stringify({schema:1,platform:'win32-x64',components,...extra});
const exe='C:\\Users\\测试 用户\\AppData\\Local\\Programs\\OpenTake Standard\\resources\\runtimes\\openscreen\\Openscreen.exe';

test('Windows 自带录屏组件按安装包清单读版本，不再误报「版本未通过检查」',()=>{
 const reads:string[]=[];
 const version=bundledWindowsVersion(exe,file=>{reads.push(file);return manifest([{name:'Python',version:'3.14.10'},{name:'OpenScreen',version:'2.1.2'}])});
 assert.equal(version,'2.1.2');assert.equal(windowsVersionSupported(version),true);
 assert.deepEqual(reads,['C:\\Users\\测试 用户\\AppData\\Local\\Programs\\OpenTake Standard\\resources\\runtimes\\manifest.json']);
});

test('不在自带位置、清单损坏或不匹配时不猜版本',()=>{
 let reads=0;const read=()=>{reads++;return manifest([{name:'OpenScreen',version:'2.1.2'}])};
 assert.equal(bundledWindowsVersion('C:\\Program Files\\Openscreen\\Openscreen.exe',read),undefined);
 assert.equal(reads,0,'用户自己装的不读安装包清单');
 assert.equal(bundledWindowsVersion(exe,()=>'{bad json'),undefined);
 assert.equal(bundledWindowsVersion(exe,()=>manifest([{name:'OpenScreen',version:'2.1.2'}],{platform:'darwin-arm64'})),undefined);
 assert.equal(bundledWindowsVersion(exe,()=>manifest([{name:'Python',version:'3'}])),undefined);
 assert.equal(bundledWindowsVersion(exe,()=>manifest([{name:'OpenScreen',version:'latest'}])),undefined);
 assert.equal(bundledWindowsVersion(exe,()=>{throw Error('ENOENT')}),undefined);
});
