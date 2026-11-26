// 沙盒外对一份已打开的隔离内测服务运行。密钥由审核人在内置卡片保存，脚本只使用本机 API。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {setTimeout as wait} from 'node:timers/promises';

const [flag,editor,isolatedRoot]=process.argv.slice(2);
if(flag!=='--run-real'||!editor||!isolatedRoot||!path.isAbsolute(isolatedRoot))throw Error('用法：node scripts/validation/task58-builtin.mjs --run-real http://127.0.0.1:端口 隔离工程根目录');
const url=new URL(editor);
assert.ok(url.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(url.hostname)&&!url.username&&!url.password,'需要隔离内测服务的本机地址');
const root=fs.realpathSync(isolatedRoot);
async function api(route,body){
 const res=await fetch(new URL(route,url.origin),{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(120000)});
 const data=await res.json();
 assert.ok(res.ok&&data.ok!==false,'本机接口请求失败 '+route+' HTTP '+res.status);
 return data.result??data;
}
const settings=await api('/api/editor/system-settings');
const activeRoot=settings.projectPathOverridden?settings.libraries?.[0]?.path:settings.preferences?.paths?.projects;
assert.ok(activeRoot&&fs.realpathSync(activeRoot)===root,'服务当前使用的默认工程库与指定的隔离目录不符');
const agent={agent:'builtin',model:'default',effort:'none'};
const connection=await api('/api/editor/agent-connections/builtin');
assert.ok(connection.connected&&connection.hasKey,'请在内置智能体卡片通过看图测试');
const p=await api('/api/general/projects',{agent,styleId:'whiteboard',settings:{aspect:'16:9',length:15},inputs:{kind:'topic',media:[],text:'用 15 秒解释三角形内角和，配三段清晰可读的中文画面，无需联网。',note:''},network:false});
const route='/api/general/projects/'+p.id;
let generating=false,exporting=false;
async function poll(select,terminal,minutes){
 const until=Date.now()+minutes*60000;
 while(Date.now()<until){const proj=await api(route);if(terminal.includes(select(proj)))return proj;await wait(1500)}
 throw Error('验收超时');
}
try{
 await api(route+'/generate',{});generating=true;
 const finished=await poll(p=>p.run?.state,['done','failed','stopped','needs-network'],30);
 generating=false;assert.equal(finished.run.state,'done');assert.equal(finished.run.agent,'builtin');assert.equal(finished.run.transport,'acp');assert.ok(finished.current);
 const task=await api(route+'/versions/'+finished.current+'/export',{format:'mp4'});exporting=true;
 const final=await poll(p=>p.exportTask?.id===task.id&&p.exportTask.state,['done','failed','cancelled'],10);
 exporting=false;assert.equal(final.exportTask.state,'done');
 const file=fs.realpathSync(path.join(final.exportTask.outputDir,'成片.mp4'));
 const rel=path.relative(root,file);assert.ok(rel&&!rel.startsWith('..')&&!path.isAbsolute(rel),'导出路径不在隔离工程目录');
 const probe=JSON.parse(execFileSync('ffprobe',['-v','error','-show_format','-show_streams','-of','json',file],{encoding:'utf8'}));
 assert.ok(probe.streams.some(s=>s.codec_type==='video'&&s.width&&s.height));
 assert.ok(Math.abs(Number(probe.format.duration)-15)<0.6,'成片时长超差');
 const digest=crypto.createHash('sha256');for await(const chunk of fs.createReadStream(file))digest.update(chunk);
 console.log(JSON.stringify({project:p.id,model:finished.run.model,usage:finished.run.usage,file,seconds:probe.format.duration,sha256:digest.digest('hex')},null,2));
}finally{if(generating)await api(route+'/stop',{});if(exporting)await api(route+'/exports/cancel',{});}
