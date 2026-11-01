import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {compareRecentAgentFilms,recordFilmOutcome} from './agent-comparison.ts';
import {filmVersionOutdated} from '../shared/agent-connections.ts';

test('最近30天按工程去重出片，阶段完成不算成片成功；未知用量不补零',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'task24b-usage-')),runs=path.join(root,'runs'),outcomes=path.join(root,'outcomes');fs.mkdirSync(runs);
 try{
 const now=Date.parse('2026-10-30T12:00:00Z'),startedAt='2026-10-29T12:00:00Z';
 const write=(id:string,patch:Record<string,unknown>)=>fs.writeFileSync(path.join(runs,`${id}.json`),JSON.stringify({agent:'codex',module:'generalEditing',projectId:'one',filmRunId:'run1',startedAt,status:'completed',durationMs:1000,usage:{input:100,cached:50,output:20,reasoning:10},...patch}));
 write('plan',{});write('code',{});write('other',{projectId:'two',filmRunId:'run2',usage:undefined,status:'failed'});
 write('old',{startedAt:'2026-09-01'});write('future',{startedAt:'2027-01-01'});write('light',{module:'smallCard'});write('no-project',{projectId:undefined});write('live',{status:'running'});
 fs.symlinkSync(path.join(runs,'plan.json'),path.join(runs,'link.json'));
 let row=compareRecentAgentFilms(runs,now,outcomes).rows[0];assert.equal(row.films,2);assert.equal(row.averageDurationMs,1500);assert.equal(row.averageTokens,null);assert.equal(row.successRate,null);
 recordFilmOutcome('one','run1','codex','done',startedAt,outcomes);recordFilmOutcome('two','run2','codex','failed',startedAt,outcomes);
 row=compareRecentAgentFilms(runs,now,outcomes).rows[0];assert.equal(row.successRate,50);
 fs.rmSync(path.join(runs,'other.json'));row=compareRecentAgentFilms(runs,now,outcomes).rows[0];assert.equal(row.averageTokens,240);assert.equal(row.successRate,100);
 }finally{fs.rmSync(root,{recursive:true,force:true})}
});

test('版本逐段比较，未知版本不提示，预发行不能冒充稳定最低版',()=>{
 assert.equal(filmVersionOutdated('0.6.0','0.6.1'),true);assert.equal(filmVersionOutdated('0.10.0','0.6.1'),false);assert.equal(filmVersionOutdated('0.6.1-beta.1','0.6.1'),true);
 for(const version of [undefined,'unknown','nightly'])assert.equal(filmVersionOutdated(version,'0.6.1'),false);
 assert.equal(filmVersionOutdated('2.0.8',undefined),false);
});

test('未提供用量保持未知，Claude缓存输入由本家归一且旧记录不猜总量',async()=>{
 const {applyClaudeEvent}=await import('./general/agent-adapter.ts');const {applyCodexEvent}=await import('./general/events.ts');
 assert.equal(applyClaudeEvent([],{type:'result',subtype:'success'},'now').usage,undefined);
 assert.equal(applyCodexEvent([],{type:'turn.completed'},'now').usage,undefined);
 assert.equal(applyClaudeEvent([],{type:'result',subtype:'success',usage:{input_tokens:20,output_tokens:10,cache_read_input_tokens:100,cache_creation_input_tokens:50}},'now').usage?.total,180);
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'task24b-claude-'));try{
 const file=path.join(root,'run.json'),now=Date.now();const row={agent:'claude',module:'generalEditing',projectId:'one',startedAt:new Date(now).toISOString(),status:'completed',durationMs:1,usage:{input:20,output:10,cached:100,reasoning:0}};
 fs.writeFileSync(file,JSON.stringify(row));assert.equal(compareRecentAgentFilms(root,now,root).rows[0].averageTokens,null);
 fs.writeFileSync(file,JSON.stringify({...row,usage:{...row.usage,total:180}}));assert.equal(compareRecentAgentFilms(root,now,root).rows[0].averageTokens,180);
 }finally{fs.rmSync(root,{recursive:true,force:true})}
});

test('直接出片启动也拒绝已核实的旧版，未知版本保持原接通检查',async()=>{
 const {resolveAgentConnectionLaunch}=await import('./agent-connections.ts');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'task24b-version-')),previous=process.env.LINKREADER_CONNECTION_SETTINGS_FILE;process.env.LINKREADER_CONNECTION_SETTINGS_FILE=path.join(root,'connections.json');
 try{const deps={detect:async()=>'/fixture/qwen',cliTest:async()=>({connected:true}),version:async()=>'0.6.0'};
 await assert.rejects(resolveAgentConnectionLaunch('qwen',{},deps),/0.6.0 太旧，需要 0.6.1/);
 assert.equal((await resolveAgentConnectionLaunch('qwen',{}, {...deps,version:async()=>undefined})).transport,'acp');
 }finally{if(previous===undefined)delete process.env.LINKREADER_CONNECTION_SETTINGS_FILE;else process.env.LINKREADER_CONNECTION_SETTINGS_FILE=previous;fs.rmSync(root,{recursive:true,force:true})}
});
