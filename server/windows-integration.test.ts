import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {windowsAgentScript,powershellLiteral} from './windows-agent-terminal.ts';
import {windowsConnectionSecretStore} from './windows-connection-secrets.ts';

test('Windows 登录命令把路径和参数作为 PowerShell 字面量，只收集退出码',()=>{
 const script=windowsAgentScript("C:\\测试 空格\\a'b\\kimi.exe",['login'],"C:\\测试 空格\\exit-code");
 assert.ok(script.includes("& 'C:\\测试 空格\\a''b\\kimi.exe' 'login'"));
 assert.ok(script.includes('$LASTEXITCODE'));
 assert.ok(!/ExecutionPolicy|RedirectStandard|Out-File/.test(script));
 assert.throws(()=>powershellLiteral('invalid\ncommand'));
});

test('Windows API 密钥以当前用户 DPAPI 加密，磁盘不出现原文且可删除',{skip:process.platform!=='win32'},async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'opentake-dpapi-test-'));
 try{
  const store=windowsConnectionSecretStore(root,'synthetic-test-scope');
  const synthetic='OpenTake_synthetic_test_key_0123456789';
  await store.write('codex',synthetic);
  const bytes=fs.readFileSync(path.join(root,'codex.dpapi'));
  assert.ok(!bytes.includes(Buffer.from(synthetic)));
  assert.equal(await store.read('codex'),synthetic);
  await store.remove('codex');assert.equal(await store.read('codex'),'');
 }finally{fs.rmSync(root,{recursive:true,force:true})}
});
