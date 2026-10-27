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
export function report(history) {
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
    history.days.map(r=>`| ${r.timestamp.slice(0,10)} | ${r.count} | ${r.uniqueCloners} |`).join('\n')+'\n';
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
export function main(args) {
  const options={};
  for(let i=0;i<args.length;i+=2){
    if(!['--repo','--snapshot','--history','--out'].includes(args[i]) || !args[i+1] || options[args[i]]) throw new Error('Usage: --repo owner/repo --out folder [--snapshot clones.json] [--history history.json]');
    options[args[i]]=args[i+1];
  }
  const repo=repository(options['--repo']);
  if(!options['--out']) throw new Error('Output folder required');
  // Explicit history paths must exist. A typo must never reset the history.
  const previous=options['--history'] ? JSON.parse(fs.readFileSync(options['--history'],'utf8')) : null;
  const snapshot=options['--snapshot'] ? JSON.parse(fs.readFileSync(options['--snapshot'],'utf8')) : collectClones(repo);
  const history=mergeSnapshot(previous,snapshot,repo,new Date().toISOString());
  const out=path.resolve(options['--out']);fs.mkdirSync(out,{recursive:true});
  for(const [name,body] of [['history.json',JSON.stringify(history,null,2)+'\n'],['README.md',report(history)]]){
    const destination=path.join(out,name),temp=destination+'.tmp';fs.writeFileSync(temp,body);fs.renameSync(temp,destination);
  }
  console.log('Repository clone statistics saved. Source ZIP downloads and successful installs remain unknown.');
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{main(process.argv.slice(2));}catch(error){console.error(error instanceof SyntaxError ? 'Invalid JSON; no statistics written.' : error.message);process.exitCode=1;}
}
