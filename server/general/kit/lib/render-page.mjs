import fs from 'node:fs';
import path from 'node:path';
import { WORK } from './env.mjs';
import { openPage } from './browser.mjs';
import { ffmpeg, videoEncoder } from './film.mjs';
import { composeSpec } from './compose.mjs';
import { applyPageEdits, applyPageOverrides } from '../web/page-edits.js';

/** Captures only the authored page; its clock starts at zero. The finish variant
 * uses the same compositor texture as MP4, on a transparent stage. */
export async function renderPage(film, id) {
  const finish = id === '__finish';
  const clip = finish ? { id, start: 0, end: film.duration, layer: 'overlay' } : film.picture.find(p => p.id === id);
  if (!clip) throw new Error(`找不到画面页「${id}」`);
  if (finish && film.finish === 'grain') throw new Error('grain 使用叠加混合，无法用普通透明视频准确表达，请选择其他整片效果');
  const alpha = clip.layer === 'overlay';
  const output = path.join(WORK, 'out', 'pages', `${id}.${alpha ? 'mov' : 'mp4'}`);
  fs.mkdirSync(path.join(WORK, '.tmp'), { recursive: true });
  const temp = fs.mkdtempSync(path.join(WORK, '.tmp', 'page-'));
  let browser;
  try {
    const spec = finish ? await composeSpec({ ...film, picture: [], footage: [], text: [] }) : { page: clip.page };
    const opened = await openPage(spec.page, { w: film.width, h: film.height, query: spec.query });
    browser = opened.browser;
    if (finish) await opened.page.addStyleTag({ content: 'html,body,#stage{background:transparent!important}#footage,#pages,#text{display:none!important}' });
    else {
      const missing = await opened.page.evaluate(({ source, edits }) => (0,eval)(`(${source})`)(document, edits), { source: applyPageEdits.toString(), edits: clip.edits });
      if (missing.length) throw new Error(`这处修改已失效：${clip.page} 找不到 data-edit「${missing.join('、')}」`);
    }
    const count = Math.max(1, Math.round((clip.end - clip.start) * film.fps));
    for (let n = 0; n < count; n++) {
      await opened.draw(n / film.fps);
      if (clip?.overrides) await opened.page.evaluate(({ source, overrides }) => (0,eval)(`(${source})`)(document, overrides), { source: applyPageOverrides.toString(), overrides: clip.overrides });
      await opened.page.screenshot({ path: path.join(temp, `${String(n).padStart(6,'0')}.png`), type: 'png', omitBackground: alpha });
    }
    if (opened.errors.length) throw new Error(`画面页渲染失败：${opened.errors.join('；')}`);
    fs.mkdirSync(path.dirname(output), { recursive: true });
    // Straight-alpha intermediate; Jianying delivery reuses prepareJianyingAlpha.
    const encode = alpha ? ['-c:v','prores_ks','-profile:v','4','-pix_fmt','yuva444p10le','-alpha_bits','8','-qscale:v','9'] : await videoEncoder(film.fps);
    await ffmpeg(['-framerate',String(film.fps),'-i',path.join(temp,'%06d.png'),'-an',...encode,output]);
    return output;
  } catch (error) { fs.rmSync(output, { force: true }); throw error; }
  finally { await browser?.close(); fs.rmSync(temp, { recursive: true, force: true }); }
}
