// The person's edits on a HyperFrames film, in the editor's preview and in OpenTake's export alike:
// { text: { <clip>: { <element data-hf-id>: text } }, moves: { <clip>: { <selector>: { dx, dy, size, rotate } } } }.
// A clip is a top-level element of the root composition (a sub-composition host, a caption track, a title), named by its
// data-hf-id. The agent's files are never changed; edits are put in whenever the page (or a sub-composition the runtime
// mounts later) shows the element. Moves use the CSS translate / scale / rotate properties, which compose with the
// transform the film's own animation sets, the same rule as page-bridge.js for the older pages.
// Editor (another origin) → page:
//   { type: 'ot-page-edits', edits } sets them;
//   { type: 'ot-hit', x, y, token } (page px) → { clip?, name?, text?, rect?, style? }: the text under that point (改字);
//   { type: 'ot-pick', x, y, token } → { clip?, selector?, rect?, kind? }: the element a click picks (移动 · 大小 · 旋转);
//   { type: 'ot-rect', selector, clip?, token } → { rect? }: where that element (inside that clip) is now.
(() => {
  let edits = window.__otPageEdits || {};
  const originals = new Map(); // element → the agent's text, so dropping an edit (undo, 还原) brings it back
  const root = () => document.querySelector('[data-composition-id]');
  /** The clip an element belongs to: its ancestor (or itself) right under the root composition. */
  const clipOf = el => { const r = root(); for (let e = el; e && e !== r; e = e.parentElement) if (e.parentElement === r) return e; return undefined; };
  const idOf = el => el.getAttribute('data-hf-id');
  // a clip is named as OpenTake's tracks name it (server/general/hf-project.ts): its data-hf-id, else its id
  const clipIdOf = el => el.getAttribute('data-hf-id') || el.id;
  const clipById = (r, id) => [...r.children].find(c => clipIdOf(c) === id) || null;
  const isSvg = el => el instanceof SVGElement;
  // a text leaf: its own words only (line breaks allowed), so changing it cannot break the agent's structure
  const leaf = el => [...el.children].every(c => c.localName === 'br') && el.textContent.trim() !== '';
  // from the nodes, not innerText: that needs layout, and a hidden clip's line breaks would vanish (edits never settle)
  const textOf = el => [...el.childNodes].map(n => (n.nodeName.toLowerCase() === 'br' ? '\n' : n.textContent)).join('');
  const setText = (el, text) => {
    if (isSvg(el)) { el.textContent = text; return; }
    const parts = String(text).split('\n');
    el.replaceChildren(...parts.flatMap((p, i) => (i ? [document.createElement('br'), p] : [p])));
  };
  // the words' own box inside an element (a heading is often a full-width block with the words at one end)
  function wordsBox(el) {
    if ([...el.childNodes].some(n => n.nodeType === 3 && n.data.trim())) {
      const range = document.createRange(); range.selectNodeContents(el);
      const r = range.getBoundingClientRect();
      if (r.width && r.height) return r;
    }
    return el.getBoundingClientRect();
  }
  // the words' middle as a share of the element's box: it holds under the film's own scale and move, and is measured
  // only once the element is laid out (undefined before; a sub-composition may not be yet)
  const pivotOf = el => {
    const box = el.getBoundingClientRect(), r = wordsBox(el);
    if (!box.width || !box.height) return undefined;
    return `${((r.left + r.width / 2 - box.left) / box.width) * 100}% ${((r.top + r.height / 2 - box.top) / box.height) * 100}%`;
  };
  const SIZE = { small: 0.8, mid: 1, large: 1.25 };
  const shown = new Map(); // element → { key: the move it shows, origin: its own inline transform-origin }
  let retry = 0;
  function applyMoves(r) {
    const now = new Set();
    let waiting = false;
    for (const [clipId, list] of Object.entries(edits.moves || {})) {
      const clip = clipById(r, clipId);
      for (const [selector, o] of Object.entries(clip ? list || {} : {})) {
        let el = null;
        try { el = clip.matches(selector) ? clip : clip.querySelector(selector); } catch { el = null; }
        if (!el) continue;
        now.add(el);
        const dx = Number(o && o.dx) || 0, dy = Number(o && o.dy) || 0, factor = SIZE[o && o.size] || 1, turn = Number(o && o.rotate) || 0;
        const translate = dx || dy ? `${dx}px ${dy}px` : '', scale = factor !== 1 ? String(factor) : '', rotate = turn ? `${turn}deg` : '';
        const key = `${translate}|${scale}|${rotate}`, was = shown.get(el);
        if (was?.key === key && el.style.translate === translate && el.style.scale === scale && el.style.rotate === rotate) continue;
        // GSAP folds an element's translate / scale / rotate into its own transform the first time it reads the element
        // (then a tween of its scale would drop ours): let it read the element as the agent made it first
        try { window.gsap?.getProperty?.(el, 'x'); } catch { /* not a GSAP film */ }
        const own = was ? was.origin : el.style.transformOrigin;
        el.style.translate = ''; el.style.scale = ''; el.style.rotate = '';
        let origin = own;
        if (scale || rotate) { origin = pivotOf(el); if (!origin) { waiting = true; shown.set(el, { key: '', origin: own }); continue; } }
        el.style.transformOrigin = origin; // about the words' own middle
        el.style.translate = translate; el.style.scale = scale; el.style.rotate = rotate;
        shown.set(el, { key, origin: own });
      }
    }
    for (const [el, was] of shown) if (!now.has(el)) { el.style.translate = ''; el.style.scale = ''; el.style.rotate = ''; el.style.transformOrigin = was.origin; shown.delete(el); }
    if (waiting && !retry) retry = requestAnimationFrame(() => { retry = 0; apply(); });
  }
  function apply() {
    const r = root();
    if (!r) return;
    for (const el of r.querySelectorAll('[data-hf-id]')) {
      const clip = clipOf(el), want = clip && edits.text?.[clipIdOf(clip)]?.[idOf(el)];
      if (typeof want === 'string') {
        if (!originals.has(el)) { if (!leaf(el)) continue; originals.set(el, textOf(el)); }
        if (textOf(el) !== want) setText(el, want);
      } else if (originals.has(el)) { setText(el, originals.get(el)); originals.delete(el); }
    }
    applyMoves(r);
  }
  window.__otApplyEdits = apply;
  let queued = false;
  new MutationObserver(() => { if (!queued) { queued = true; queueMicrotask(() => { queued = false; apply(); }); } })
    .observe(document.documentElement, { childList: true, subtree: true });
  apply();
  // by geometry, not elementsFromPoint: pages often turn pointer events off on their text
  function seen(el) {
    let opacity = 1;
    for (let e = el; e && e.nodeType === 1; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (cs.display === 'none' || cs.visibility === 'hidden') return false;
      opacity *= Number(cs.opacity);
    }
    return opacity > 0.05;
  }
  function hit(x, y) {
    const r = root();
    let target, area = Infinity;
    for (const el of r ? r.querySelectorAll('[data-hf-id]') : []) {
      if (!leaf(el) || !clipOf(el)) continue;
      const b = el.getBoundingClientRect(), pad = 12; // a little slack around thin text
      if (!b.width || !b.height || x < b.left - pad || x > b.right + pad || y < b.top - pad || y > b.bottom + pad) continue;
      if (b.width * b.height < area && seen(el)) { target = el; area = b.width * b.height; }
    }
    if (!target) return {};
    const b = target.getBoundingClientRect(), cs = getComputedStyle(target);
    return {
      clip: clipIdOf(clipOf(target)), name: idOf(target), text: textOf(target),
      rect: { x: b.left, y: b.top, w: b.width, h: b.height },
      style: { fontFamily: cs.fontFamily, fontSize: cs.fontSize, fontWeight: cs.fontWeight, fontStyle: cs.fontStyle, color: isSvg(target) ? cs.fill : cs.color, textAlign: cs.textAlign, lineHeight: cs.lineHeight, letterSpacing: cs.letterSpacing },
    };
  }
  // what a click may pick: words (an element with its own text), pictures and drawings — the smallest one under the
  // point, never a full-frame background (the same choice as page-bridge.js)
  function pick(x, y) {
    const r = root(), area = innerWidth * innerHeight;
    let best, bestArea = Infinity;
    for (const el of r ? r.querySelectorAll('*') : []) {
      if (el.closest('svg') && el.localName !== 'svg') continue;
      const own = [...el.childNodes].some(n => n.nodeType === 3 && n.data.trim());
      if (!(own || ['img', 'svg', 'video', 'canvas'].includes(el.localName))) continue;
      const b = el.getBoundingClientRect();
      if (!b.width || !b.height || b.width * b.height > area * 0.6) continue;
      if (x < b.left - 6 || x > b.right + 6 || y < b.top - 6 || y > b.bottom + 6) continue;
      if (b.width * b.height < bestArea && clipOf(el) && seen(el)) { best = el; bestArea = b.width * b.height; }
    }
    if (!best) return {};
    // a page often wraps a title in a clipping box for its reveal; moving the title alone would slide it out of view,
    // so the clipping box (not a full-frame one) moves with it
    const clip = clipOf(best);
    let target = best;
    for (let node = best.parentElement; node && node !== clip; node = node.parentElement) {
      const cs = getComputedStyle(node), b = node.getBoundingClientRect();
      if (b.width * b.height > area * 0.6) break;
      if (cs.overflow !== 'visible' || cs.overflowX !== 'visible' || cs.overflowY !== 'visible' || (cs.clipPath && cs.clipPath !== 'none')) target = node;
    }
    // named by HyperFrames' own id, so the move finds it again in every frame and in the export
    while (target !== clip && !target.hasAttribute('data-hf-id')) target = target.parentElement;
    if (!target.hasAttribute('data-hf-id')) return {};
    const b = wordsBox(best === target ? target : best);
    return { clip: clipIdOf(clip), selector: `[data-hf-id="${CSS.escape(idOf(target))}"]`, rect: { x: b.left, y: b.top, w: b.width, h: b.height }, kind: ['img', 'video', 'canvas'].includes(best.localName) ? 'image' : best.localName === 'svg' ? 'shape' : 'text' };
  }
  // ids are unique within a page, not across pages (two cards may share one): look inside the clip
  function rectOf(selector, clipId) {
    const r = root(), clip = r && clipId ? clipById(r, clipId) : null;
    let el = null;
    try { el = clip ? (clip.matches(selector) ? clip : clip.querySelector(selector)) : document.querySelector(selector); } catch { el = null; }
    if (!el) return undefined;
    const b = wordsBox(el);
    return { x: b.left, y: b.top, w: b.width, h: b.height };
  }
  addEventListener('message', event => {
    const m = event.data;
    if (!m || event.source !== parent) return;
    const answer = value => parent.postMessage({ type: m.type, token: m.token, ...value }, '*');
    if (m.type === 'ot-page-edits') { edits = m.edits || {}; apply(); }
    if (m.type === 'ot-hit') answer(hit(Number(m.x) || 0, Number(m.y) || 0));
    if (m.type === 'ot-pick') answer(pick(Number(m.x) || 0, Number(m.y) || 0));
    if (m.type === 'ot-rect') answer({ rect: rectOf(String(m.selector), m.clip ? String(m.clip) : '') });
  });
})();
