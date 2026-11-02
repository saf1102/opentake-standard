import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import type {IncomingMessage, ServerResponse} from 'node:http';
import platform from '../platform.ts';
import {atomicJsonSync} from '../file-ops.ts';
import {bodyJson, sendJson} from '../http.ts';
import pkg from '../../package.json' with {type:'json'};
import metadata from '../../desktop/windows-version.json' with {type:'json'};

export type WindowsRelease = {schemaVersion:1; product:string; platform:'win32'; arch:'x64'; channel:'stable'; version:string; windowsBuild:number; revision:string; notes:string; url:string; sha256:string; size:number};
const {endpoint, windowsRelease, newerWindows} = createRequire(import.meta.url)('../../desktop/windows-update-manifest.cjs') as {endpoint:string; windowsRelease:(v:unknown)=>WindowsRelease|null; newerWindows:(r:WindowsRelease, v:string, b:number)=>boolean};
type State = {daily?:boolean; checkedDay?:string; skip?:string; later?:string; release?:WindowsRelease; error?:string};
export function createWindowsUpdater(options:{root?:()=>string; fetcher?:typeof fetch; now?:()=>Date; endpoint?:string} = {}) {
  const file = () => path.join((options.root || platform.standardDataRoot)(), 'standard-windows-update.json');
  const day = () => (options.now?.() || new Date()).toLocaleDateString('en-CA');
  const read = ():State => {try{return JSON.parse(fs.readFileSync(file(),'utf8'))}catch{return {}}};
  const write = (state:State) => {fs.mkdirSync(path.dirname(file()),{recursive:true});atomicJsonSync(file(),state,{mode:0o600})};
  const identity = (r:WindowsRelease) => `${r.version}:${r.windowsBuild}`;
  function view(manual = false) {
    const s = read(), release = windowsRelease(s.release), available = !!release && newerWindows(release,pkg.version,metadata.windowsBuild);
    return {currentVersion:pkg.version,currentBuild:metadata.windowsBuild,mode:'manual' as const,release,available,notify:available && !s.error && (manual || (s.checkedDay===day() && s.skip!==identity(release!) && s.later!==day())),offline:!!s.error,message:s.error||''};
  }
  async function check(manual = false) {
    const state = read();
    if (!manual && (state.daily===false || state.checkedDay===day())) return {skipped:true};
    try {
      const response = await (options.fetcher || fetch)(options.endpoint || endpoint,{credentials:'omit',referrerPolicy:'no-referrer',cache:'no-store',signal:AbortSignal.timeout(10000),headers:{Accept:'application/json'}});
      if (!response.ok) throw Error(response.status===404 ? 'Windows 更新源尚未发布，请稍后再试。' : `暂时无法检查 Windows 更新（HTTP ${response.status}），请稍后重试。`);
      // A manifest is small. Limit both the advertised and actual response size.
      if (Number(response.headers.get('content-length')) > 65536) throw Error('Windows 更新清单过大');
      const reader = response.body?.getReader(); if (!reader) throw Error('Windows 更新清单为空');
      const chunks:Uint8Array[]=[];let bytes=0;
      try {for (;;) {const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>65536)throw Error('Windows 更新清单过大');chunks.push(value)}} finally {await reader.cancel().catch(()=>{})}
      const release = windowsRelease(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      if (!release) throw Error('Windows 更新清单无效，请联系发布者检查安装包信息。');
      // Re-read to preserve preference/dismiss changes made while the request ran.
      const latest=read();latest.release=release;latest.checkedDay=day();delete latest.error;write(latest);
    } catch (error) {
      const latest=read();delete latest.release;delete latest.checkedDay;
      latest.error=error instanceof Error && !['TimeoutError','TypeError','SyntaxError'].includes(error.name)?error.message:'暂时无法检查 Windows 更新，请稍后重试。';write(latest);
    }
    return {clientUpdate:view(manual)};
  }
  return {view,check,preferences:()=>({daily:read().daily!==false}),setDaily:(daily:boolean)=>{const s=read();s.daily=daily;write(s);return {daily}},dismiss:(action:string)=>{const s=read();if(action==='skip'&&s.release)s.skip=identity(s.release);else if(action==='later')s.later=day();else throw Error('无效操作');write(s);return view()}};
}
const local = process.env.OPENTAKE_WINDOWS_UPDATE_TEST_URL;
if (local && !/^http:\/\/127\.0\.0\.1:\d+\/windows-update\.json$/.test(local)) throw Error('Windows 更新测试源必须是本机地址');
const updater=createWindowsUpdater({endpoint:local});
export async function windowsUpdateApi(req:IncomingMessage,res:ServerResponse,route:string) {
  if (req.method==='GET'&&route==='/client') return sendJson(res,200,updater.view());
  if (req.method==='GET'&&route==='/preferences') return sendJson(res,200,updater.preferences());
  if (req.method==='PUT'&&route==='/preferences') {const body=await bodyJson(req);if(typeof body.daily!=='boolean')throw Error('自动检查设置无效');return sendJson(res,200,updater.setDaily(body.daily))}
  if (req.method==='POST'&&route==='/dismiss') {const body=await bodyJson(req);return sendJson(res,200,updater.dismiss(String(body.action)))}
  if (req.method==='GET'&&(route==='/state'||route==='/daily')) return sendJson(res,200,await updater.check(route==='/state'));
  return sendJson(res,404,{error:'Windows 更新接口不存在'});
}
