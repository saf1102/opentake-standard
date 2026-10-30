import {buildGeneralDraft,flatGeneralDraft} from './export-draft.ts';
import {encodeExportMedia} from './export-media.ts';
import type {ExportSettings} from '../../src/types/editor.ts';
/** Runs outside the agent sandbox, in one disposable export directory. */
import fs from 'node:fs';
import {renderAppFilm} from './app-render.ts';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { KIT_DIR, ffmpegPath, ffprobePath } from './kit-env.ts';
import { deliverVideo } from './runner.ts';
import { prepareJianyingAlpha } from '../editor/jianying/alpha-media.ts';
import { writePortableJianyingImporters } from '../editor/jianying-portable.ts';
import { volumeDb, type Film2 } from './layers.ts';
import { renderHyperframes } from './hf-render.ts';
import { hfPageEdits, type GeneralLayers } from '../../src/general/general-contract.ts';
const exec = promisify(execFile);
const [output, format, name] = process.argv.slice(2);
const work = path.join(output, 'work');
const progress = (step: string, n: number) => console.log(`EXPORT:${JSON.stringify({ step, progress: n })}`);
const run = async (bin: string, args: string[]) => {
  try { return await exec(bin, args, { cwd: work, env: process.env, timeout: 3_600_000, maxBuffer: 8 << 20 }); }
  catch (e) { const x = e as { stderr?: string; message?: string }; throw new Error((x.stderr || x.message || '工具运行失败').slice(-5000)); }
};
const filmCommand = (...args: string[]) => run(process.execPath, [path.join(KIT_DIR, 'film.mjs'), ...args]);
const ff = (args: string[]) => run(ffmpegPath(), ['-v','error','-y',...args]);
try {
  const request=JSON.parse(fs.readFileSync(path.join(output,'request.json'),'utf8')) as {settings:ExportSettings;kind:string;media:{width:number;height:number;fps:number;duration:number}};
  const {settings,kind,media}=request;
  const layers=fs.existsSync(path.join(output,'layers.json'))?JSON.parse(fs.readFileSync(path.join(output,'layers.json'),'utf8')) as GeneralLayers:undefined;
  const fps=format==='jianying'?media.fps:typeof settings.fps==='number'?settings.fps:media.fps;
  let source=path.join(work,'out.mp4');
  if(kind==='hyperframes') {
    progress('渲染画面',.05);
    await renderHyperframes(work,source,{fps,edits:layers?hfPageEdits(layers):undefined,onProgress:p=>progress('渲染画面',.05+.8*p)});
  } else if(kind==='film') {
    progress('检查分轨和页面',.05);await filmCommand('check');
    if(format==='jianying'){await jianying();source='';}
    else {
      const film=JSON.parse(fs.readFileSync(path.join(work,'film.json'),'utf8')) as Film2;
      await renderAppFilm(film,work,{onProgress:p=>progress('渲染画面和转场',.15+.6*p)});
      progress('混合声音',.8);await filmCommand('mux');
    }
  } else source=path.join(work,'source.mp4');
  if(source) {
    if(format==='jianying')await flatGeneralDraft(source,path.join(output,'剪映工程'),name,media);
    else {
      progress('编码成片',.9);
      const result=await encodeExportMedia(source,path.join(output,`成片.${settings.video.codec==='prores422'?'mov':settings.video.container}`),settings);
      console.log(`EXPORT:${JSON.stringify({media:{width:result.width,height:result.height,fps:result.fps}})}`);
    }
  }
} catch (error) { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; }

async function jianying() {
  const film = JSON.parse(fs.readFileSync(path.join(work, 'film.json'),'utf8')) as Film2;
  const folder = path.join(output, '剪映工程'), res = path.join(folder, 'Resources');
  fs.mkdirSync(res, { recursive: true });
  const us = (x: number) => Math.round(x * 1e6);
  const span = (c: { start: number; end?: number }) => ({ start: us(c.start), duration: us(c.end!)-us(c.start) });
  // copy-on-write clones (APFS), as the 口播 package does; a plain copy where the volume cannot clone
  const copy = (source: string, file: string) => { fs.copyFileSync(source, path.join(res,file), fs.constants.COPYFILE_FICLONE); return file; };
  // one file per source, shared by every clip cut from it (as the 口播 package keeps one material per asset)
  const once = (source: string, file: string) => fs.existsSync(path.join(res, file)) ? file : copy(source, file);
  const warnings: string[] = [];
  const general: Record<string, unknown> = { film };
  const footage = [];
  for (const c of film.footage) {
    const source = path.join(output,'media',c.media);
    const info = JSON.parse((await run(ffprobePath(), ['-v','error','-show_streams','-of','json',source])).stdout);
    const video = info.streams.find((s: {codec_type:string}) => s.codec_type === 'video');
    if (!video) throw new Error(`素材 ${c.media} 没有视频画面`);
    footage.push({ ...span(c), file: once(source,`footage-${path.parse(c.media).name}${path.extname(source)}`), sourceStart: us(c.in), sourceDuration: us((c.end-c.start)*c.speed), reverse: c.reverse, fit: c.fit, focus: c.focus, width:video.width,height:video.height });
    if (c.move) warnings.push(`素材 ${c.id} 的 move 运镜暂未映射为剪映关键帧，保留静态 fit/focus；MP4 保留完整运镜。`);
  }
  general.footage = footage;
  const picture = [];
  for (const [i,c] of film.picture.entries()) {
    progress(`渲染独立画面页 ${i+1}/${film.picture.length}`, .2+.4*i/Math.max(1,film.picture.length));
    await renderAppFilm(film,work,{pageId:c.id});
    const ext = c.layer === 'overlay' ? '.mov' : '.mp4', filename=`page-${c.id}${ext}`;
    const source = path.join(work,'out','pages',c.id+ext);
    if (c.layer === 'overlay') prepareJianyingAlpha(source,path.join(res,filename),path.join(work,'.tmp','alpha'));
    else await deliverVideo(source,path.join(res,filename));
    picture.push({...span(c),file:filename});
  }
  general.picture = picture;
  const textVideos = [];
  for (const [i,c] of film.text.entries()) {
    progress(`渲染独立文字 ${i+1}/${film.text.length}`, .6+.15*i/Math.max(1,film.text.length));
    const source = await renderAppFilm(film,work,{textId:c.id});
    const file=`text-${c.id}.mov`;
    prepareJianyingAlpha(source,path.join(res,file),path.join(work,'.tmp','alpha'));
    textVideos.push({...span(c),file});
  }
  general.textVideos = textVideos;
  warnings.push('文字是渲染出来的画面，要改字回 OpenTake 改。');
  for (const kind of ['voice','music','sfx'] as const) {
    const clips = [];
    for (const c of film[kind]) {
      const duration = c.end! - c.start, file = `${kind}-${c.id}.wav`;
      const fades = [];
      if(c.start === 0 && film.segments[0].transition === 'fade') fades.push('afade=t=in:st=0:d=0.5');
      if(c.end === film.duration && film.ending === 'fade') fades.push(`afade=t=out:st=${Math.max(0,duration-.5)}:d=0.5`);
      // Like MP4, a longer edited clip has silence after EOF, never stretched audio.
      await ff(['-i',path.join(work,c.src),'-vn','-af', [`atrim=start=${c.in}:duration=${duration}`,'asetpts=PTS-STARTPTS','apad',`atrim=duration=${duration}`,...fades].join(','),'-ar','48000','-ac','2',path.join(res,file)]);
      clips.push({...span(c),file,sourceStart:0,gain:10**(volumeDb(c.volume)/20)});
    }
    general[kind] = clips;
  }
  // Source audio is kept separate from the editable video transform.
  const sourceAudio = [];
  for (const c of film.footage.filter(c => c.sound)) {
    const file=`source-audio-${c.id}.wav`,tempo:string[]=[], fades:string[]=[];
    if(c.start===0&&film.segments[0].transition==='fade')fades.push('afade=t=in:st=0:d=0.5');
    if(c.end===film.duration&&film.ending==='fade')fades.push(`afade=t=out:st=${Math.max(0,c.end-c.start-.5)}:d=0.5`);
    for(let s=c.speed;Math.abs(s-1)>1e-6;){const n=Math.min(2,Math.max(.5,s));tempo.push(`atempo=${n}`);s/=n;}
    await ff(['-ss',String(c.in),'-t',String((c.end-c.start)*c.speed),'-i',path.join(output,'media',c.media),'-vn','-af',[...(c.reverse?['areverse']:[]),...tempo,'apad',`atrim=duration=${c.end-c.start}`,...fades].join(','),'-ar','48000','-ac','2',path.join(res,file)]);
    sourceAudio.push({...span(c),file,gain:10**(volumeDb(c.volume)/20)});
  }
  general.source = sourceAudio;
  if(film.finish!=='none') {
    if(film.finish==='grain') warnings.push('grain 的 overlay 混合不能用普通透明素材准确表示，剪映未添加此效果；MP4 保留。');
    else { await renderAppFilm(film,work,{pageId:'__finish'}); const file='finish.mov';prepareJianyingAlpha(path.join(work,'out','pages','__finish.mov'),path.join(res,file),path.join(work,'.tmp','alpha'));general.finish=[{start:0,duration:us(film.duration),file}]; }
  }
  if(film.segments.some(s=>s.transition!=='cut')) warnings.push('剪映原生叠化/闪黑/闪白仅用于相邻素材边界；跨画面页和文字的全合成转场、段间 fade 暂不能与 MP4 完全一致。');
  if(film.music.length && film.voice.length) warnings.push('剪映保留分轨音量，未烘焙 MP4 的旁白压低配乐处理。');
  await ff(['-f','lavfi','-i',`color=black:s=${film.width}x${film.height}`,'-frames:v','1',path.join(res,'background.png')]);
  fs.writeFileSync(path.join(folder,'handoff.json'),JSON.stringify({name,duration:us(film.duration),settings:{width:film.width,height:film.height,fps:film.fps},videos:[],cards:[],subtitles:[],sfx:[],audio:{},generalLayers:general}));
  progress('生成剪映可编辑轨道',.85);
  await buildGeneralDraft(folder);
  fs.writeFileSync(path.join(folder,'通用剪辑兼容说明.txt'),warnings.join('\n'));

}
