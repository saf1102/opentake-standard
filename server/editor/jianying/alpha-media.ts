import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {materializeRenderCache} from '../render-cache-files.ts';

/** Jianying 11.3 composites imported ProRes as associated (premultiplied) alpha.
 * Our browser/MP4 cache is straight alpha: never rewrite it in place. */
export function prepareJianyingAlpha(source:string, output:string, cacheDir:string) {
  const stat=fs.statSync(source);
  const key=crypto.createHash('sha256').update(JSON.stringify({version:'associated-alpha-ks8-q9-v3',source,size:stat.size,mtime:stat.mtimeMs})).digest('hex');
  fs.mkdirSync(cacheDir,{recursive:true});
  const cached=path.join(cacheDir,`${key}.mov`);
  // A valid one-frame test clip can be smaller than the generic 1 KiB render
  // cache threshold. Probe this encoder cache by presence and nonzero size.
  if(!fs.existsSync(cached) || fs.statSync(cached).size === 0) {
    const temporary=`${cached}.${process.pid}.tmp.mov`;
    try {
      execFileSync('ffmpeg',['-v','error','-y','-i',source,'-an',
        '-vf','format=gbrap,premultiply=inplace=1,scale=out_color_matrix=bt709,format=yuva444p10le',
        // Render caches originate in 8-bit RGBA. Keeping 16-bit alpha in the
        // Jianying-only copy adds no edge detail and inflates every frame.
        '-c:v','prores_ks','-profile:v','4','-pix_fmt','yuva444p10le','-alpha_bits','8','-qscale:v','9',
        '-bsf:v','prores_metadata=color_primaries=1:color_trc=13:colorspace=1',
        '-color_primaries','bt709','-color_trc','iec61966-2-1','-colorspace','bt709','-movflags','+write_colr',temporary],
        {timeout:3_600_000,stdio:'pipe'});
      fs.renameSync(temporary,cached);
      // prores_ks resets MOV colour context. The local remux below must finish
      // before writing the marker; codec BSF flags alone are not sufficient.
    } finally {fs.rmSync(temporary,{force:true});}
  }
  // VideoToolbox may discard encoder color flags. Tag the completed stream,
  // including older associated-alpha cache entries, with a lossless remux.
  const marker=`${cached}.srgb`;
  if(!fs.existsSync(marker)) {
    const tagged=`${cached}.${process.pid}.tagged.mov`;
    try {
      execFileSync('ffmpeg',['-v','error','-y','-i',cached,'-map','0:v:0','-c:v','copy',
        '-bsf:v','prores_metadata=color_primaries=1:color_trc=13:colorspace=1',
        '-color_primaries','bt709','-color_trc','iec61966-2-1','-colorspace','bt709',
        '-movflags','+write_colr',tagged],{timeout:300_000,stdio:'pipe'});
      fs.renameSync(tagged,cached);
      fs.writeFileSync(marker,'sRGB / BT709');
    } finally {fs.rmSync(tagged,{force:true});}
  }
  materializeRenderCache(cached,output);
  return output;
}
