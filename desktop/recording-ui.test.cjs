const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {JSDOM}=require('jsdom');
function fixture(options={}){
 const dom=new JSDOM(fs.readFileSync(path.join(__dirname,'recording.html'),'utf8'),{runScripts:'outside-only'});
 const {window}=dom;let state={id:'take',projectId:'project',phase:'recording'},listener;
 window.recordingDesktop={getState:()=>Promise.resolve(state),onState:fn=>listener=fn,stop:options.stop||(()=>Promise.resolve({accepted:true})),project:()=>Promise.resolve(),menu:()=>Promise.resolve()};
 window.eval(fs.readFileSync(path.join(__dirname,'recording-ui.js'),'utf8'));
 return {dom,window,button:window.document.getElementById('stop'),update:next=>{state=next;listener(next)}};
}
const flush=()=>new Promise(resolve=>setImmediate(resolve));
test('Stop immediately acknowledges a click and shows an explicit saved result',async()=>{
 let finish;const f=fixture({stop:()=>new Promise(resolve=>finish=resolve)});
 try{
  await flush();assert.equal(f.button.disabled,false);f.button.click();
  assert.equal(f.button.disabled,true);assert.equal(f.button.textContent,'正在停止并保存…');
  finish({accepted:true});await flush();
  f.update({id:'take',projectId:'project',phase:'saved'});
  assert.equal(f.button.textContent,'录制已保存');assert.equal(f.button.disabled,true);
  assert.equal(f.window.document.body.dataset.phase,'saved');
 }finally{f.dom.window.close()}
});
test('a failed Stop request shows the error and permits retry',async()=>{
 const f=fixture({stop:()=>Promise.reject(new Error('IPC unavailable'))});
 try{await flush();f.button.click();await flush();assert.equal(f.button.disabled,false);assert.equal(f.button.textContent,'停止并保存');assert.match(f.window.document.getElementById('error').textContent,/IPC unavailable/)}finally{f.dom.window.close()}
});
test('late earlier states cannot resurrect Stop, while a new recording can enable it',async()=>{
 const f=fixture();try{
  await flush();f.update({id:'take',projectId:'project',phase:'saved'});
  f.update({id:'take',projectId:'project',phase:'recording'});assert.equal(f.button.textContent,'录制已保存');assert.equal(f.button.disabled,true);
  f.update({id:'next',projectId:'project',phase:'recording'});assert.equal(f.button.textContent,'停止并保存');assert.equal(f.button.disabled,false);
 }finally{f.dom.window.close()}
});
