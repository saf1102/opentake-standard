const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const versions=new Map();
let shellCache;
function sanitizeAgentEnv(input=process.env,connection){
 const clean=Object.fromEntries(Object.entries(input).filter(([k,v])=>v!==undefined&&!/^(CLAUDECODE|CLAUDE_CODE_.*|ANTHROPIC_BASE_URL|ANTHROPIC_AUTH_TOKEN|ANTHROPIC_API_KEY)$/.test(k)));
 // Existing Windows behavior stays unchanged. API credentials are explicit per-launch additions on macOS.
 if(process.platform==='darwin'&&connection){
  const keys=connection.agent==='claude'?['ANTHROPIC_BASE_URL','ANTHROPIC_API_KEY']:connection.agent==='codex'?['OPENTAKE_CODEX_API_KEY']:[];
  for(const key of keys)if(typeof connection.variables?.[key]==='string')clean[key]=connection.variables[key];
 }
 return clean;
}
function loginEnvironment(base=process.env,refresh=false){
 const env=sanitizeAgentEnv(base), now=Date.now();
 if(!refresh&&shellCache&&shellCache.key===`${env.HOME}:${env.SHELL}`&&now-shellCache.at<15000)return {...env,...shellCache.values};
 if(process.platform==='win32')return env;
 const shell=path.isAbsolute(env.SHELL||'')?env.SHELL:'/bin/zsh';
 const marker='__CW_LOGIN_ENV_7B31__';
 const result=spawnSync(shell,['-ilc',`printf '${marker}\\0'; /usr/bin/env -0`],{env,encoding:'utf8',timeout:2000,maxBuffer:1024*1024});
 const output=result.stdout||'', at=output.indexOf(marker+'\0'),values={};
 if(at>=0)for(const pair of output.slice(at+marker.length+1).split('\0')){
  const i=pair.indexOf('=');if(i<1)continue;const key=pair.slice(0,i);
  if(/^(PATH|LANG|LC_[A-Z_]+|https?_proxy|all_proxy|no_proxy|HTTPS?_PROXY|ALL_PROXY|NO_PROXY|CODEX_HOME|CLAUDE_CONFIG_DIR)$/.test(key))values[key]=pair.slice(i+1);
 }
 if(process.platform==='darwin'&&!Object.keys({...env,...values}).some(k=>/^(https?|all)_proxy$/i.test(k))){
  const proxy=spawnSync('/usr/sbin/scutil',['--proxy'],{encoding:'utf8',timeout:1000}).stdout||'';
  for(const protocol of ['HTTP','HTTPS']){
   if(new RegExp(`${protocol}Enable\\s*:\\s*1`).test(proxy)){
    const host=proxy.match(new RegExp(`${protocol}Proxy\\s*:\\s*([^\\s]+)`))?.[1],port=proxy.match(new RegExp(`${protocol}Port\\s*:\\s*(\\d+)`))?.[1];
    if(host&&port)values[protocol.toLowerCase()+'_proxy']=`http://${host}:${port}`;
   }
  }
 }
 shellCache={key:`${env.HOME}:${env.SHELL}`,at:now,values};return {...env,...values};
}
function executable(file){try{fs.accessSync(file,fs.constants.X_OK);return path.isAbsolute(file)&&fs.statSync(file).isFile()}catch{return false}}
/** Codex only: asks the program itself for its version. Claude Code is never run (see claudeVersionFromFiles). */
function versionOf(kind,file,env){
 if(kind!=='codex')return null;
 try{
  const stat=fs.statSync(file),key=`${kind}:${fs.realpathSync(file)}:${stat.mtimeMs}:${stat.size}`;
  if(versions.has(key))return versions.get(key);
  const r=spawnSync(file,['--version'],{env,encoding:'utf8',timeout:2000,maxBuffer:65536});
  const value=(r.stdout||'').trim();
  const valid=r.status===0&&/^codex(?:-cli)?\b/i.test(value);
  const result=valid?{version:value,semver:value.match(/\d+\.\d+\.\d+(?:-[\w.-]+)?/)?.[0]||'0.0.0'}:null;
  if(result)versions.set(key,result);return result;
 }catch{return null}
}
/**
 * Claude Code's version, read only from what is installed beside it: its bundle's Info.plist, its npm package.json, or
 * the version folder in its real path. Detection never runs Claude Code, not even `--version` or `auth status`.
 * Actual execution belongs only to the explicit unified connection gate. A file that is there and executable is found.
 */
function claudeVersionFromFiles(file){
 let real=file;try{real=fs.realpathSync(file)}catch{/* Keep the path as given. */}
 const bundle=real.match(/^(.*\.app)[\\/]Contents[\\/]MacOS[\\/][^\\/]+$/)?.[1];
 if(bundle)try{
  const plist=fs.readFileSync(path.join(bundle,'Contents','Info.plist'),'utf8');
  const value=plist.match(/<key>CFBundleShortVersionString<\/key>\s*<string>\s*(\d+\.\d+\.\d+[^<\s]*)\s*<\/string>/)?.[1];
  if(value)return value;
 }catch{/* No readable XML Info.plist. */}
 for(let dir=path.dirname(real),i=0;i<5&&dir!==path.dirname(dir);i++,dir=path.dirname(dir)){
  try{const pkg=JSON.parse(fs.readFileSync(path.join(dir,'package.json'),'utf8'));if(pkg.name==='@anthropic-ai/claude-code'&&typeof pkg.version==='string')return pkg.version}catch{/* Not its package. */}
 }
 return real.split(/[\\/]/).reverse().map(part=>part.match(/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/)?.[0]).find(Boolean);
}
function compareVersions(a,b){
 const [ac,ap]=a.split(/-(.*)/s),[bc,bp]=b.split(/-(.*)/s),x=ac.split('.').map(Number),y=bc.split('.').map(Number);
 for(let i=0;i<3;i++)if(x[i]!==y[i])return x[i]-y[i];
 if(ap===undefined||bp===undefined)return Number(ap===undefined)-Number(bp===undefined);
 const as=ap.split('.'),bs=bp.split('.');for(let i=0;i<Math.max(as.length,bs.length);i++){
  if(as[i]===bs[i])continue;if(as[i]===undefined)return -1;if(bs[i]===undefined)return 1;
  const an=/^\d+$/.test(as[i]),bn=/^\d+$/.test(bs[i]);if(an&&bn)return Number(as[i])-Number(bs[i]);if(an!==bn)return an?-1:1;return as[i].localeCompare(bs[i]);
 }return 0;
}
function detectAgent(kind,options={}){
 if(!['codex','claude'].includes(kind))throw Error('未知智能体');
 const home=options.home||os.homedir(),env=options.env||loginEnvironment(process.env,options.refresh),candidates=[];
 const add=(file,source)=>{if(file&&!(kind==='codex'&&/[\\/]runtime[\\/]support[\\/]bin[\\/]codex$/.test(file))&&!candidates.some(c=>c.path===file))candidates.push({path:file,source})};
 const configured=options.configured||'';
 if(configured)add(configured,'manual');
 else{
  add(env[kind==='codex'?'LINKREADER_CODEX_EXECUTABLE':'LINKREADER_CLAUDE_EXECUTABLE'],'environment');
  for(const dir of [...(env.PATH||'').split(path.delimiter),path.join(home,'.local/bin'),path.join(home,'.npm-global/bin'),'/opt/homebrew/bin','/usr/local/bin'].filter(d=>path.isAbsolute(d)))add(path.join(dir,process.platform==='win32'?kind+'.exe':kind),'PATH');
  for(const apps of options.applicationDirs||[path.join(home,'Applications'),'/Applications'])if(kind==='codex')for(const app of ['Codex.app','ChatGPT.app'])for(const relative of ['Contents/Resources/codex','Contents/Resources/codex-cli/bin/codex','Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex'])add(path.join(apps,app,relative),'app');
  if(process.platform==='win32'&&kind==='codex'){
   const npm=env.APPDATA&&path.join(env.APPDATA,'npm','node_modules','@openai','codex');
   if(npm)for(const base of [path.join(npm,'vendor'),path.join(npm,'node_modules','@openai','codex-win32-x64','vendor')])add(path.join(base,'x86_64-pc-windows-msvc','codex','codex.exe'),'npm');
  }
  if(kind==='claude'){
   const dir=path.join(home,'Library/Application Support/Claude/claude-code');
   try{for(const version of fs.readdirSync(dir).filter(v=>/^\d+\.\d+\.\d+/.test(v)).sort((a,b)=>compareVersions(b,a)).slice(0,8)){
    for(const relative of ['claude','bin/claude','claude-code','claude.app/Contents/MacOS/claude'])add(path.join(dir,version,relative),'app');
    // Newer Claude apps keep each version in a build folder: claude-code/<version>/<build>/claude.app.
    try{for(const build of fs.readdirSync(path.join(dir,version)).filter(b=>!b.startsWith('.')&&!b.endsWith('.app')))add(path.join(dir,version,build,'claude.app/Contents/MacOS/claude'),'app')}catch{/* Not a folder. */}
   }}catch{/* No Claude app here. */}
  }
 }
 const seen=new Set();
 for(const item of candidates){
  item.status='missing';if(!executable(item.path))continue;
  const real=fs.realpathSync(item.path);
  if(process.platform!=='win32'&&kind==='codex'&&(/(?:^|[\\/])claude(?:-code)?(?:\.exe)?$/i.test(item.path)||/(?:^|[\\/])claude(?:-code)?(?:\.exe)?$/i.test(real)||/[\\/]@anthropic-ai[\\/]claude-code[\\/]|[\\/]claude[\\/]versions[\\/]/.test(real))){item.status='invalid';continue;}
  if(seen.has(real)){item.status='duplicate';continue}seen.add(real);
  // Claude Code: found when the file is there and executable; it is never started, so its version comes from files.
  if(kind==='claude'){const semver=claudeVersionFromFiles(item.path);Object.assign(item,{status:'valid',semver:semver||'0.0.0'},semver?{version:semver}:{});continue}
  const version=versionOf(kind,item.path,env);if(version){Object.assign(item,version);item.status='valid'}else item.status='invalid';
 }
 const selected=candidates.filter(c=>c.status==='valid').sort((a,b)=>compareVersions(b.semver,a.semver))[0];
 return {kind,host:os.hostname(),mode:configured?'manual':'auto',executable:selected?.path,version:selected?.version,candidates,state:selected?'installed':configured?'invalid':'missing'};
}
/** The program a work module runs: Codex only. Claude Code is detected and listed, never resolved for running. */
function resolveAgent(kind,configured='',options={}){
 if(kind!=='codex')throw Error('工作台不调用 Claude Code，只检测它是否安装');
 const result=detectAgent(kind,{...options,configured});
 if(!result.executable)throw Error(configured?`所选 ${kind} 不存在、不可执行或不是正确的 CLI：${configured}`:'未找到 Codex，请安装或手动指定服务主机上的程序');
 return result.executable;
}
module.exports={sanitizeAgentEnv,loginEnvironment,detectAgent,resolveAgent,compareVersions,claudeVersionFromFiles};
