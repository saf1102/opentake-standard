const test=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const {waitForService}=require('./service-startup.cjs');
const cleaned=child=>{for(const name of ['message','exit','error'])assert.equal(child.listenerCount(name),0)};
test('startup phases cannot be mistaken for readiness or a nonlocal service',async()=>{
 const child=new EventEmitter(),phases=[],ready=waitForService(child,{timeoutMs:500,onPhase:stage=>phases.push(stage)});
 child.emit('message',{startupPhase:'config'});child.emit('message',{startupPhase:'untrusted text'});child.emit('message',{ready:'https://example.invalid'});child.emit('message',{ready:'http://127.0.0.1:3119'});
 assert.equal(await ready,'http://127.0.0.1:3119');assert.deepEqual(phases,['config']);cleaned(child);
});
test('timeout identifies the last bounded stage and releases all listeners',async()=>{
 const child=new EventEmitter(),ready=waitForService(child,{timeoutMs:10});child.emit('message',{startupPhase:'config'});
 await assert.rejects(ready,/启动超时（加载应用配置）/);cleaned(child);
});
test('early exit and spawn failure remain startup failures',async()=>{
 for(const event of ['exit','error']){const child=new EventEmitter(),ready=waitForService(child,{timeoutMs:100});child.emit(event,event==='exit'?7:Error('synthetic spawn failure'));await assert.rejects(ready,event==='exit'?/退出码 7/:/synthetic spawn failure/);cleaned(child);}
});
