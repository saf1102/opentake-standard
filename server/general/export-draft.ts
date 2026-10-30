/** Shared single-track draft for versions whose editable source is one complete page or recording. */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {probeExportMedia} from './export-media.ts';
import {ffmpegPath} from './kit-env.ts';
import {writePortableJianyingImporters} from '../editor/jianying-portable.ts';
const exec=promisify(execFile);
export async function buildGeneralDraft(folder:string,signal?:AbortSignal) {
 const python=path.join(os.homedir(),'Library','Application Support','LinkReader','jianying-runtime-0.3.0','bin','python');
 if(!fs.existsSync(python))throw Error('缺少本机剪映导出组件，请先安装离线组件');
 await exec(python,[fileURLToPath(new URL('../editor/jianying/build.py',import.meta.url)),folder],{timeout:3600000,maxBuffer:8<<20,signal});
 writePortableJianyingImporters(folder);
}
export async function flatGeneralDraft(source:string,folder:string,name:string,media:{width:number;height:number;fps:number;duration:number},signal?:AbortSignal) {
 const res=path.join(folder,'Resources');fs.mkdirSync(res,{recursive:true});
 fs.copyFileSync(source,path.join(res,'成片.mp4'),fs.constants.COPYFILE_FICLONE);
 await exec(ffmpegPath(),['-v','error','-y','-f','lavfi','-i',`color=black:s=${media.width}x${media.height}`,'-frames:v','1',path.join(res,'background.png')],{signal});
 const duration=Math.round(media.duration*1e6);
 const audio:Record<string,string>={};
 if((await probeExportMedia(source)).audio){
   await exec(ffmpegPath(),['-v','error','-y','-i',source,'-vn','-c:a','pcm_s16le','-ar','48000','-ac','2',path.join(res,'原片声音.wav')],{signal});
   audio['source-bed']='原片声音.wav';
 }
 fs.writeFileSync(path.join(folder,'handoff.json'),JSON.stringify({name,duration,settings:media,videos:[{file:'成片.mp4',name:'成片.mp4',start:0,duration,sourceStart:0,width:media.width,height:media.height}],cards:[],subtitles:[],sfx:[],audio}));
 await buildGeneralDraft(folder,signal);
 fs.writeFileSync(path.join(folder,'通用剪辑兼容说明.txt'),'这一版以完整成片轨道导入剪映。页面内文字、动效或录屏运镜已合成，需要回 OpenTake 修改。');
}
