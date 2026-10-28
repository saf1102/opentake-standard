const test=require('node:test');const assert=require('node:assert/strict');
const {appDataRoot,termination,revealCommand,buildTarget}=require('./platform.cjs');
test('Windows 10 and 11 use one platform implementation but separate local build directories',()=>{
 assert.equal(buildTarget('win32','x64','10.0.19045'),'win10');
 assert.equal(buildTarget('win32','x64','10.0.22631'),'win11');
 assert.throws(()=>buildTarget('win32','x64','10.0.17763'));
 assert.throws(()=>buildTarget('win32','arm64','10.0.22631'));
 assert.equal(buildTarget('darwin','arm64','26.2'),'mac');
});
test('Windows and macOS profile roots preserve native conventions',()=>{
 assert.equal(appDataRoot('win32',{APPDATA:'C:\\Users\\QA 名字\\AppData\\Roaming'},'C:\\Users\\QA 名字'),'C:\\Users\\QA 名字\\AppData\\Roaming');
 assert.equal(appDataRoot('win32',{},'C:\\QA'),'C:\\QA\\AppData\\Roaming');
 assert.equal(appDataRoot('darwin',{},'/tmp/qa'),'/tmp/qa/Library/Application Support');
});
test('owned process tree termination never uses executable-wide matching or a shell',()=>{
 assert.deepEqual(termination(1234,'SIGKILL','win32'),{command:'taskkill.exe',args:['/PID','1234','/T','/F']});
 assert.deepEqual(termination(1234,'SIGTERM','darwin'),{pid:-1234,signal:'SIGTERM'});
 for(const pid of [0,-1,NaN,process.pid,1.5])assert.throws(()=>termination(pid));
});
test('reveal preserves spaces Chinese and shell metacharacters as one argument',()=>{
 const file='C:\\作品 & test\\成片.mp4';
 assert.deepEqual(revealCommand(file,'win32'),{command:'explorer.exe',args:['/select,',file]});
 assert.deepEqual(revealCommand('/tmp/成片.mp4','darwin'),{command:'/usr/bin/open',args:['-R','/tmp/成片.mp4']});
 assert.throws(()=>revealCommand('relative.mp4','win32'));
});
