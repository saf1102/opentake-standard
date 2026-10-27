/** Manual maintainer operation: never replace existing source assets. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {PUBLIC_REPOSITORY} from './prepare-source-release.mjs';
const sha256=value=>crypto.createHash('sha256').update(value).digest('hex');
function gh(args,{optional404=false}={}){
 const stage=args[0]==='release'?'create-draft':args.includes('PATCH')?'publish-by-id':
  args[1]?.includes('/releases?')?'list-releases':args[1]?.includes('/git/ref/')?'verify-tag':
  args.includes('Accept: application/octet-stream')?'verify-asset-content':args[1]?.includes('/assets?')?'list-assets':'read-release-state';
 const r=spawnSync('gh',args,{timeout:120_000,maxBuffer:150*1024*1024});
 if(r.error||r.status!==0){
  if(optional404&&/HTTP 404/.test(String(r.stderr??'')))return null;
  // Deliberately never print stderr, authorization headers or API error bodies.
  throw new Error(`GitHub release operation failed (stage: ${stage}). Draft retained; no overwrite or deletion attempted.`);
 }
 return r.stdout;
}
export function findReleaseByTag(repo,tag,run=gh){
 const matches=[];
 for(let page=1;;page++){
  if(page>10000)throw new Error('Release pagination limit');
  const rows=JSON.parse(String(run(['api',`repos/${repo}/releases?per_page=100&page=${page}`])));
  if(!Array.isArray(rows))throw new Error('Invalid release list');
  matches.push(...rows.filter(r=>r.tag_name===tag));
  if(rows.length<100)break;
 }
 if(matches.length>1)throw new Error('Ambiguous release tag; refusing publication');
 return matches[0]??null;
}
export function publishSourceRelease({folder,repo=process.env.GITHUB_REPOSITORY,resumeDraft=false,run=gh}){
 if(!folder||repo!==PUBLIC_REPOSITORY)throw new Error('Only the official Standard repository can publish this source snapshot');
 const manifest=JSON.parse(fs.readFileSync(path.join(folder,'source-release.json'),'utf8'));
 if(manifest.repository!==repo||!/^[a-f0-9]{40}$/.test(manifest.commit)||manifest.tag!==`source-${manifest.commit}`||manifest.filename!=='OpenTake-Standard-source.zip')throw new Error('Invalid source manifest');
 const zip=path.resolve(folder,manifest.filename),hashFile=zip+'.sha256';
 const actual=sha256(fs.readFileSync(zip)),hashContents=fs.readFileSync(hashFile);
 if(actual!==manifest.sha256||fs.statSync(zip).size!==manifest.bytes||String(hashContents)!==`${actual}  ${manifest.filename}\n`)throw new Error('Source checksum mismatch');
 const api=`repos/${repo}`,tag=encodeURIComponent(manifest.tag);
 let release=findReleaseByTag(repo,manifest.tag,run);
 if(release){
  if(!release.draft)throw new Error('This source snapshot is already published. Refusing replacement.');
  if(!resumeDraft)throw new Error('Draft already exists. Use explicit --resume-draft to verify and finish it without re-uploading.');
 }else{
  if(resumeDraft)throw new Error('No matching draft exists to resume');
  if(run(['api',`${api}/git/ref/tags/${tag}`],{optional404:true})!==null)throw new Error('Tag already exists without a matching draft. Refusing replacement.');
  run(['release','create',manifest.tag,zip,hashFile,'--repo',repo,'--target',manifest.commit,
   '--title',`OpenTake Standard source ${manifest.commit.slice(0,12)}`,'--notes-file',path.resolve(folder,'release-notes.md'),'--draft']);
  // Drafts can have an untagged-* UI URL and are not reliably retrievable by
  // releases/tags/:tag. The authenticated list includes them with tag_name.
  release=findReleaseByTag(repo,manifest.tag,run);
  if(!release)throw new Error('Created draft was not found by tag_name; kept unpublished');
 }
 if(!Number.isSafeInteger(release.id)||release.id<=0)throw new Error('Invalid release ID');
 const id=release.id;
 release=JSON.parse(String(run(['api',`${api}/releases/${id}`])));
 if(release.id!==id||release.draft!==true||release.tag_name!==manifest.tag||release.target_commitish!==manifest.commit)throw new Error('Draft commit identity differs; kept unpublished');
 // Exactly these two assets, no duplicate/extra/partial uploads. Validate both
 // SHA-256 values. If the API has no digest, download by asset ID to hash it.
 const assets=[];
 for(let page=1;;page++){
  if(page>10000)throw new Error('Asset pagination limit');
  const rows=JSON.parse(String(run(['api',`${api}/releases/${id}/assets?per_page=100&page=${page}`])));
  if(!Array.isArray(rows))throw new Error('Invalid draft assets');
  assets.push(...rows);if(rows.length<100)break;
 }
 if(assets.length!==2)throw new Error('Draft must contain exactly the source ZIP and checksum; kept unpublished');
 for(const [name,size,hash] of [[manifest.filename,manifest.bytes,actual],[manifest.filename+'.sha256',hashContents.length,sha256(hashContents)]]){
  const matches=assets.filter(a=>a.name===name&&a.state==='uploaded');
  if(matches.length!==1||matches[0].size!==size||!Number.isSafeInteger(matches[0].id)||matches[0].id<=0)throw new Error('Uploaded asset identity or size differs; kept unpublished');
  const asset=matches[0];
  if(asset.digest){if(asset.digest!==`sha256:${hash}`)throw new Error('Uploaded asset checksum differs; kept unpublished');}
  else {
   const bytes=run(['api',`${api}/releases/assets/${asset.id}`,'-H','Accept: application/octet-stream']);
   if(sha256(bytes)!==hash)throw new Error('Downloaded asset checksum differs; kept unpublished');
  }
 }
 const tagRef=run(['api',`${api}/git/ref/tags/${tag}`],{optional404:true});
 if(tagRef!==null){
  const ref=JSON.parse(String(tagRef));
  if(ref.object?.type!=='commit'||ref.object.sha!==manifest.commit)throw new Error('Existing tag does not identify the selected commit; draft kept unpublished');
 }
 // Publishing by numeric release ID works before the draft's tag exists.
 run(['api',`${api}/releases/${id}`,'--method','PATCH','-F','draft=false','-f','make_latest=true']);
 const published=JSON.parse(String(run(['api',`${api}/releases/${id}`])));
 if(published.id!==id||published.draft!==false||published.tag_name!==manifest.tag)throw new Error('Publication state not confirmed; inspect the existing release, do not replace it');
 return {releaseId:id,tag:manifest.tag,url:`https://github.com/${repo}/releases/tag/${manifest.tag}`,resumed:resumeDraft};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  const args=process.argv.slice(2);
  if(args[0]!=='--bundle'||!args[1]||args.length>3||(args[2]&&args[2]!=='--resume-draft'))throw new Error('Usage: --bundle prepared-folder [--resume-draft]');
  const result=publishSourceRelease({folder:args[1],resumeDraft:args[2]==='--resume-draft'});
  console.log(`Published ${result.url}`);
 }catch(error){console.error(error instanceof SyntaxError?'Invalid release metadata; refusing publication.':error.message);process.exitCode=1;}
}
