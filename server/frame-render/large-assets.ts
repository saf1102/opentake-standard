import http from 'node:http';
import crypto from 'node:crypto';

// CDP serializes fulfill bodies as base64 and closes its pipe above 100 MiB.
// Large local fonts therefore travel over a short-lived, loopback-only HTTP
// endpoint. This does not permit external network requests or arbitrary files.
export function createLargeAssetTransport() {
 const assets = new Map<string, {body:Buffer;contentType:string}>();
 let closed = false;
 const server = http.createServer((req,res) => {
  const asset = assets.get(req.url || '');
  if (!asset || !['GET','HEAD'].includes(req.method || '')) {res.writeHead(404);res.end();return;}
  res.writeHead(200, {'Content-Type':asset.contentType,'Content-Length':asset.body.length,'Access-Control-Allow-Origin':'http://ot-render.localhost','Cache-Control':'no-store'});
  res.end(req.method === 'HEAD' ? undefined : asset.body);
 });
 let ready:Promise<void>|undefined;
 return {
  async url(asset:{body:Buffer;contentType:string}) {
   if(closed)throw Error('Render asset transport is closed');
   ready ??= new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',()=>resolve());});
   await ready;
   if(closed)throw Error('Render asset transport is closed');
   const key='/'+crypto.randomUUID();assets.set(key,asset);
   return `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}${key}`;
  },
  async close(){closed=true;assets.clear();if(ready){await ready;server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}}
 };
}
