/** Maintainer-only publisher. Only the aggregate stats branch is written. */
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {repository} from './repository-stats.mjs';
const repo=repository(process.env.GITHUB_REPOSITORY);
const branch='repository-stats';
function api(endpoint,method='GET',body,optional=false){
 const response=spawnSync('gh',['api',`repos/${repo}/${endpoint}`,'--method',method,...(body?['--input','-']:[])],
  {encoding:'utf8',input:body?JSON.stringify(body):undefined,timeout:60_000,maxBuffer:10_000_000});
 if(response.error || response.status!==0){
  if(optional && /HTTP 404/.test(response.stderr ?? '')) return null;
  throw new Error('GitHub stats-branch operation failed; history was not reset. Check workflow permissions.');
 }
 return JSON.parse(response.stdout);
}
try{
 const [mode,folder]=process.argv.slice(2);
 if(!['--restore','--publish'].includes(mode)||!folder)throw new Error('Usage: --restore|--publish folder');
 const ref=api(`git/ref/heads/${branch}`,'GET',undefined,true);
 if(mode==='--restore'){
  if(ref){
   const content=api(`contents/history.json?ref=${ref.object.sha}`);
   const history=Buffer.from(content.content,'base64').toString('utf8');
   const parsed=JSON.parse(history);
   if(parsed.repository!==repo || parsed.schemaVersion!==1)throw new Error('Stats history mismatch');
   fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(path.join(folder,'history.json'),history);
  }
 }else{
  const tree=api('git/trees','POST',{tree:['history.json','README.md'].map(name=>({path:name,mode:'100644',type:'blob',content:fs.readFileSync(path.join(folder,name),'utf8')}))});
  const commit=api('git/commits','POST',{message:'Record repository clone statistics',tree:tree.sha,parents:ref?[ref.object.sha]:[]});
  if(ref)api(`git/refs/heads/${branch}`,'PATCH',{sha:commit.sha,force:false});
  else api('git/refs','POST',{ref:`refs/heads/${branch}`,sha:commit.sha});
  console.log('Aggregate clone statistics updated on repository-stats branch.');
 }
}catch(error){console.error(error instanceof SyntaxError?'Invalid stats history; refusing to publish.':error.message);process.exitCode=1;}
