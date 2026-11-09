import {createRequire} from 'node:module';
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';
import platform from '../platform.ts';
import pkg from '../../package.json' with {type:'json'};
import metadata from '../../desktop/windows-version.json' with {type:'json'};
const require=createRequire(import.meta.url);
const {allowedSource}=require('../../desktop/update-source.cjs') as {allowedSource:(value:string,testOrigin?:string)=>boolean};
type MacFeed={installers:Record<string,unknown>}&Record<string,unknown>;
const mac=require('../../desktop/mac-update-manifest.cjs') as {endpoint:string;macRelease:(v:unknown,testOrigin?:string)=>MacFeed|null;macInstallerRelease:(r:MacFeed|null,arch:string)=>Release|null;newerBuild:(r:{version:string;desktopBuild:number},v:string,b:number)=>boolean};
const {macTranslated}=require('../../desktop/platform.cjs') as {macTranslated:()=>boolean};
export const clientVersion=pkg.version;
export const clientBuild=metadata.windowsBuild;
/** One Mac installer from the GitHub release feed (or the same feed mirrored by the backend). */
export type Release={kind:'dmg';version:string;desktopBuild:number;notes:string;arch:'arm64'|'x64';url:string;sha256:string;size:number};
const loopback=(value?:string)=>/^http:\/\/127\.0\.0\.1:\d+$/.test(value||'');
/** Loopback-only test feed: http://127.0.0.1:<port>/mac-update.json. */
export function macTestFeed(){const value=process.env.OPENTAKE_MAC_UPDATE_TEST_URL;if(!value)return undefined;if(!/^http:\/\/127\.0\.0\.1:\d+\/mac-update\.json$/.test(value))throw Error('Mac 更新测试源必须是本机地址');return value}
export function testOrigin(){const feed=macTestFeed();if(feed)return new URL(feed).origin;const legacy=process.env.OPENTAKE_UPGRADE_TEST_URL;return loopback(legacy)?legacy:undefined}
export function releaseOf(value:unknown):Release|null{
 const v=value as Partial<Release>|undefined;
 if(!v||v.kind!=='dmg'||!['arm64','x64'].includes(v.arch||'')||!/^\d+\.\d+\.\d+$/.test(v.version||'')||!Number.isSafeInteger(v.desktopBuild)||(v.desktopBuild as number)<1||typeof v.notes!=='string'||typeof v.url!=='string'||!allowedSource(v.url,testOrigin())||!/^[a-f0-9]{64}$/i.test(v.sha256||'')||!Number.isSafeInteger(v.size)||(v.size as number)<1)return null;
 try{const u=new URL(v.url);if(u.username||u.password)return null}catch{return null}
 return {kind:'dmg',version:v.version!,desktopBuild:v.desktopBuild!,notes:v.notes.slice(0,16000),arch:v.arch!,url:v.url,sha256:v.sha256!.toLowerCase(),size:v.size!};
}
export function newer(a:string,b:string){if(!/^\d+\.\d+\.\d+$/.test(a)||!/^\d+\.\d+\.\d+$/.test(b))return false;const x=a.split('.').map(BigInt),y=b.split('.').map(BigInt);for(let i=0;i<3;i++){if(x[i]!==y[i])return x[i]>y[i]}return false}
/** Native chip of this Mac; an Intel build under Rosetta is offered the Apple Silicon installer. */
export function nativeArch():'arm64'|'x64'{if(process.arch==='x64'){try{if(macTranslated())return 'arm64'}catch{/* keep x64 */}}return process.arch==='arm64'?'arm64':'x64'}
async function smallJson(url:string){
 const r=await fetch(url,{credentials:'omit',referrerPolicy:'no-referrer',cache:'no-store',headers:{Accept:'application/json'},signal:AbortSignal.timeout(10000)});
 if(!r.ok)throw Error('HTTP '+r.status);if(Number(r.headers.get('content-length'))>65536)throw Error('清单过大');
 const text=await r.text();if(text.length>65536)throw Error('清单过大');return JSON.parse(text);
}
/**
 * GitHub's latest release is the source of truth. The backend mirror (upgrade.json standard.mac) only
 * helps networks where GitHub is unreachable. undefined means both were unavailable (offline).
 */
export async function macFeed(backend?:{mac?:unknown}|null,arch=nativeArch()):Promise<Release|null|undefined>{
 const origin=testOrigin();
 try{const feed=mac.macRelease(await smallJson(macTestFeed()||mac.endpoint),origin);if(feed)return mac.macInstallerRelease(feed,arch)}catch{/* try the mirror */}
 if(backend&&typeof backend==='object'&&'mac' in backend){const feed=mac.macRelease(backend.mac,origin);if(feed)return mac.macInstallerRelease(feed,arch)}
 return backend===undefined?undefined:null;
}
const file=()=>path.join(platform.standardDataRoot(),'standard-update.json');
type State={install?:string;skip?:string;later?:string;release?:Release};
function read():State{try{return JSON.parse(fs.readFileSync(file(),'utf8'))}catch{return {}}}
function write(v:State){fs.mkdirSync(path.dirname(file()),{recursive:true});const tmp=file()+'.tmp';fs.writeFileSync(tmp,JSON.stringify(v),{mode:0o600});fs.renameSync(tmp,file())}
export function installId(){const s=read();if(!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(s.install||'')){s.install=crypto.randomUUID();write(s)}return s.install!}
export function clientHeaders(withInstall=false){return {'X-OpenTake-Client':`standard/${clientVersion}`,...(withInstall?{'X-OpenTake-Install':installId()}:{})}}
const identity=(r:Release)=>`${r.version}:${r.desktopBuild}`;
export function updateView(release?:unknown,manual=false){const s=read();if(release!==undefined){s.release=releaseOf(release)||undefined;write(s)}const r=s.release&&releaseOf(s.release);const available=!!r&&mac.newerBuild(r,clientVersion,clientBuild);return {currentVersion:clientVersion,currentBuild:clientBuild,release:r||null,available,notify:available&&(manual||(s.skip!==identity(r!)&&s.later!==new Date().toLocaleDateString('en-CA')))}}
export function dismissUpdate(action:string){const s=read();const r=s.release&&releaseOf(s.release);if(action==='skip')s.skip=r?identity(r):undefined;else if(action==='later')s.later=new Date().toLocaleDateString('en-CA');else throw Error('无效操作');write(s);return updateView()}
