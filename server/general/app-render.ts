/** App export adapter. The kit retains its standalone renderer; only its scene and audio specification are shared. */
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {renderVideo, type Composition} from '../frame-render/index.ts';
import {h264Encode} from '../editor/video-encode.ts';
import {KIT_DIR} from './kit-env.ts';
import type {Film2} from './layers.ts';

const mime:Record<string,string>={
 '.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8',
 '.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.txt':'text/plain; charset=utf-8',
 '.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.gif':'image/gif','.svg':'image/svg+xml',
 '.ttf':'font/ttf','.otf':'font/otf','.woff':'font/woff','.woff2':'font/woff2','.mp4':'video/mp4','.webm':'video/webm',
 '.mov':'video/quicktime','.wav':'audio/wav','.mp3':'audio/mpeg','.m4a':'audio/mp4','.glb':'model/gltf-binary',
 '.gltf':'model/gltf+json','.wasm':'application/wasm','.csv':'text/csv; charset=utf-8',
};
const json=(x:unknown)=>JSON.stringify(x).replace(/</g,'\\u003c');
export async function renderAppFilm(film:Film2,work:string,options:{pageId?:string;textId?:string;onProgress?:(fraction:number)=>void;cancelSignal?:AbortSignal;concurrency?:number}={}){
 options.cancelSignal?.throwIfAborted();
 // Use the same defaults and source-duration normalization as standalone kit exports.
 const {readFilm}=await import(pathToFileURL(path.join(KIT_DIR,'lib/film.mjs')).href);
 film=readFilm(work);
 const started=performance.now();
 const lib=await import(pathToFileURL(path.join(KIT_DIR,'lib/compose.mjs')).href);
 const assets=await import(pathToFileURL(path.join(KIT_DIR,'lib/browser.mjs')).href);
 const text=options.textId===undefined?undefined:film.text.find(c=>c.id===options.textId);
 if(options.textId!==undefined&&!text)throw Error(`找不到文字「${options.textId}」`);
 const single=options.pageId!==undefined||Boolean(text),finish=options.pageId==='__finish';
 const clip=single?(text?{...text,layer:'overlay',page:'',edits:undefined}:finish?{id:'__finish',start:0,end:film.duration,layer:'overlay',page:'',edits:undefined}:film.picture.find(c=>c.id===options.pageId)):undefined;
 if(single&&!clip)throw Error(`找不到画面页「${options.pageId}」`);
 if(finish&&film.finish==='grain')throw Error('grain 使用叠加混合，无法用普通透明视频准确表达');
 const alpha=single&&clip!.layer==='overlay';
 const spec=text?await lib.composeSpec({...film,picture:[],footage:[],finish:'none',text:[text]}):single&&!finish?{page:clip!.page,query:''}:await lib.composeSpec(finish?{...film,picture:[],footage:[],text:[]}:film);
 const prepared=performance.now();
 const comp:Composition={id:'GeneralFilm',width:film.width,height:film.height,fps:film.fps,durationInFrames:Math.max(1,(text?Math.ceil:Math.round)((single?clip!.end-clip!.start:film.duration)*film.fps-(text?1e-7:0)))};
 const pageUrl='/'+spec.page.split('/').map(encodeURIComponent).join('/')+(spec.query?'?'+spec.query:'');
 const adapter=`<script>
 let failure;window.addEventListener('error',e=>failure=Error(e.message));
 const ready=(async()=>{const w=window;const until=Date.now()+30000;while(!(w.shot&&typeof w.shot.frame==='function')&&!(typeof w.render==='function'&&w.READY===true)){if(Date.now()>until)throw Error('画面页没有准备好');await new Promise(r=>setTimeout(r,10))}await w.document.fonts.ready;await w.shot?.ready;
 const edits=JSON.parse(${json(JSON.stringify(clip?.edits||{}))});for(const [name,text]of Object.entries(edits)){const nodes=[...w.document.querySelectorAll('[data-edit]')].filter(e=>e.getAttribute('data-edit')===name);if(!nodes.length)throw Error('这处修改已失效：找不到 data-edit「'+name+'」');nodes.forEach(e=>e.textContent=text)}
 ${finish||text?`const style=w.document.createElement('style');style.textContent='html,body,#stage{background:transparent!important}#footage,#pages${text?'':',#text'}{display:none!important}';w.document.head.append(style);`:''}
 })();void ready.catch(()=>{});
 window.__otRender={async select(){await ready;return ${json(comp)}},async seek(frame){await ready;const w=window;if(w.shot)await w.shot.frame(frame/${film.fps}+${text?Math.ceil(text.start*film.fps-1e-7)/film.fps:0});else await w.render(frame/${film.fps}+${text?Math.ceil(text.start*film.fps-1e-7)/film.fps:0});if(failure)throw failure;}};
 </script>`;
 const entry=new URL(pageUrl,'http://ot-render.localhost');
 const assetResolver=async(pathname:string)=>{const file=assets.resolveRequest(pathname);if(!file)throw Error('不允许读取画面资源：'+pathname);let body:Buffer;try{body=await fs.promises.readFile(file)}catch{throw Error('找不到或无法读取画面资源：'+pathname)}if(pathname===entry.pathname)body=Buffer.concat([body,Buffer.from(adapter)]);return{body,contentType:mime[path.extname(file).toLowerCase()]||'application/octet-stream'}};
 const output=single?path.join(work,text?'out/text':'out/pages',clip!.id+(alpha?'.mov':'.mp4')):path.join(work,'out/video.mp4');
 fs.mkdirSync(path.join(work,'.tmp'),{recursive:true});const scratch=fs.mkdtempSync(path.join(work,'.tmp','app-render-'));const raw=path.join(scratch,alpha?'raw.mov':'raw.mp4');
 try{
  // compose.shot.frame already awaits image decoding and a paint frame. Authored pages retain the default resource settling.
  await renderVideo({serveUrl:work,entryPath:pageUrl,assetResolver,resourcePaintFrames:single&&!text?2:0,composition:comp,codec:alpha?'prores':'h264',imageFormat:alpha?'png':'jpeg',jpegQuality:95,videoQuality:70,proResQuality:alpha?9:undefined,outputLocation:raw,concurrency:options.concurrency??6,cancelSignal:options.cancelSignal,onProgress:p=>options.onProgress?.(p.progress)});
  const captured=performance.now();
  fs.mkdirSync(path.dirname(output),{recursive:true});
  if(single)fs.renameSync(raw,output);else await lib.finishPicture(film,raw,output,[...h264Encode({fps:film.fps,quality:70,allowSoftware:true}),'-r',String(film.fps)]);
  options.cancelSignal?.throwIfAborted();
  if(process.env.CW_RENDER_TRACE)console.log(JSON.stringify({prepareMs:prepared-started,captureEncodeMs:captured-prepared,finishMs:performance.now()-captured}));
  return output;
 }catch(e){fs.rmSync(output,{force:true});throw e;}finally{fs.rmSync(scratch,{recursive:true,force:true});}
}
