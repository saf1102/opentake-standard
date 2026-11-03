/** Film text roles → the same native subtitle builder used by the spoken editor. */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { KIT_DIR, fontDirs } from './kit-env.ts';
import type { Film2 } from './layers.ts';

type Preset = Record<string, unknown> & { roles?: string[]; size?: number };
const BOX: Record<string, [number, number, number]> = { bottom: [.5, 1, .84], top: [.5, 0, .84], center: [.5, .5, .84], 'lower-left': [0, 1, .6], 'lower-right': [1, 1, .6], 'upper-left': [0, 0, .6], 'upper-right': [1, 0, .6], left: [0, .5, .6], right: [1, .5, .6] };
const number = (value: unknown, fallback: number) => typeof value === 'number' && Number.isFinite(value) ? value : fallback;
const string = (value: unknown, fallback: string) => typeof value === 'string' ? value : fallback;
/** Presets may carry CSS rgba, while the native text builder expects hex plus fill alpha. */
function textColor(value: string) {
  const rgba = value.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/i);
  if (rgba) return { color: '#' + rgba.slice(1, 4).map(n => Math.max(0, Math.min(255, Math.round(Number(n)))).toString(16).padStart(2, '0')).join(''), colorAlpha: rgba[4] === undefined ? 1 : Math.max(0, Math.min(1, Number(rgba[4]))) };
  if (/^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i.test(value)) return { color: value, colorAlpha: 1 };
  throw Error(`字幕颜色「${value}」无法映射，需先使用 RGB、RGBA 或十六进制颜色`);
}
export type GeneralCaption = {
  id: string; text: string; start: number; duration: number;
  generalStyle: Record<string, unknown>;
  runs: { start: number; end: number; color?: string; underline?: boolean }[];
};

/** Role partition retains original painter order, including overlapping subtitle cues. */
export function splitJianyingText(film: Film2) {
  return {
    captions: film.text.flatMap((item, renderOrder) => item.role === 'caption' ? [{ item, renderOrder }] : []),
    textVideos: film.text.flatMap((item, renderOrder) => item.role !== 'caption' ? [{ item, renderOrder }] : []),
  };
}

/** Typography uses the very same presets and role/size adjustments as kit/web/text.js. */
export async function generalJianyingCaptions(film: Film2, resources: string, styleId = process.env.CW_STYLE) {
  process.env.CW_FONT_DIRS ||= fontDirs().join(path.delimiter);
  const { textPresets } = await import(pathToFileURL(path.join(KIT_DIR, 'lib/compose.mjs')).href) as { textPresets: (style?: string) => { all: Record<string, Preset> } };
  const { presetForRole, SIZE_FACTOR, accentRuns } = await import(pathToFileURL(path.join(KIT_DIR, 'web/text.js')).href) as {
    presetForRole: (preset: Preset, role: string) => Preset; SIZE_FACTOR: Record<string, number>;
    accentRuns: (text: string) => { text: string; accent?: boolean }[];
  };
  const { listFonts, resolveRequest } = await import(pathToFileURL(path.join(KIT_DIR, 'lib/browser.mjs')).href) as { listFonts: () => { name: string; url: string }[]; resolveRequest: (url: string) => string | undefined };
  const { all } = textPresets(styleId);
  const available = new Map(listFonts().map(font => [font.name, resolveRequest(font.url)]));
  const warnings: string[] = [], subtitles: GeneralCaption[] = [], mappings: Record<string, unknown>[] = [];
  const defaults: Record<string, string> = { 'Noto Sans SC': 'NotoSansSCwght.ttf', 'Noto Serif SC': 'NotoSerifSC[wght].ttf' };
  const packaged = new Map<string, string>();
  const copyFont = (file?: string) => {
    if (!file || !/\.(?:ttf|otf|ttc)$/i.test(file) || !fs.existsSync(file)) return undefined;
    if (packaged.has(file)) return packaged.get(file);
    // A stable filename inside Resources; never refer back to a machine font folder.
    const dest = `caption-font-${packaged.size}-${path.basename(file)}`;
    fs.copyFileSync(file, path.join(resources, dest), fs.constants.COPYFILE_FICLONE);
    packaged.set(file, dest); return dest;
  };
  let systemFonts: string[] | undefined;
  const systemFont = (family: string) => {
    if(process.platform==='win32'){
      const names:Record<string,string[]>={'Kaiti SC':['simkai.ttf'],'Songti SC':['simsun.ttc'],'PingFang SC':['msyh.ttc','msyh.ttf'],'Noto Sans SC':['msyh.ttc','msyh.ttf']};
      const dirs=[path.join(process.env.SystemRoot||'C:\\Windows','Fonts'),...fontDirs()];
      for(const name of names[family]||[])for(const dir of dirs){const file=path.join(dir,name);if(fs.existsSync(file))return file;}
      return undefined;
    }
    const filenames: Record<string, string[]> = { 'Kaiti SC': ['Kaiti.ttc', 'STKaiti.ttf'], 'Songti SC': ['Songti.ttc'], 'PingFang SC': ['PingFang.ttc'] };
    const names = filenames[family] ?? [];
    for (const name of names) {
      const local = available.get(name) ?? path.join('/System/Library/Fonts/Supplemental', name);
      if (fs.existsSync(local)) return local;
    }
    systemFonts ??= [...fs.globSync('/System/Library/AssetsV2/com_apple_MobileAsset_Font*/*.asset/AssetData/*')];
    return systemFonts.find(file => names.includes(path.basename(file)));
  };
  for (const { item, renderOrder } of splitJianyingText(film).captions) {
    const source = all[item.preset];
    if (!source) throw Error(`字幕「${item.id}」的风格预设「${item.preset}」不存在，无法导出对应样式`);
    const preset = presetForRole(source, 'caption');
    const short = Math.min(film.width, film.height), margin = .07 * short;
    const fontSizePx = number(preset.size, .042) * short * (SIZE_FACTOR[item.size ?? 'mid'] ?? 1);
    const fontFamily = string(preset.font, 'Noto Sans SC'), fallbackFamily = string(preset.fallback, 'PingFang SC');
    const requestedFont = string(preset.fontFile, defaults[fontFamily] ?? '');
    const primary = available.get(requestedFont) ?? systemFont(fontFamily);
    const exactFallback = systemFont(fallbackFamily);
    const pingfang = exactFallback ? undefined : systemFont('PingFang SC');
    const fallback = exactFallback ?? pingfang ?? available.get(defaults['Noto Sans SC']);
    const resolvedFallbackFamily = exactFallback ? fallbackFamily : pingfang ? 'PingFang SC' : 'Noto Sans SC';
    const fontFile = copyFont(primary), fallbackFontFile = copyFont(fallback);
    if (!fontFile && !fallbackFontFile) throw Error(`字幕「${item.id}」缺少可移交字体：${fontFamily} / ${fallbackFamily}，请安装对应字体后重试；没有丢弃这条字幕`);
    if (!fontFile) warnings.push(`字幕「${item.id}」：未找到可供剪映使用的 ${fontFamily} 字体文件，改用 ${resolvedFallbackFamily}；文字保留。`);
    if (!exactFallback) warnings.push(`字幕「${item.id}」：未找到 ${fallbackFamily} 的可移交字库，中文回退为 ${fallbackFontFile ? resolvedFallbackFamily : fontFamily}，需核对字形。`);
    let text = '', runs: GeneralCaption['runs'] = [];
    // Match text.js brace emphasis, including explicit newlines. Native run offsets are Unicode codepoints.
    for (const [lineIndex, line] of item.text.split('\n').entries()) {
      if (lineIndex) text += '\n';
      for (const part of accentRuns(line)) {
        const value = preset.uppercase ? part.text.toUpperCase() : part.text;
        const start = [...text].length; text += value;
        if (part.accent && value) runs.push({ start, end: [...text].length, color: string(preset.accent, '#ffd23f'), ...(preset.accentStyle === 'underline' ? { underline: true } : {}) });
      }
    }
    const [anchorX, anchorY, maxWidth] = BOX[item.place] ?? BOX.bottom;
    const bar = Boolean(preset.bar), box = Boolean(preset.box || bar);
    const generalStyle = {
      fontSizePx, requestedFontFamily: fontFamily, fontFamily: fontFile ? fontFamily : resolvedFallbackFamily, fontFile: fontFile ?? fallbackFontFile, fallbackFamily: fallbackFontFile ? resolvedFallbackFamily : fontFamily, fallbackFontFile,
      fontWeight: number(preset.weight, 600), italic: Boolean(preset.italic), ...textColor(string(preset.color, '#ffffff')),
      align: string(preset.align, anchorX === 0 ? 'left' : anchorX === 1 ? 'right' : 'center'),
      strokeWidthPx: number(preset.stroke, 0) * fontSizePx, strokeColor: string(preset.strokeColor, '#000000'),
      backgroundColor: box ? string(bar ? preset.barColor : preset.boxColor, bar ? 'rgba(0,0,0,.8)' : 'rgba(0,0,0,.6)') : 'transparent',
      backgroundRadiusEm: number(preset.radius, .22), lineHeight: number(preset.lineHeight, 1.25), tracking: number(preset.tracking, 0),
      rotate: item.rotate ?? 0, shadow: Boolean(preset.shadow), renderOrder,
      layout: { anchorX: bar ? 0 : anchorX, anchorY, x: bar || anchorX === 0 ? margin : anchorX === 1 ? film.width - margin : film.width / 2,
        y: anchorY === 0 ? margin : anchorY === 1 ? film.height - margin * 1.4 : film.height / 2,
        maxWidth: bar ? film.width - 2 * margin : Math.min(maxWidth * film.width, preset.layout === 'content' ? film.width - 2 * margin : Infinity),
        bar, ...(bar ? { fixedWidth: film.width - 2 * margin } : {}), paddingX: box ? fontSizePx * .5 : 0, paddingY: box ? fontSizePx * .18 : 0 },
    };
    const unsupported = [
      ...(item.reveal !== 'none' ? [`${item.reveal} 入退场改为全句静态显示；可在剪映添加字幕动画`] : []),
      ...(preset.vertical ? ['竖排改为同位置横排；可在剪映逐条调整文字方向'] : []),
      ...(preset.rule ? ['装饰线省略；可在剪映加线条贴纸'] : []),
      ...(preset.marker ? ['装饰标记省略；可在剪映加对应形状贴纸'] : []),
      ...(preset.boxBorder ? ['背景边框省略，保留背景填色；可在剪映补边框'] : []),
      ...(preset.boxShadow ? ['背景投影省略；可在剪映补背景阴影'] : []),
      ...(preset.shadow ? ['CSS 文字柔影省略；可在剪映添加文字阴影'] : []),
      ...(preset.accentStyle === 'box' && runs.length ? ['关键词局部底色改为底色色字及下划线；可在剪映补局部底色'] : []),
    ];
    // White words originally on an accent box would disappear on a white page. Underline plus the box color is
    // the nearest portable native emphasis without burning duplicate text or losing the emphasized words.
    if (preset.accentStyle === 'box') runs = runs.map(run => ({ ...run, color: string(preset.accentBox, '#ffd23f'), underline: true }));
    warnings.push(...unsupported.map(detail => `字幕「${item.id}」/${item.preset}：${detail}。`));
    subtitles.push({ id: item.id, start: Math.round(item.start * 1e6), duration: Math.round(item.end * 1e6) - Math.round(item.start * 1e6), text, generalStyle, runs });
    mappings.push({ id: item.id, preset: item.preset, sourcePreset: source, generalStyle, runs, unsupported });
  }
  if (subtitles.length) warnings.push('字幕以剪映原生字幕交付，自动换行、背景包围盒和字体度量由剪映排版；位置按原九宫格锚点和离线字库度量映射，行距、字距、描边宽及圆角为最接近值，需在剪映核对。');
  return { subtitles, warnings, mappings };
}
