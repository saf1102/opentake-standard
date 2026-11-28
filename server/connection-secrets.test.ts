import test from 'node:test';
import assert from 'node:assert/strict';
import {connectionSecretStore,type SecurityRun} from './connection-secrets.ts';

const id='codex' as const;
const ok=(stdout='',code=0):SecurityRun=>async()=>({code,stdout});

test('未适配的平台不会把密钥退回明文文件',async()=>{
 const store=connectionSecretStore(ok(),'linux');
 await assert.rejects(()=>store.read(id),/尚未适配/);
 await assert.rejects(()=>store.write(id,'abcdefgh1234'),/尚未适配/);
 await assert.rejects(()=>store.remove(id),/尚未适配/);
});

test('钥匙串返回 44 代表没有记录，读取返回空字符串',async()=>{
 const store=connectionSecretStore(ok('',44),'darwin');
 assert.equal(await store.read(id),'');
});

test('读取成功时去掉首尾空白，非 0/44 错误码给出可读提示',async()=>{
 assert.equal(await connectionSecretStore(ok('  secret-value\n'),'darwin').read(id),'secret-value');
 await assert.rejects(()=>connectionSecretStore(ok('',1),'darwin').read(id),/读不了系统钥匙串/);
});

test('写入拒绝含空格或换行的密钥，并只经 stdin 传给 security',async()=>{
 const calls:{args:string[];stdin?:string}[]=[];
 const run:SecurityRun=async(args,stdin)=>{calls.push({args,stdin});return {code:0,stdout:''};};
 const store=connectionSecretStore(run,'darwin');
 await assert.rejects(()=>store.write(id,'has space'),/密钥格式不正确/);
 await assert.rejects(()=>store.write(id,'line\nbreak'),/密钥格式不正确/);
 await store.write(id,'Abc._~+-/1234==');
 assert.equal(calls.length,1);
 assert.deepEqual(calls[0].args,['-i']);
 assert.ok(calls[0].stdin?.includes('-U'));
 assert.ok(calls[0].stdin?.includes('Abc._~+-/1234=='));
 assert.ok(calls[0].stdin?.endsWith('\n'));
});

test('写入与删除遇到异常返回码时报告失败，44 视为删除成功',async()=>{
 await assert.rejects(()=>connectionSecretStore(ok('',1),'darwin').write(id,'abcdefgh1234'),/无法保存到系统钥匙串/);
 await assert.rejects(()=>connectionSecretStore(async()=>{throw Error('boom');},'darwin').write(id,'abcdefgh1234'),/无法保存到系统钥匙串/);
 await connectionSecretStore(ok('',44),'darwin').remove(id);
 await assert.rejects(()=>connectionSecretStore(ok('',1),'darwin').remove(id),/无法删除系统钥匙串中的密钥/);
});

test('服务名按配置隔离且包含接入标识',async()=>{
 const seen:string[]=[];
 const run:SecurityRun=async(args,stdin)=>{seen.push(stdin||args.join(' '));return {code:0,stdout:''};};
 const store=connectionSecretStore(run,'darwin');
 await store.read(id);
 await store.remove(id);
 for(const call of seen)assert.match(call,/opentake\.connection\.[0-9a-f]{16}\.codex/);
});
