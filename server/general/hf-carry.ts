/**
 * The person's edits of a HyperFrames film live beside a version (versions/vN/edited.json: words and moves by clip and
 * element id), never in the agent's files. Two things keep them alive from one version to the next:
 *
 * - every element of the film carries HyperFrames' own id (data-hf-id), stamped into the agent's folder at each
 *   delivery the way HyperFrames stamps a project it opens: only the missing ids are inserted, nothing else in the
 *   file changes, and an element keeps its id in every later turn;
 * - when the agent delivers a revision, the edits of the version it revised go over to the new one, element by element
 *   (S先生 2026-10-26: 下一版保留改动). Changed words stay unless the agent rewrote that same text (then the person's
 *   request to the agent was about it, and the agent's text wins); a move stays as long as its element is there.
 */
import fs from 'node:fs';
import path from 'node:path';
import { parseHTML } from 'linkedom';
import { stampHfIdsInPlace, walkCompositionDescendants } from '@hyperframes/parsers';
import type { GeneralLayers } from '../../src/general/general-contract.ts';
import type { TimelineClip } from '../../src/types/editor.ts';
import { HF_ENTRY } from './hf-project.ts';

/** Folders of a film folder that hold no pages of the film. */
const NOT_PAGES = new Set(['node_modules', 'look', 'render', 'out', 'assets', 'fonts', 'vendor', '.tmp', '.tmp-look', '.opentake', '.hyperframes']);

/** The film's pages: the root page and every sub-composition (relative paths, '/' separated). */
export function filmPages(work: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(path.join(work, dir), { withFileTypes: true })) {
      const rel = dir ? `${dir}/${entry.name}` : entry.name;
      if (entry.isDirectory()) { if (!NOT_PAGES.has(entry.name) && !entry.name.startsWith('.')) walk(rel); }
      else if (/\.html?$/i.test(entry.name) && (dir || entry.name === HF_ENTRY)) out.push(rel);
    }
  };
  if (fs.existsSync(path.join(work, HF_ENTRY))) walk('');
  return out;
}

/** Give every element of the film its id; returns how many pages changed. */
export function stampHfWork(work: string) {
  let changed = 0;
  for (const page of filmPages(work)) {
    const file = path.join(work, page), html = fs.readFileSync(file, 'utf8'), next = stampHfIdsInPlace(html);
    if (next !== html) { fs.writeFileSync(file, next); changed++; }
  }
  return changed;
}

/** An element's own words, line breaks as <br> (the same reading as hf-edit-bridge.js). */
const wordsOf = (el: Element) => [...el.childNodes].map(n => (n.nodeName.toLowerCase() === 'br' ? '\n' : n.textContent ?? '')).join('');

/** Every element of the film with an id: `${page}#${id}` → its words. Ids are unique within a page, not across pages. */
export function hfElements(work: string) {
  const out = new Map<string, string>();
  for (const page of filmPages(work)) {
    const { document } = parseHTML(fs.readFileSync(path.join(work, page), 'utf8'));
    walkCompositionDescendants(document as unknown as Document, el => { const id = el.getAttribute('data-hf-id'); if (id) out.set(`${page}#${id}`, wordsOf(el)); });
  }
  return out;
}

const clipsOf = (layers: GeneralLayers) => layers.timeline.tracks.flatMap(t => t.clips);
/** The page a clip's elements are written in: its sub-composition, or the root page for a clip written inline. */
const pageOf = (clip: TimelineClip) => String(clip.params.sub || HF_ENTRY).replace(/^\.\//, '');
const idOfSelector = (selector: string) => /^\[data-hf-id="([^"]+)"\]$/.exec(selector)?.[1];
type Words = Record<string, string>;
type Moves = Record<string, unknown>;
const editsOf = (clip: TimelineClip) => ({ words: (clip.params.textEdits ?? {}) as Words, moves: (clip.params.overrides ?? {}) as Moves });
const edited = (clip: TimelineClip) => { const e = editsOf(clip); return clip.params.hf === true && (Object.keys(e.words).length > 0 || Object.keys(e.moves).length > 0); };
const short = (text: string) => { const t = text.replace(/\s+/g, ' ').trim(); return [...t].length > 18 ? `${[...t].slice(0, 17).join('')}…` : t; };

/** The person's edits of a version, as lines for the agent's next turn (empty when there are none). */
export function describeEdits(work: string, layers: GeneralLayers): string[] {
  const clips = clipsOf(layers).filter(edited);
  if (!clips.length) return [];
  const elements = hfElements(work), lines: string[] = [];
  for (const clip of clips) {
    const page = pageOf(clip), { words, moves } = editsOf(clip);
    for (const [id, text] of Object.entries(words)) lines.push(`- \`${page}\` 里 data-hf-id="${id}" 的字：「${short(elements.get(`${page}#${id}`) ?? '')}」改成了「${short(text)}」`);
    for (const selector of Object.keys(moves)) {
      const id = idOfSelector(selector);
      if (id) lines.push(`- \`${page}\` 里 data-hf-id="${id}" 的元素（${short(elements.get(`${page}#${id}`) ?? '') || '图形'}）：位置、大小或角度手动调过`);
    }
  }
  return lines;
}

/**
 * The edits of the revised version (`from`), carried onto the new version's tracks (`to`). Returns the new version's
 * edited tracks (undefined when nothing carried) and what was kept or dropped, for the conversation.
 */
export function carryEdits(from: { work: string; layers: GeneralLayers }, to: { work: string; layers: GeneralLayers }) {
  const before = hfElements(from.work), after = hfElements(to.work);
  const next = structuredClone(to.layers), targets = new Map(clipsOf(next).map(c => [c.id, c]));
  let kept = 0;
  const dropped: string[] = [];
  for (const clip of clipsOf(from.layers).filter(edited)) {
    const target = targets.get(clip.id), { words, moves } = editsOf(clip);
    const oldPage = pageOf(clip), newPage = target ? pageOf(target) : '';
    const words2: Words = {}, moves2: Moves = {};
    for (const [id, text] of Object.entries(words)) {
      const was = before.get(`${oldPage}#${id}`), now = target ? after.get(`${newPage}#${id}`) : undefined;
      // the agent left the words as they were: the person's change still applies
      if (was !== undefined && now !== undefined && was === now) { words2[id] = text; kept++; }
      else dropped.push(`「${short(text)}」`);
    }
    for (const [selector, move] of Object.entries(moves)) {
      const id = idOfSelector(selector);
      if (target && id && after.has(`${newPage}#${id}`)) { moves2[selector] = move; kept++; }
      else dropped.push(`${short(id ? before.get(`${oldPage}#${id}`) ?? '' : '') || '一个元素'}的位置调整`);
    }
    if (target && (Object.keys(words2).length || Object.keys(moves2).length)) {
      target.params = { ...target.params, ...(Object.keys(words2).length ? { textEdits: words2 } : {}), ...(Object.keys(moves2).length ? { overrides: moves2 } : {}) };
    }
  }
  return { layers: kept ? next : undefined, kept, dropped };
}
