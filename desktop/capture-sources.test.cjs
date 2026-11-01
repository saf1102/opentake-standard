const test=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const {SOURCE_OPTIONS,captureSources,installCaptureSourceBridge,requestCaptureSources}=require('./capture-sources.cjs');
test('native source enumeration avoids thumbnail capture and preserves display order and Chinese window names',()=>{
 assert.deepEqual(SOURCE_OPTIONS,{types:['window','screen'],thumbnailSize:{width:0,height:0},fetchWindowIcons:false});
 const sources=captureSources([{id:'screen:2:0',name:'屏幕二',display_id:'22'},{id:'window:55:0',name:'中文 空格',display_id:''}],['11','22']);
 assert.equal(sources[0].captureValue,'1');assert.equal(sources[0].displayIndex,1);assert.equal(sources[1].captureValue,'中文 空格');assert.ok(!('thumbnail' in sources[1]));
 assert.throws(()=>captureSources([{id:'screen:2:0',name:'屏幕二',display_id:'22'}],['11']),/屏幕列表/);
});
function channels(){const client=new EventEmitter(),parent=new EventEmitter();client.connected=parent.connected=true;
 client.send=(message,done)=>{queueMicrotask(()=>parent.emit('message',message));done?.()};
 parent.send=(message,done)=>{queueMicrotask(()=>client.emit('message',message));done?.()};return {client,parent};}
test('owned desktop bridge resolves concurrent source requests once and releases listeners',async()=>{
 const {client,parent}=channels();let calls=0;
 installCaptureSourceBridge(parent,async()=>{calls++;return captureSources([{id:'window:55:0',name:'中文 空格'}],[])});
 const [a,b]=await Promise.all([requestCaptureSources(client),requestCaptureSources(client)]);
 assert.equal(calls,1);assert.deepEqual(a,b);assert.equal(a[0].id,'window:55:0');assert.equal(client.listenerCount('message'),0);assert.equal(client.listenerCount('disconnect'),0);
 parent.emit('exit');assert.equal(parent.listenerCount('message'),0);
});
test('source bridge reports provider failures, disconnected services and malformed responses',async()=>{
 const {client,parent}=channels();installCaptureSourceBridge(parent,()=>{throw Error('source enumeration failed')});
 await assert.rejects(requestCaptureSources(client),/source enumeration failed/);assert.equal(client.listenerCount('message'),0);
 const other=channels();installCaptureSourceBridge(other.parent,()=>[{id:'window:55:0',name:'bad',type:'display',captureValue:'0'}]);
 await assert.rejects(requestCaptureSources(other.client),/来源格式/);
 const lost=channels();const pending=requestCaptureSources(lost.client);lost.client.emit('disconnect');await assert.rejects(pending,/服务已断开/);assert.equal(lost.client.listenerCount('message'),0);
 client.connected=false;await assert.rejects(requestCaptureSources(client),/未连接/);
});
test('source bridge bounds a nonresponsive desktop and clears request listeners',async()=>{
 const {client}=channels();await assert.rejects(requestCaptureSources(client,5),/来源超时/);assert.equal(client.listenerCount('message'),0);
});
