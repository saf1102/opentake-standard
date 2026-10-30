// Where the film kit finds its tools. OpenTake sets the CW_* variables for every run; the fallbacks keep the kit
// usable from a terminal on the development machine. Nothing here downloads anything.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

export const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export {tool,chromePath} from './tool-source.mjs';

/** The node_modules folder that holds playwright-core, three, d3… (the app runtime's, or this checkout's). */
export function nodeModules() {
  if (process.env.CW_NODE_MODULES && fs.existsSync(path.join(process.env.CW_NODE_MODULES, 'playwright-core'))) return process.env.CW_NODE_MODULES;
  for (let dir = KIT; dir !== path.dirname(dir); dir = path.dirname(dir)) {
    const candidate = path.join(dir, 'node_modules');
    if (fs.existsSync(path.join(candidate, 'playwright-core', 'package.json'))) return candidate;
  }
  throw new Error('找不到运行环境的 node_modules（playwright-core），请报告这个问题。');
}

export async function playwright() {
  return createRequire(path.join(nodeModules(), 'noop.js'))('playwright-core');
}

/** The film folder: the agent's work directory. */
export const WORK = path.resolve(process.env.CW_WORK || process.cwd());
/** The person's own material, read-only. */
export const MEDIA = process.env.CW_MEDIA ? path.resolve(process.env.CW_MEDIA) : path.join(path.dirname(WORK), 'media');
/** The icon library OpenTake ships (public/semantic-icons: simple-icons brand logos, lucide symbols), the same one the 口播 cards use. */
export const iconsDir = () => [process.env.CW_ICONS_DIR, path.join(KIT, '..', '..', '..', 'public', 'semantic-icons'), path.join(KIT, '..', '..', '..', 'dist', 'semantic-icons')].find(dir => dir && fs.existsSync(dir));
export const fontDirs = () => [path.join(KIT, 'fonts'), ...(process.env.CW_FONT_DIRS || '').split(path.delimiter)].filter(dir => dir && fs.existsSync(dir));

/** Offline browser libraries a page may import from /_kit/<name>/… (no CDN at render time). */
export const LIBRARIES = {
  three: { entry: 'three/build/three.module.js', addons: 'three/examples/jsm/', note: 'import * as THREE from "/_kit/three/build/three.module.js"；附加模块 /_kit/three/examples/jsm/…（用 importmap 把 "three" 指向前者）' },
  'd3-scale': { entry: 'd3-scale/src/index.js' }, 'd3-shape': { entry: 'd3-shape/src/index.js' }, 'd3-interpolate': { entry: 'd3-interpolate/src/index.js' },
  'd3-array': { entry: 'd3-array/src/index.js' }, 'd3-color': { entry: 'd3-color/src/index.js' }, 'd3-ease': { entry: 'd3-ease/src/index.js' },
  'd3-format': { entry: 'd3-format/src/index.js' }, 'd3-path': { entry: 'd3-path/src/index.js' }, 'd3-time': { entry: 'd3-time/src/index.js' },
  'd3-time-format': { entry: 'd3-time-format/src/index.js' }, 'd3-timer': { entry: 'd3-timer/src/index.js' }, internmap: { entry: 'internmap/src/index.js' },
};
export function libraryVersions() {
  const root = nodeModules();
  return Object.entries(LIBRARIES).flatMap(([name, lib]) => {
    try { const version = JSON.parse(fs.readFileSync(path.join(root, name, 'package.json'), 'utf8')).version; return [{ name, version, url: `/_kit/${lib.entry}`, note: lib.note }]; }
    catch { return []; }
  });
}
