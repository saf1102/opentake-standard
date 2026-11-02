const test=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {installNavigation}=require('./navigation.cjs');
const origin='http://127.0.0.1:3119';
const page='https://docs.github.com/en/copilot/reference/copilot-cli-reference/acp-server';
const settled=()=>new Promise(resolve=>setImmediate(resolve));

function fixture({openExternal=async()=>{},loadURL=async()=>{}}={}){
 const calls={external:[],internal:[],errors:[]};
 const contents=new EventEmitter();let current=origin+'/',destroyed=false;
 contents.getURL=()=>current;
 contents.setWindowOpenHandler=handler=>{contents.openWindow=handler};
 const window={webContents:contents,isDestroyed:()=>destroyed,loadURL:async url=>{calls.internal.push(url);await loadURL(url)}};
 installNavigation({window,origin,shell:{openExternal:(...args)=>{calls.external.push(args);return openExternal(...args)}},dialog:{showErrorBox:(...args)=>calls.errors.push(args)}});
 return {calls,contents,setCurrent:url=>{current=url},destroy:()=>{destroyed=true},
  popup:(url,extra={})=>contents.openWindow({url,referrer:{url:'',policy:'no-referrer'},...extra}),
  navigate:(url,event='will-navigate')=>{let prevented=false;contents.emit(event,{preventDefault(){prevented=true}},url);return prevented}};
}

test('installation links with noreferrer open in the system browser without another app window',async()=>{
 const f=fixture();
 for(const url of [page,'https://cursor.com/docs/cli/acp','https://opencode.ai/docs/acp/','https://qwenlm.github.io/qwen-code-docs/en/users/configuration/settings/','https://code.claude.com/docs/en/overview','https://www.kimi.com/code/docs/en/kimi-code-cli/']){
  assert.deepEqual(f.popup(url),{action:'deny'});
  assert.deepEqual(f.calls.external.at(-1),[url,{activate:true}]);
 }
 await settled();assert.equal(f.calls.external.length,6);assert.deepEqual(f.calls.internal,[]);assert.deepEqual(f.calls.errors,[]);
});
test('same-tab HTTPS links open externally and preserve the desktop page',async()=>{
 const f=fixture();assert.equal(f.navigate(page),true);await settled();
 assert.deepEqual(f.calls.external,[[page,{activate:true}]]);assert.deepEqual(f.calls.internal,[]);
});
test('local routes still navigate inside the existing workspace',async()=>{
 const f=fixture(),url=origin+'/screen-motion/projects/test';
 assert.equal(f.navigate(url),false);assert.deepEqual(f.popup(url),{action:'deny'});await settled();
 assert.deepEqual(f.calls.internal,[url]);assert.deepEqual(f.calls.external,[]);
});
test('files, scripts, custom protocols, credentials and origin lookalikes cannot reach the OS shell',async()=>{
 const f=fixture();
 for(const url of ['file:///C:/Windows/System32/cmd.exe','C:\\Windows\\System32\\cmd.exe','\\\\server\\share\\tool.exe','javascript:alert(1)','data:text/html,test','blob:'+origin+'/test','ms-settings:','vscode://file/C:/test','http://example.com/','http://127.0.0.1:3119.evil.test/','http://127.0.0.1:3120/','https://user:password@example.com/','https://docs.github.com@evil.test/','not a url']){
  assert.deepEqual(f.popup(url),{action:'deny'});assert.equal(f.navigate(url),true,url);
 }
 await settled();assert.deepEqual(f.calls.external,[]);assert.deepEqual(f.calls.internal,[]);
});
test('external redirects stay blocked and do not launch a browser automatically',()=>{
 const f=fixture();assert.equal(f.navigate(page,'will-redirect'),true);assert.equal(f.navigate(origin+'/general','will-redirect'),false);
 assert.deepEqual(f.calls.external,[]);assert.deepEqual(f.calls.internal,[]);
});
test('POST popups are not changed into GET requests',()=>{
 const f=fixture();f.popup(page,{postBody:{data:[{bytes:Buffer.from('private=data')}]}});
 assert.deepEqual(f.calls.external,[]);assert.deepEqual(f.calls.internal,[]);
});
test('an unexpected remote page cannot invoke desktop link handling',()=>{
 const f=fixture();f.setCurrent('https://example.com/');f.popup(page);f.popup(origin+'/general');assert.equal(f.navigate(page),true);
 assert.deepEqual(f.calls.external,[]);assert.deepEqual(f.calls.internal,[]);
});
test('a rejected browser launch reports failure and a later click can retry',async()=>{
 let fail=true;const f=fixture({openExternal:async()=>{if(fail)throw Error('OS launch failed')}});
 f.popup(page);await settled();assert.equal(f.calls.errors.length,1);assert.match(f.calls.errors[0][0],/无法打开网页/);assert.ok(f.calls.errors[0][1].includes(page));
 fail=false;f.popup(page);await settled();assert.equal(f.calls.external.length,2);assert.equal(f.calls.errors.length,1);
});
test('synchronous shell failures are also reported; closing the app suppresses late dialogs',async()=>{
 const sync=fixture({openExternal:()=>{throw Error('sync failure')}});sync.popup(page);await settled();assert.equal(sync.calls.errors.length,1);
 let reject;const late=fixture({openExternal:()=>new Promise((_,r)=>{reject=r})});late.popup(page);late.destroy();reject(Error('late failure'));await settled();assert.equal(late.calls.errors.length,0);
});
test('local popup load failures are reported without opening the browser',async()=>{
 const f=fixture({loadURL:async()=>{throw Error('load failed')}});f.popup(origin+'/general');await settled();
 assert.equal(f.calls.errors.length,1);assert.match(f.calls.errors[0][0],/无法打开页面/);assert.deepEqual(f.calls.external,[]);
});
