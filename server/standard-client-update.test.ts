import pkg from '../package.json' with {type:'json'};
const nextVersion=pkg.version.split('.').map((n,i)=>i===2?String(Number(n)+1):n).join('.');
const laterVersion=pkg.version.split('.').map((n,i)=>i===2?String(Number(n)+2):n).join('.');
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {newer,releaseOf,clientHeaders,updateView,dismissUpdate} from './standard/client-update.ts';
import metadata from '../desktop/windows-version.json' with {type:'json'};
const dmg=(version:string,extra:Record<string,unknown>={})=>({kind:'dmg',version,desktopBuild:metadata.windowsBuild,notes:'hello',arch:'arm64',url:`https://github.com/saf1102/opentake-standard/releases/download/desktop-v${version}-${metadata.windowsBuild}/OpenTake-Standard-${version}-mac-arm64.dmg`,sha256:'0'.repeat(64),size:1000,...extra});
test('numeric versions, release validation, install identity and reminder suppression',()=>{const old=process.env.OPENTAKE_STANDARD_USER_DATA;const root=fs.mkdtempSync(path.join(os.tmpdir(),'standard-version-'));process.env.OPENTAKE_STANDARD_USER_DATA=root;try{
 assert.equal(newer('1.0.10','1.0.9'),true);assert.equal(newer('1.0.9','1.0.10'),false);
 assert.equal(releaseOf(dmg(nextVersion,{url:'http://bad'})),null);assert.equal(releaseOf(dmg(nextVersion,{size:0})),null);assert.equal(releaseOf(dmg(nextVersion,{arch:'ia32'})),null);
 // A backend source-ZIP release (the shape before 1.1.3) is ignored rather than offered.
 assert.equal(releaseOf({version:nextVersion,notes:'hello',url:'https://example.test/source.zip',sha256:'0'.repeat(64)}),null);
 const h=clientHeaders(true);assert.match(h['X-OpenTake-Install']!,/^[0-9a-f-]{36}$/);assert.equal(clientHeaders(true)['X-OpenTake-Install'],h['X-OpenTake-Install']);
 const r=dmg(nextVersion);assert.equal(updateView(r).notify,true);dismissUpdate('skip');assert.equal(updateView(r).notify,false);assert.equal(updateView(dmg(laterVersion)).notify,true);dismissUpdate('later');assert.equal(updateView().notify,false);assert.equal(updateView(undefined,true).notify,true);
 // Same version: only a newer desktop build is an update.
 assert.equal(updateView(dmg(pkg.version)).available,false);assert.equal(updateView(dmg(pkg.version,{desktopBuild:metadata.windowsBuild+1})).available,true);
 assert.equal(updateView(null).available,false);
}finally{if(old===undefined)delete process.env.OPENTAKE_STANDARD_USER_DATA;else process.env.OPENTAKE_STANDARD_USER_DATA=old;fs.rmSync(root,{recursive:true,force:true})}});
