/** Manual maintainer operation: a new immutable-by-policy source snapshot. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {PUBLIC_REPOSITORY} from './prepare-source-release.mjs';
function gh(args,optional404=false){
 const r=spawnSync('gh',args,{encoding:'utf8',timeout:120_000,maxBuffer:10_000_000});
 if(r.error||r.status!==0){if(optional404&&/HTTP 404/.test(r.stderr??''))return null;throw new Error('GitHub release operation failed. Inspect the draft; no automatic overwrite or deletion attempted.');}
 return r.stdout;
}
try{
 const [flag,folder]=process.argv.slice(2);if(flag!=='--bundle'||!folder)throw new Error('Usage: --bundle prepared-folder');
 const manifest=JSON.parse(fs.readFileSync(path.join(folder,'source-release.json'),'utf8'));
 if(manifest.repository!==PUBLIC_REPOSITORY || !/^[a-f0-9]{40}$/.test(manifest.commit) || manifest.tag!==`source-${manifest.commit}` || manifest.filename!=='OpenTake-Standard-source.zip')throw new Error('Invalid source manifest');
 if(process.env.GITHUB_REPOSITORY!==PUBLIC_REPOSITORY)throw new Error('Only the official Standard repository can publish this source snapshot');
 const zip=path.resolve(folder,manifest.filename),hashFile=zip+'.sha256';
 const actual=crypto.createHash('sha256').update(fs.readFileSync(zip)).digest('hex');
 if(actual!==manifest.sha256||fs.statSync(zip).size!==manifest.bytes||fs.readFileSync(hashFile,'utf8')!==`${actual}  ${manifest.filename}\n`)throw new Error('Source checksum mismatch');
 const tag=encodeURIComponent(manifest.tag),api=`repos/${PUBLIC_REPOSITORY}`;
 // Do not re-use tag or asset IDs: replacing an attachment resets its counter.
 if(gh(['api',`${api}/git/ref/tags/${tag}`],true)!==null || gh(['api',`${api}/releases/tags/${tag}`],true)!==null)throw new Error('This commit already has a tag/release. Refusing replacement; choose a new main commit.');
 gh(['release','create',manifest.tag,zip,hashFile,'--repo',PUBLIC_REPOSITORY,'--target',manifest.commit,
  '--title',`OpenTake Standard source ${manifest.commit.slice(0,12)}`,'--notes-file',path.resolve(folder,'release-notes.md'),'--draft']);
 const release=JSON.parse(gh(['api',`${api}/releases/tags/${tag}`]));
 for(const [name,size] of [[manifest.filename,manifest.bytes],[manifest.filename+'.sha256',fs.statSync(hashFile).size]]){
  const matches=release.assets.filter(a=>a.name===name&&a.state==='uploaded');
  if(matches.length!==1||matches[0].size!==size)throw new Error('Uploaded asset verification failed; draft kept unpublished');
  if(name===manifest.filename && matches[0].digest && matches[0].digest!==`sha256:${actual}`)throw new Error('GitHub asset digest differs; draft kept unpublished');
 }
 gh(['release','edit',manifest.tag,'--repo',PUBLIC_REPOSITORY,'--draft=false','--latest']);
 console.log(`Published https://github.com/${PUBLIC_REPOSITORY}/releases/tag/${manifest.tag}`);
}catch(error){console.error(error instanceof SyntaxError?'Invalid release metadata; refusing publication.':error.message);process.exitCode=1;}
