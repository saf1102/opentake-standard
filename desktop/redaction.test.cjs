const test=require('node:test');
const assert=require('node:assert/strict');

test('redaction 覆盖 Bearer、API key 与常见凭据字段',async()=>{
 const {redact}=await import('../shared/redaction.mjs');
 const text='Authorization: Bearer sk-abcdefghijklmnopqrst\napi_key: topsecretvalue\nclient_secret="hunter2"';
 const out=redact(text);
 assert.ok(!out.includes('sk-abcdefghijklmnopqrst'));
 assert.ok(!out.includes('topsecretvalue'));
 assert.ok(!out.includes('hunter2'));
 assert.match(out,/Authorization: <REDACTED>/);
 assert.match(out,/api_key: <REDACTED>/);
 assert.match(out,/client_secret=<REDACTED>/);
});

test('redaction 去掉 URL 查询串中的参数',async()=>{
 const {redact}=await import('../shared/redaction.mjs');
 // 字段规则按整行脱敏，属于可接受的过度遮蔽；关键是查询参数不残留。
 const out=redact('GET https://example.com/api/report?token=abc123&debug=1 failed');
 assert.ok(!out.includes('abc123'));
 assert.equal(out,'GET https://example.com/api/report?<REDACTED>');
});

test('redaction 按 USERPROFILE 遮蔽 Windows 用户目录的两种分隔符',async()=>{
 const {redact}=await import('../shared/redaction.mjs');
 const previous=process.env.USERPROFILE;
 process.env.USERPROFILE='C:\\Users\\alice';
 try {
  assert.equal(redact('C:\\Users\\alice\\AppData\\Local\\Temp\\log.txt'),'<USER>\\AppData\\Local\\Temp\\log.txt');
  assert.equal(redact('C:/Users/alice/AppData/Local/Temp/log.txt'),'<USER>/AppData/Local/Temp/log.txt');
 } finally {
  if(previous===undefined)delete process.env.USERPROFILE;else process.env.USERPROFILE=previous;
 }
});

test('redaction 限制超长文本并保持空值稳定',async()=>{
 const {redact}=await import('../shared/redaction.mjs');
 assert.equal(redact('a'.repeat(20000)).length,16000);
 assert.equal(redact(null),'');
 assert.equal(redact(undefined),'');
});
