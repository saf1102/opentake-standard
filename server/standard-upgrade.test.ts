import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import type {IncomingMessage,ServerResponse} from 'node:http';
test('public upgrade fallback sends no account information, defaults to beta, and daily check can be disabled',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'standard-upgrade-'));const old=process.env.OPENTAKE_STANDARD_USER_DATA;process.env.OPENTAKE_STANDARD_USER_DATA=root;const original=globalThis.fetch;t.after(()=>{globalThis.fetch=original;if(old===undefined)delete process.env.OPENTAKE_STANDARD_USER_DATA;else process.env.OPENTAKE_STANDARD_USER_DATA=old;fs.rmSync(root,{recursive:true,force:true})});
 const {upgradeApi,UPGRADE_URL,UPGRADE_FALLBACK_URL}=await import('./standard/upgrade.ts');const MAC_FEED='https://github.com/saf1102/opentake-standard/releases/latest/download/mac-update.json';const {default:pkg}=await import('../package.json',{with:{type:'json'}});let offline=false;const requests:string[]=[];
 const options:RequestInit[]=[];
 globalThis.fetch=async(input,init)=>{
  requests.push(String(input));options.push(init||{});
  if(offline||String(input)===UPGRADE_URL)throw Error('offline');
  return new Response(JSON.stringify({mode:'beta',notice:'fallback'}),{status:200});
 };
 async function get(url:string){let body='';const res={statusCode:0,setHeader(){},end(value:string){body=value}};await upgradeApi({method:'GET',url} as IncomingMessage,res as unknown as ServerResponse);assert.equal(res.statusCode,200);return JSON.parse(body)}
 const windows=process.platform==='win32';
 const expected=windows?[UPGRADE_URL,UPGRADE_FALLBACK_URL]:[UPGRADE_URL,UPGRADE_FALLBACK_URL,MAC_FEED];
 const fallback=await get('/api/upgrade/state');
 assert.equal(fallback.upgrade.notice,'fallback');assert.deepEqual(requests,expected);
 const headers=options[0].headers as Record<string,string>;
 const tag=windows?'standard-win':process.platform==='darwin'?'standard-mac':'standard';
 assert.equal(headers['X-OpenTake-Client'],tag+'/'+pkg.version);
 assert.match(headers['X-OpenTake-Install'],/^[a-f0-9-]{36}$/);
 assert.equal(options[1].headers,undefined);
 if(!windows)assert.deepEqual(options[2].headers,{Accept:'application/json'});
 offline=true;
 assert.equal((await get('/api/upgrade/state')).upgrade.mode,'beta');
 assert.deepEqual(requests,[...expected,...expected]);
 for(const request of options){assert.equal(request.credentials,'omit');assert.equal(request.referrerPolicy,'no-referrer')}
 requests.length=0;assert.equal((await get('/api/upgrade/daily')).skipped,true);assert.equal(requests.length,0);
});
