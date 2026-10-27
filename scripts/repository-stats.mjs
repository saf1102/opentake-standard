/** Repository-maintainer tool. Not imported by the app or its installer.
 * GitHub clone counts are not people, installs, fetches or source-ZIP downloads.
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

function count(value) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('Invalid non-negative count');
  return value;
}
function instant(value) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) throw new Error('Invalid timestamp');
  return new Date(value).toISOString();
}
export function repository(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value)) throw new Error('Expected owner/repository');
  return value;
}
export function mergeSnapshot(previous, snapshot, repo, collectedAt) {
  repository(repo);
  collectedAt = instant(collectedAt);
  if (!snapshot || !Array.isArray(snapshot.clones)) throw new Error('Missing clone response; unknown is not zero');
  const windowCount = count(snapshot.count), windowUniqueCloners = count(snapshot.uniques);
  if (windowUniqueCloners > windowCount) throw new Error('Invalid unique count');
  if (previous && (previous.schemaVersion !== 1 || previous.repository !== repo)) throw new Error('History belongs to another schema or repository');
  if (previous && collectedAt < instant(previous.lastCollectedAt)) throw new Error('Refusing stale snapshot');
  const days = new Map();
  for (const row of previous?.days ?? []) {
    const timestamp = instant(row.timestamp);
    days.set(timestamp, {timestamp, count:count(row.count), uniqueCloners:count(row.uniqueCloners), lastObservedAt:instant(row.lastObservedAt)});
  }
  const seen = new Set();
  for (const row of snapshot.clones) {
    const timestamp = instant(row.timestamp);
    if (!timestamp.endsWith('T00:00:00.000Z') || timestamp > collectedAt || seen.has(timestamp)) throw new Error('Invalid or duplicate UTC day');
    seen.add(timestamp);
    const dailyCount=count(row.count), dailyUnique=count(row.uniques);
    if (dailyUnique > dailyCount) throw new Error('Invalid daily unique count');
    // Replace overlapping days, including GitHub corrections. Never add a
    // rolling 14-day total to yesterday's total or sum unique people by day.
    days.set(timestamp,{timestamp,count:dailyCount,uniqueCloners:dailyUnique,lastObservedAt:collectedAt});
  }
  return {
    schemaVersion:1, repository:repo,
    firstCollectedAt: previous?.firstCollectedAt ?? collectedAt,
    lastCollectedAt:collectedAt,
    metric:'github_full_git_clones',
    sourceArchiveDownloads:null,
    sourceArchiveStatus:'GitHub does not expose a Download ZIP counter in these APIs',
    latestWindow:{collectedAt,count:windowCount,uniqueCloners:windowUniqueCloners},
    days:[...days.values()].sort((a,b)=>a.timestamp.localeCompare(b.timestamp)),
  };
}
export function cloneReport(history) {
  const sum=history.days.reduce((n,row)=>n+row.count,0);
  return `# OpenTake Standard 源码克隆记录\n\n`+
    `仓库：${history.repository}。最后采集（UTC）：${history.lastCollectedAt}。\n\n`+
    `| 指标 | 数值 |\n|---|---:|\n`+
    `| 已留存日期的完整 git clone 次数之和 | ${sum} |\n`+
    `| GitHub 最新 14 天窗口 clone 次数 | ${history.latestWindow.count} |\n`+
    `| GitHub 最新 14 天窗口独立克隆者数 | ${history.latestWindow.uniqueCloners} |\n`+
    `| 首次采集时间（UTC） | ${history.firstCollectedAt} |\n`+
    `| 留存的 UTC 日期数 | ${history.days.length} |\n\n`+
    `**这不是全部源码下载量，也不是安装人数。** 下载 ZIP、git fetch/pull、安装成功数不在本指标中；CI、维护者和重复克隆会计入。不能将每天的独立克隆者相加后称为累计人数。\n\n`+
    `首次采集前超过 GitHub 窗口的数据不可恢复；采集中断可能造成缺口。未返回的日期不补成零，当前日会继续变化。同日重复采集只更新当天，不重复累加。\n\n`+
    `| 日期（UTC） | Clone 次数 | 当日独立克隆者（不可跨日相加） |\n|---|---:|---:|\n`+
    history.days.slice(-30).map(r=>`| ${r.timestamp.slice(0,10)} | ${r.count} | ${r.uniqueCloners} |`).join('\n')+'\n';
}
export function collectClones(repo) {
  repository(repo);
  // gh manages authentication. Never read a credential file or print stderr,
  // authorization headers, a token, or the environment on failure.
  const result=spawnSync('gh',['api',`repos/${repo}/traffic/clones?per=day`,
    '-H','Accept: application/vnd.github+json','-H','X-GitHub-Api-Version: 2026-03-10'],
    {encoding:'utf8',maxBuffer:2_000_000,timeout:60_000});
  if(result.error || result.status!==0) throw new Error('Traffic API unavailable: install/authenticate GitHub CLI with repository Administration read permission. No statistics written.');
  return JSON.parse(result.stdout);
}

export const SOURCE_ZIP_NAME = 'OpenTake-Standard-source.zip';
function assetRecord(asset) {
  for (const key of ['id','releaseId','downloadCount']) count(asset[key]);
  if (!asset.id || !asset.releaseId || asset.name !== SOURCE_ZIP_NAME || typeof asset.tag !== 'string') throw new Error('Invalid source ZIP asset');
  return {id:asset.id,releaseId:asset.releaseId,tag:asset.tag,name:asset.name,downloadCount:asset.downloadCount};
}
function migrate(previous, repo) {
  if (!previous) return null;
  if (previous.repository !== repo) throw new Error('History belongs to another repository');
  if (previous.schemaVersion === 2) return structuredClone(previous);
  if (previous.schemaVersion !== 1) throw new Error('Unknown statistics schema');
  return {schemaVersion:2,repository:repo,firstCollectedAt:previous.firstCollectedAt,lastCollectedAt:previous.lastCollectedAt,
    clones:{status:'ok',lastSuccessAt:previous.lastCollectedAt,history:previous},
    sourceZip:{status:'unavailable',lastSuccessAt:null,assets:[],intervals:[]}};
}
export function mergeRepositorySnapshot(previous, snapshot, repo, collectedAt) {
  repository(repo); collectedAt=instant(collectedAt);
  const old=migrate(previous,repo);
  if(old && collectedAt < instant(old.lastCollectedAt))throw new Error('Refusing stale snapshot');
  const next=old ?? {schemaVersion:2,repository:repo,firstCollectedAt:collectedAt,
    clones:{status:'unavailable',lastSuccessAt:null,history:null},
    sourceZip:{status:'unavailable',lastSuccessAt:null,assets:[],intervals:[]}};
  next.lastCollectedAt=collectedAt;
  next.automaticSourceArchiveDownloads=null;
  next.clones.attemptedAt=collectedAt;
  if(snapshot.clones?.status==='ok') {
    next.clones.history=mergeSnapshot(next.clones.history,snapshot.clones.data,repo,collectedAt);
    next.clones.status='ok';next.clones.lastSuccessAt=collectedAt;
  }else next.clones.status='unavailable'; // Preserve last successful history, never replace it with zeros.
  const zip=next.sourceZip;
  zip.attemptedAt=collectedAt;
  if(snapshot.sourceZip?.status!=='ok') {zip.status='unavailable'; return next;}
  if(!Array.isArray(snapshot.sourceZip.assets)) throw new Error('Missing complete ZIP asset snapshot');
  const rows=snapshot.sourceZip.assets.map(assetRecord).sort((a,b)=>a.id-b.id);
  if(new Set(rows.map(a=>a.id)).size!==rows.length)throw new Error('Duplicate asset IDs');
  const signature=JSON.stringify(rows);
  if(zip.lastSuccessAt===collectedAt){
    if(zip.lastSnapshot!==signature)throw new Error('Conflicting snapshot at the same instant');
    zip.status='ok';return next;
  }
  const assets=new Map(zip.assets.map(a=>[a.id,a]));
  const seen=new Set();
  const changes=[];
  let increase=0,baseline=0,correction=0;
  let earliestFrom=zip.lastSuccessAt;
  for(const row of rows){
    seen.add(row.id);const prior=assets.get(row.id);
    if(prior && (prior.releaseId!==row.releaseId || prior.name!==row.name)) throw new Error('Asset ID identity changed');
    if(prior){
      const difference=row.downloadCount-prior.lastCount;
      if(earliestFrom && prior.lastObservedAt < earliestFrom) earliestFrom=prior.lastObservedAt;
      if(difference>=0)increase+=difference;else correction+=difference;
      changes.push({assetId:row.id,from:prior.lastObservedAt,to:collectedAt,increase:Math.max(0,difference),baseline:0,correction:Math.min(0,difference)});
      Object.assign(prior,{tag:row.tag,lastCount:row.downloadCount,lastObservedAt:collectedAt,active:true,absentSince:null});
    }else{
      baseline+=row.downloadCount;
      assets.set(row.id,{id:row.id,releaseId:row.releaseId,tag:row.tag,name:row.name,
        firstObservedAt:collectedAt,firstObservedCount:row.downloadCount,lastObservedAt:collectedAt,
        lastCount:row.downloadCount,active:true,absentSince:null});
      changes.push({assetId:row.id,from:null,to:collectedAt,increase:0,baseline:row.downloadCount,correction:0});
    }
  }
  for(const asset of assets.values()) if(!seen.has(asset.id)) {asset.active=false;asset.absentSince ??= collectedAt;}
  const from=earliestFrom;
  const span=from ? Date.parse(collectedAt)-Date.parse(from) : null;
  const boundary=from ? from.slice(0,10)!==collectedAt.slice(0,10) : false;
  zip.intervals.push({from,to:collectedAt,increase,firstSeenBaseline:baseline,correction,
    kind:from===null?'first-baseline':span>36*60*60*1000?'collection-gap':boundary?'cross-utc-day':'within-utc-day',
    utcDate:boundary || from===null ? null:collectedAt.slice(0,10),changes});
  zip.assets=[...assets.values()].sort((a,b)=>a.id-b.id);
  zip.lastSuccessAt=collectedAt;zip.lastSnapshot=signature;zip.status='ok';
  return next;
}
export function dailyZipRows(zip, limit=30) {
  const end=zip.lastSuccessAt?Date.parse(zip.lastSuccessAt.slice(0,10)):null;
  if(end===null)return [];
  const rows=new Map();
  for(const interval of zip.intervals){
    const start=interval.from ? Date.parse(interval.from.slice(0,10)):Date.parse(interval.to.slice(0,10));
    const finish=Date.parse(interval.to.slice(0,10));
    for(let day=Math.max(start,end-(limit-1)*86400000);day<=finish;day+=86400000){
      const date=new Date(day).toISOString().slice(0,10);
      if(!rows.has(date))rows.set(date,{date,increase:null,correction:null,unallocated:0,baseline:false});
      const row=rows.get(date);
      if(interval.kind==='within-utc-day'){
        row.increase=(row.increase??0)+interval.increase;row.correction=(row.correction??0)+interval.correction;
      }else if(interval.kind==='first-baseline')row.baseline=true;
      else row.unallocated++;
    }
  }
  return [...rows.values()].sort((a,b)=>b.date.localeCompare(a.date));
}
export function report(history) {
  if(history.schemaVersion===1)return cloneReport(history);
  const zip=history.sourceZip, clones=history.clones;
  const total=zip.assets.reduce((n,a)=>n+a.lastCount,0);
  const label={ 'first-baseline':'首次基线，不分配到今天', 'collection-gap':'漏采区间，不能拆成逐日下载量',
    'cross-utc-day':'跨 UTC 日区间，不能精确归日', 'within-utc-day':'同一 UTC 日内的观测增量'};
  let text=`# OpenTake Standard 每日下载统计\n\n仓库：${history.repository}。最后尝试采集（UTC）：${history.lastCollectedAt}。\n\n`;
  text+=`| 指标 | 结果 |\n|---|---|\n`+
    `| 官方 Release 源码 ZIP，已观测资产的累计下载次数（含首次基线、已删除资产） | ${zip.lastSuccessAt?total:'未知'} |\n`+
    `| ZIP 本次采集状态 | ${zip.status==='ok'?'成功':'不可用；以下保留值不是本次实时数据'} |\n`+
    `| ZIP 最近成功采集（UTC） | ${zip.lastSuccessAt??'尚未成功'} |\n`+
    `| Clone 本次状态 | ${clones.status==='ok'?'成功':'未知（无权限或 API 不可用），不按 0 次处理'} |\n`+
    `| GitHub 自动 Download ZIP / 自动 Source code archive | 未知，API 无对应计数 |\n\n`;
  text+='计数由 GitHub 提供，可能尚未反映已发生的下载；采集成功只表示 API 返回成功。0 是平台当前返回值，不能据此断言无人下载。\n\n';
  text+='**这些是请求次数，不是独立下载人数、安装成功数或活跃用户数。** ZIP 与 clone 分开，不相加成“用户数”。下载依赖工具、重复下载和自动化也可能计入。\n\n';
  text+='## 每日 ZIP 已确认增量（最近 30 天）\n\n每小时采集；只能把起止均在同一 UTC 日的差值归到当天。跨日和漏采区间保留在下面，不分摊。当天表内数字是已确认部分，不是完整自然日总量。\n\n| UTC 日期 | 同日区间新增 | 同日计数修正 | 跨日/漏采待归属区间数 | 覆盖状态 |\n|---|---:|---:|---:|---|\n';
  text+=dailyZipRows(zip).map(r=>`| ${r.date} | ${r.increase??'未知'} | ${r.correction??'未知'} | ${r.unallocated} | ${r.baseline?'含首次基线；':''}${r.unallocated?'部分覆盖，跨日量未分配':'仅已观测区间'} |`).join('\n')+'\n\n';
  text+='## Release 源码 ZIP 观测区间\n\n每小时采集 GitHub 累计计数后计算差值。下表按采集结束时间排列，不把跨午夜或漏采区间伪装成精准自然日事件量。首次看到资产已有的计数是基线；删掉/替换附件不丢弃已保存的计数，新 asset ID 单独起基线。\n\n';
  text+='| 从（UTC） | 到（UTC） | 既有资产新增 | 新资产首次基线 | 计数修正 | 归属说明 |\n|---|---|---:|---:|---:|---|\n';
  text+=zip.intervals.slice(-72).reverse().map(i=>`| ${i.from??'未知'} | ${i.to} | ${i.increase} | ${i.firstSeenBaseline} | ${i.correction} | ${label[i.kind]} |`).join('\n')+'\n\n';
  text+='这里只展示最近 72 个区间；完整历史在 history.json。\n\n';
  text+='## 最近 30 个已观测的源码 ZIP 附件\n\n| Asset ID | Tag | 最后观测次数 | 当前可见 | 最近观测（UTC） |\n|---|---|---:|---|---|\n';
  const clean=s=>String(s).replace(/[|\r\n<>]/g,' ');
  text+=zip.assets.slice(-30).reverse().map(a=>`| ${a.id} | ${clean(a.tag)} | ${a.lastCount} | ${a.active?'是':'否，保留历史'} | ${a.lastObservedAt} |`).join('\n')+'\n\n';
  text+='## git clone（另一口径）\n\n';
  if(clones.history){text+=`最近成功采集：${clones.lastSuccessAt}。${clones.status!=='ok'?'以下为历史留存，不是本次实时计数。':''}\n\n`+cloneReport(clones.history).replace(/^# .*\n/,'');}
  else text+='尚未获得 Traffic 权限；未知。未影响上面的公开 Release ZIP 统计。\n';
  return text;
}
export async function collectReleaseAssets(repo, request) {
  repository(repo);
  // Paginate releases AND each release's assets. A truncated list would look
  // like deleted assets, so any page failure aborts this entire snapshot.
  const releases=[];
  for(let page=1;;page++){
    if(page>10000)throw new Error('Release pagination limit');
    const rows=await request(`repos/${repo}/releases?per_page=100&page=${page}`);
    if(!Array.isArray(rows))throw new Error('Invalid releases response');
    releases.push(...rows.filter(r=>!r.draft));
    if(rows.length<100)break;
  }
  const assets=[];
  for(const release of releases){
    count(release.id);
    for(let page=1;;page++){
      if(page>10000)throw new Error('Asset pagination limit');
      const rows=await request(`repos/${repo}/releases/${release.id}/assets?per_page=100&page=${page}`);
      if(!Array.isArray(rows))throw new Error('Invalid assets response');
      for(const asset of rows) if(asset.name===SOURCE_ZIP_NAME && asset.state==='uploaded')
        assets.push(assetRecord({id:asset.id,releaseId:release.id,tag:release.tag_name,name:asset.name,downloadCount:asset.download_count}));
      if(rows.length<100)break;
    }
  }
  if(new Set(assets.map(a=>a.id)).size!==assets.length)throw new Error('Duplicate assets across pages');
  return assets;
}
export async function publicJson(endpoint){
  const response=await fetch(`https://api.github.com/${endpoint}`,{headers:{Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2026-03-10'},signal:AbortSignal.timeout(60_000)});
  if(!response.ok)throw new Error(`Public GitHub API HTTP ${response.status}`);
  return response.json();
}
export function githubCliJson(endpoint){
  const response=spawnSync('gh',['api',endpoint,'-H','Accept: application/vnd.github+json','-H','X-GitHub-Api-Version: 2026-03-10'],
    {encoding:'utf8',maxBuffer:10_000_000,timeout:60_000});
  if(response.error || response.status!==0)throw new Error('GitHub CLI API unavailable');
  return JSON.parse(response.stdout);
}
export async function main(args) {
  const options={};
  for(let i=0;i<args.length;i+=2){
    if(!['--repo','--clone-snapshot','--release-snapshot','--history','--out','--api'].includes(args[i]) || !args[i+1] || options[args[i]]) throw new Error('Usage: --repo owner/repo --out folder [--history history.json] [--clone-snapshot clones.json] [--release-snapshot assets.json] [--api public|github-cli]');
    options[args[i]]=args[i+1];
  }
  const repo=repository(options['--repo']);
  if(!options['--out'])throw new Error('Output folder required');
  if(options['--api'] && !['public','github-cli'].includes(options['--api']))throw new Error('Unknown API mode');
  const previous=options['--history'] ? JSON.parse(fs.readFileSync(options['--history'],'utf8')) : null;
  let clones={status:'unavailable'},sourceZip={status:'unavailable'};
  if(options['--clone-snapshot']){
    try{const data=JSON.parse(fs.readFileSync(options['--clone-snapshot'],'utf8'));mergeSnapshot(null,data,repo,new Date().toISOString());clones={status:'ok',data};}
    catch{console.warn('Clone data unavailable; retaining prior clone history.');}
  }
  try{
    const assets=options['--release-snapshot'] ? JSON.parse(fs.readFileSync(options['--release-snapshot'],'utf8')):
      await collectReleaseAssets(repo,options['--api']==='github-cli'?githubCliJson:publicJson);
    sourceZip={status:'ok',assets};
  }catch{console.warn('Release ZIP API unavailable; retaining prior ZIP history.');}
  const history=mergeRepositorySnapshot(previous,{clones,sourceZip},repo,new Date().toISOString());
  const out=path.resolve(options['--out']);fs.mkdirSync(out,{recursive:true});
  for(const [name,body] of [['history.json',JSON.stringify(history,null,2)+'\n'],['README.md',report(history)]]){
    const destination=path.join(out,name),temp=destination+'.tmp';fs.writeFileSync(temp,body);fs.renameSync(temp,destination);
  }
  console.log(`ZIP status: ${history.sourceZip.status}; clone status: ${history.clones.status}. Downloads are not people or installs.`);
  // Publish the truthful failed-status snapshot first; the workflow separately
  // fails its final health check if ZIP collection was unavailable.
  return history;
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{await main(process.argv.slice(2));}catch(error){console.error(error instanceof SyntaxError?'Invalid JSON; statistics not replaced.':error.message);process.exitCode=1;}
}
