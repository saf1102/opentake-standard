import test from 'node:test';
import assert from 'node:assert/strict';
import {createLargeAssetTransport} from './frame-render/large-assets.ts';
test('large render assets use loopback, reject unknown paths and stop with the render',async()=>{
 const transport=createLargeAssetTransport();
 const body=Buffer.alloc(101*1024*1024,0x61);
 const url=await transport.url({body,contentType:'font/ttf'});
 try {
  assert.equal(new URL(url).hostname,'127.0.0.1');
  const result=await fetch(url);assert.equal(result.status,200);assert.equal(result.headers.get('content-type'),'font/ttf');
  assert.deepEqual(Buffer.from(await result.arrayBuffer()),body);
  assert.equal((await fetch(new URL('/missing',url))).status,404);
  assert.equal((await fetch(url,{method:'POST'})).status,404);
 }finally{await transport.close();}
 await assert.rejects(fetch(url));await assert.rejects(transport.url({body:Buffer.alloc(0),contentType:'text/plain'}));
});
