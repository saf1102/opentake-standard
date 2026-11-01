const test=require('node:test');const assert=require('node:assert/strict');
const {appDataRoot,termination,revealCommand,buildTarget}=require('./platform.cjs');
const fs=require('node:fs');const os=require('node:os');const path=require('node:path');const cp=require('node:child_process');const {once}=require('node:events');
const {revealPath}=require('./platform.cjs');

function revealFixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'opentake-reveal-'));
 const file=path.join(dir,'成片 & 空格.mp4');fs.writeFileSync(file,'synthetic fixture');
 t.after(()=>{assert.equal(path.dirname(path.resolve(dir)),path.resolve(os.tmpdir()));assert.ok(path.basename(dir).startsWith('opentake-reveal-'));fs.rmSync(dir,{recursive:true,force:true});});
 return {dir,file};
}

test('Windows Explorer handoff succeeds even when the dispatcher later exits with 1',async t=>{
 const {file}=revealFixture(t),original=cp.spawn;let worker,closed;
 t.mock.method(cp,'spawn',(command,args,options)=>{
  assert.equal(command,'explorer.exe');assert.deepEqual(args,['/select,',file]);assert.equal(options.shell,undefined);
  worker=original(process.execPath,['-e','setTimeout(()=>process.exit(1),80)'],options);closed=once(worker,'close');return worker;
 });
 await revealPath(file,'win32');assert.equal(worker.exitCode,null);
 const [code]=await closed;assert.equal(code,1);
});

test('file reveal still rejects missing targets and executable launch errors',async t=>{
 const {dir,file}=revealFixture(t),original=cp.spawn;
 await assert.rejects(revealPath(path.join(dir,'missing.mp4'),'win32'),{code:'ENOENT'});
 t.mock.method(cp,'spawn',(_command,_args,options)=>original(path.join(dir,'missing-explorer.exe'),[],options));
 await assert.rejects(revealPath(file,'win32'),{code:'ENOENT'});
});

test('non-Windows file reveal continues to report dispatcher exit failure',async t=>{
 const {file}=revealFixture(t),original=cp.spawn,stat=fs.statSync;
 t.mock.method(fs,'statSync',target=>{assert.equal(target,'/tmp/成片 & 空格.mp4');return stat(file);});
 t.mock.method(cp,'spawn',(_command,_args,options)=>original(process.execPath,['-e','process.exit(7)'],options));
 await assert.rejects(revealPath('/tmp/成片 & 空格.mp4','darwin'),/文件管理器启动失败（7）/);
});
test('Windows inherited Path remains available and child environments contain one PATH key',()=>{
 const {environmentPath,environmentWithPath}=require('./platform.cjs');
 const original={Path:'C:\\Windows\\System32;C:\\Tools',OTHER:'keep'};
 assert.equal(environmentPath(original,'win32'),original.Path);
 assert.equal(environmentPath({pAtH:original.Path},'win32'),original.Path);
 const next=environmentWithPath(original,'C:\\QA\\bin;'+environmentPath(original,'win32'),'win32');
 assert.deepEqual(Object.keys(next).filter(key=>/^path$/i.test(key)),['PATH']);
 assert.equal(next.PATH,'C:\\QA\\bin;'+original.Path);assert.equal(next.OTHER,'keep');assert.equal(original.Path,'C:\\Windows\\System32;C:\\Tools');
 assert.equal(environmentPath({Path:'not Unix PATH'},'darwin'),'');
});
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
