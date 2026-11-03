import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {jianyingCandidates,readJianyingPaths,writeJianyingPaths} from './editor/jianying/paths.ts';
import {requireJianyingRuntime} from './editor/jianying/runtime.ts';
import {decodeExportOutput,redactExportDiagnostic,runExportTool,exportDiagnostic} from './export-diagnostics.ts';

test('Windows Jianying discovery uses LocalAppData and explicit custom settings',()=>{
 const choices=jianyingCandidates('win32',{LOCALAPPDATA:'D:\\profile 中文'},'D:\\profile 中文');
 assert.equal(choices.apps[0],'D:\\profile 中文\\JianyingPro\\Apps\\JianyingPro.exe');
 assert.equal(choices.drafts[0],'D:\\profile 中文\\JianyingPro\\User Data\\Projects\\com.lveditor.draft');
});
test('missing Jianying dependencies fail before rendering even when a Python exists',{skip:process.platform!=='win32'},async()=>{
 const old=[process.env.OPENTAKE_JIANYING_PYTHON,process.env.OPENTAKE_JIANYING_PACKAGES];
 try{process.env.OPENTAKE_JIANYING_PYTHON=process.execPath;process.env.OPENTAKE_JIANYING_PACKAGES=path.join(os.tmpdir(),'does-not-exist-opentake-jianying');await assert.rejects(requireJianyingRuntime(),/安装剪映不会补齐/);}
 finally{for(const [i,key] of ['OPENTAKE_JIANYING_PYTHON','OPENTAKE_JIANYING_PACKAGES'].entries()){if(old[i]===undefined)delete process.env[key];else process.env[key]=old[i];}}
});
test('export errors preserve Chinese output, exit codes and redacted diagnostics',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'opentake-export-diagnostics-')),previous=process.env.OPENTAKE_EXPORT_DIAGNOSTICS;
 try{
  const file=path.join(root,'job.jsonl');process.env.OPENTAKE_EXPORT_DIAGNOSTICS=file;
  const message='PostQueuedCompletionStatus: (6) 句柄无效';
  assert.equal(decodeExportOutput(Buffer.from(message)),message);
  assert.equal(decodeExportOutput(Buffer.from('bee4b1faceded0a7','hex')),'句柄无效');
  await assert.rejects(runExportTool(process.execPath,['-e',`process.stderr.write(${JSON.stringify(message)});process.exitCode=6`]),/句柄无效/);
  const events=fs.readFileSync(file,'utf8').trim().split('\n').map(line=>JSON.parse(line));
  assert.equal(events.at(-1).code,6);assert.match(events.at(-1).stderr,/句柄无效/);assert.ok(events.at(-1).stack);
  assert.doesNotMatch(redactExportDiagnostic('Authorization: Bearer secret-value password=secret123 api_key="private123"'),/secret-value|secret123|private123/);
  exportDiagnostic({event:'quoted-secret',message:'api_key="private123" password=secret123'});
  const last=JSON.parse(fs.readFileSync(file,'utf8').trim().split('\n').at(-1)!);assert.doesNotMatch(last.message,/private123|secret123/);
 }finally{if(previous===undefined)delete process.env.OPENTAKE_EXPORT_DIAGNOSTICS;else process.env.OPENTAKE_EXPORT_DIAGNOSTICS=previous;fs.rmSync(root,{recursive:true,force:true});}
});
const python=fileURLToPath(new URL('../../runtime-payload/python/python.exe',import.meta.url));
test('portable importer rolls back failures, preserves old drafts, locks and remaps repeated imports',{skip:process.platform!=='win32'||!fs.existsSync(python)},()=>{
 execFileSync(python,['-I','-X','utf8',fileURLToPath(new URL('./editor/jianying/portable/test_import_windows.py',import.meta.url))],{timeout:30000,windowsHide:true});
});
