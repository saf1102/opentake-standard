import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { getAgentCatalog } from './agent-settings.ts';
import { runAgent } from './agent-runtime.ts';
export async function testAgentConnection(input: unknown) {
  const { cliPath, model, effort } = z.object({cliPath:z.string(),model:z.string(),effort:z.string()}).parse(input);
  const started = Date.now();
  let dir: string | undefined;
  try {
    const catalog = await getAgentCatalog(cliPath);
    if (!catalog.models.some(m => m.id === model && m.efforts.includes(effort))) throw new Error('该 CLI 未声明支持所选模型与推理强度');
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'linkreader-connect-'));
    const output = path.join(dir, 'answer.txt');
    await runAgent({ module:'generalEditing',executable:catalog.executable,cliVersion:catalog.cliVersion,model,effort },
      ['exec','--sandbox','read-only','--skip-git-repo-check','--output-last-message',output,'Connectivity test only. Do not use tools or access files. Reply with exactly LINKREADER_OK.'],
      {cwd:dir,timeout:120_000,maxBuffer:1024*1024,env:{...process.env,NO_COLOR:'1'}}, 'connectivity');
    if (!fs.existsSync(output) || fs.readFileSync(output,'utf8').trim() !== 'LINKREADER_OK') throw new Error('CLI 已退出，但未返回预期测试响应');
    return {model,effort,ok:true,durationMs:Date.now()-started,checkedAt:new Date().toISOString()};
  } catch(error) {
    return {model,effort,ok:false,durationMs:Date.now()-started,checkedAt:new Date().toISOString(),error:(error instanceof Error ? error.message : String(error)).slice(0,1500)};
  } finally {if(dir) fs.rmSync(dir,{recursive:true,force:true});}
}
