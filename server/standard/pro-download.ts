import {createRequire} from 'node:module';
export type ProDownloadPlatform='darwin-arm64'|'win32-x64';
const policy=createRequire(import.meta.url)('../../desktop/pro-download.cjs');
export const proDownloadPlatform:(os?:NodeJS.Platform,arch?:string)=>ProDownloadPlatform=policy.proDownloadPlatform;
export const proDownloadUrl:(value:Record<string,unknown>,origin:string,target:ProDownloadPlatform,testOrigin?:string,now?:number)=>string=policy.proDownloadUrl;
