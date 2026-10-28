import {createRequire} from 'node:module';
const {allowedSource}=createRequire(import.meta.url)('../../desktop/update-source.cjs') as {allowedSource:(value:string,testOrigin?:string)=>boolean};
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';
import platform from '../platform.ts';
import pkg from '../../package.json' with {type:'json'};
export const clientVersion=pkg.version;
export type Release={version:string;notes:string;url:string;sha256:string;publishedAt?:string};
export function releaseOf(value:unknown):Release|null{
 const v=value as Partial<Release>|undefined;
 if(!v||!/^\d+\.\d+\.\d+$/.test(v.version||'')||typeof v.notes!=='string'||typeof v.url!=='string'||!allowedSource(v.url,process.env.OPENTAKE_UPGRADE_TEST_URL)||!/^\w{64}$/.test(v.sha256||'')||!/^[a-f0-9]{64}$/i.test(v.sha256||''))return null;
 try{const u=new URL(v.url);if(u.username||u.password)return null;}catch{return null}
 return {version:v.version!,notes:v.notes.slice(0,16000),url:v.url,sha256:v.sha256!,...(typeof v.publishedAt==='string'?{publishedAt:v.publishedAt}:{})};
}
export function newer(a:string,b:string){if(!/^\d+\.\d+\.\d+$/.test(a)||!/^\d+\.\d+\.\d+$/.test(b))return false;const x=a.split('.').map(BigInt),y=b.split('.').map(BigInt);for(let i=0;i<3;i++){if(x[i]!==y[i])return x[i]>y[i]}return false}
const file=()=>path.join(platform.standardDataRoot(),'standard-update.json');
type State={install?:string;skip?:string;later?:string;release?:Release};
function read():State{try{return JSON.parse(fs.readFileSync(file(),'utf8'))}catch{return {}}}
function write(v:State){fs.mkdirSync(path.dirname(file()),{recursive:true});const tmp=file()+'.tmp';fs.writeFileSync(tmp,JSON.stringify(v),{mode:0o600});fs.renameSync(tmp,file())}
export function installId(){const s=read();if(!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(s.install||'')){s.install=crypto.randomUUID();write(s)}return s.install!}
export function clientHeaders(withInstall=false){return {'X-OpenTake-Client':`standard/${clientVersion}`,...(withInstall?{'X-OpenTake-Install':installId()}:{})}}
export function updateView(release?:unknown,manual=false){const s=read();if(release!==undefined){s.release=releaseOf(release)||undefined;write(s)}const r=s.release;return {currentVersion:clientVersion,release:r??null,available:!!r&&newer(r.version,clientVersion),notify:!!r&&newer(r.version,clientVersion)&&(manual||(s.skip!==r.version&&s.later!==new Date().toLocaleDateString('en-CA')))}}
export function dismissUpdate(action:string){const s=read();if(action==='skip')s.skip=s.release?.version;else if(action==='later')s.later=new Date().toLocaleDateString('en-CA');else throw Error('无效操作');write(s);return updateView()}
