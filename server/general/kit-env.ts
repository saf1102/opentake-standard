import type {CreationTools} from '../../shared/creation-tools.ts';
import media from '../media-tools.ts';
import {resolvePython} from './python-runtime.ts';
import {chromium} from 'playwright-core';
/**
 * 出片运行环境：给每个工程的 work/ 准备好固定路径的工具（.opentake/bin 里的 film、node、python3、ffmpeg、ffprobe）
 * 和 Codex 进程的环境变量。只用本机已有的：OpenTake 运行时（无头 Chrome、ffmpeg 8、Python、node_modules）和仓库依赖。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { OFFLINE_PACKAGES, REFUSED_COMMANDS, refusal } from './net-guard.ts';

export const KIT_DIR = fileURLToPath(new URL('./kit', import.meta.url));
const executable = (file: string) => { try { fs.accessSync(file, fs.constants.X_OK); return fs.statSync(file).isFile(); } catch { return false; } };
export const supportBin=media.supportBin;
export const ffmpegPath=media.ffmpegPath;
export const ffprobePath=media.ffprobePath;
export function chromePath(){
 const file=process.env.CW_CHROME || process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
 if(file && executable(file))return file;
 const resolved=chromium.executablePath(); if(executable(resolved))return resolved;
 throw new Error('请准备 Playwright Chromium，或设置 PLAYWRIGHT_CHROMIUM_EXECUTABLE。');
}
export const pythonPath=resolvePython;
export function nodeModulesPath() {
  for (let dir = KIT_DIR; dir !== path.dirname(dir); dir = path.dirname(dir)) {
    const candidate = path.join(dir, 'node_modules');
    if (fs.existsSync(path.join(candidate, 'playwright-core', 'package.json')) && fs.existsSync(path.join(candidate, 'three', 'package.json'))) return candidate;
  }
  throw new Error('找不到运行环境的 node_modules（playwright-core、three），通用剪辑无法出片');
}
/** The icon library the app ships (public/semantic-icons in a checkout, dist/semantic-icons once built). */
export function iconsDir(): string | undefined {
  const root = path.join(KIT_DIR, '..', '..', '..');
  return [process.env.LINKREADER_ICONS_DIR, path.join(root, 'public', 'semantic-icons'), path.join(root, 'dist', 'semantic-icons')].find(dir => dir && fs.existsSync(dir));
}
/** Font folders from the template library on this machine (core/fonts and each style's demo/fonts). */
export function fontDirs(): string[] {
  const extra = (process.env.LINKREADER_GENERAL_FONT_DIRS || '').split(path.delimiter).filter(Boolean);
  const dirs = extra;
  return dirs.filter(dir => { try { return fs.statSync(dir).isDirectory(); } catch { return false; } });
}

function styleOf(projectDir: string): string | undefined {
  try { const id = JSON.parse(fs.readFileSync(path.join(projectDir, 'general-project.json'), 'utf8')).styleId; return typeof id === 'string' && /^[a-z0-9-]+$/.test(id) ? id : undefined; } catch { return undefined; }
}
const shellQuote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
/** Write .opentake/bin wrappers into work/ and return the environment the agent's commands see. */
export function prepareWork(projectDir: string, base: NodeJS.ProcessEnv, network = false, verified?: CreationTools): NodeJS.ProcessEnv {
  const work = path.join(projectDir, 'work');
  const bin = path.join(work, '.opentake', 'bin');
  const tmp = path.join(work, '.tmp');
  fs.mkdirSync(bin, { recursive: true });
  fs.mkdirSync(path.join(tmp, 'zsh'), { recursive: true });
  const python = verified?.python ?? pythonPath();
  const ffmpeg = verified?.ffmpeg ?? ffmpegPath();
  const ffprobe = verified?.ffprobe ?? ffprobePath();
  const chrome = verified?.chromium ?? chromePath();
  const node = process.execPath;
  const electron = Boolean(process.versions.electron);
  const wrappers: Record<string, string> = {
    node: `#!/bin/sh\n${electron ? 'ELECTRON_RUN_AS_NODE=1 ' : ''}exec ${shellQuote(node)} "$@"\n`,
    film: `#!/bin/sh\n${electron ? 'ELECTRON_RUN_AS_NODE=1 ' : ''}exec ${shellQuote(node)} ${shellQuote(path.join(KIT_DIR, 'film.mjs'))} "$@"\n`,
    hfx: `#!/bin/sh\n${electron ? 'ELECTRON_RUN_AS_NODE=1 ' : ''}exec ${shellQuote(node)} ${shellQuote(path.join(KIT_DIR, 'hfx.mjs'))} "$@"\n`,
    python3: `#!/bin/sh\nexec ${shellQuote(python)} "$@"\n`,
    ffmpeg: `#!/bin/sh\nexec ${shellQuote(ffmpeg)} "$@"\n`,
    ffprobe: `#!/bin/sh\nexec ${shellQuote(ffprobe)} "$@"\n`,
  };
  if(process.platform==='win32'){
    // Batch paths are quoted and percent expansion escaped; never turn an arbitrary path into a shell command.
    const quote=(value:string)=>{if(/["\r\n]/.test(value))throw Error('工具路径含不支持的字符');return '"'+value.replaceAll('%','%%')+'"';};
    const command=(exe:string,args:string[]=[])=>'@echo off\r\nsetlocal DisableDelayedExpansion\r\n'+(electron?'set "ELECTRON_RUN_AS_NODE=1"\r\n':'')+[exe,...args].map(quote).join(' ')+' %*\r\n';
    Object.assign(wrappers,{node:command(node),film:command(node,[path.join(KIT_DIR,'film.mjs')]),hfx:command(node,[path.join(KIT_DIR,'hfx.mjs')]),python3:command(pythonPath()),ffmpeg:command(ffmpegPath()),ffprobe:command(ffprobePath())});
  }
  if(verified) {
    wrappers.chromium = `#!/bin/sh\nexec ${shellQuote(chrome)} "$@"\n`;
    fs.writeFileSync(path.join(work,'.opentake','tools.json'),JSON.stringify(verified,null,2));
  }
  wrappers.python = wrappers.python3;
  // no installing or fetching software, 联网 or not (net-guard.ts)
  for (const name of REFUSED_COMMANDS) wrappers[name] = process.platform==='win32'?'@echo off\r\necho Installing software is disabled in this workspace. 1>&2\r\nexit /b 1\r\n':refusal(name);
  for (const [name, body] of Object.entries(wrappers)) {
    const file = path.join(bin, name+(process.platform==='win32'?'.cmd':''));
    if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== body) fs.writeFileSync(file, body, { mode: 0o755 });
    // ZIP/project transfers can strip executable bits even when wrapper text is current.
    fs.chmodSync(file, 0o755);
  }
  // Codex runs commands in a login zsh: /etc/zprofile (path_helper) puts system folders first and the person's own
  // ~/.zprofile may put an old ffmpeg or python ahead of ours. A private ZDOTDIR puts .opentake/bin back in front.
  const zdot = path.join(work, '.opentake', 'zsh');
  fs.mkdirSync(zdot, { recursive: true });
  const front = `export PATH=${shellQuote(bin)}:"$PATH"\n`;
  for (const name of ['.zshenv', '.zprofile']) { const file = path.join(zdot, name); if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== front) fs.writeFileSync(file, front); }
  const env: NodeJS.ProcessEnv = {
    ...base,
    ...(process.platform==='win32'?{TEMP:tmp,TMP:tmp}:{ZDOTDIR:zdot}),
    PATH: `${bin}${path.delimiter}${base.PATH || '/usr/bin:/bin:/usr/sbin:/sbin'}`,
    TMPDIR: tmp, TMPPREFIX: path.join(tmp, 'zsh', 'zsh'),
    CW_WORK: work, CW_MEDIA: path.join(projectDir, 'media'), CW_KIT: KIT_DIR, CW_BIN: bin,
    CW_FFMPEG: ffmpeg, CW_FFPROBE: ffprobe, CW_CHROME: chrome, ...(verified?{CW_HFX_CHROME:chrome,PLAYWRIGHT_CHROMIUM_EXECUTABLE:chrome}:{}), CW_PYTHON: python, CW_NODE_MODULES: nodeModulesPath(),
    CW_FONT_DIRS: fontDirs().join(path.delimiter), LINKREADER_BIN_DIR: verified?path.dirname(ffmpeg):supportBin(),
    ...(iconsDir() ? { CW_ICONS_DIR: iconsDir() } : {}),
    PYTHONPATH: path.join(KIT_DIR, 'audio'), PYTHONDONTWRITEBYTECODE: '1', PYTHONNOUSERSITE: '1', ...(process.env.PYTHONPYCACHEPREFIX ? { PYTHONPYCACHEPREFIX: process.env.PYTHONPYCACHEPREFIX } : {}),
    ...(network ? { CW_NETWORK: '1' } : {}),
    ...OFFLINE_PACKAGES,
    // the style's own text presets and finishes (kit/styles/<id>/text-presets.json), read by the layered film tools
    ...(styleOf(projectDir) ? { CW_STYLE: styleOf(projectDir) } : {}),
  };
  delete env.CODEX_THREAD_ID;
  return env;
}
