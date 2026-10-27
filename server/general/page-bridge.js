// Injected into every agent page the page host serves. The editor (another origin) drives the page by message:
// { type: 'ot-seek', t, token, edits? } → applies the person's text edits once, draws window.shot.frame(t),
// waits two animation frames, answers { type: 'ot-frame', token } (or { type: 'ot-error', token, error }).
// { type: 'ot-hit', x, y, token } (page px) → { type: 'ot-hit', token, name?, text?, rect?, style? }: the editable text
// (data-edit) under that point, where it is and how it is set, so the editor can open an editor right over it.
(() => {
  let applied = '';
  const originals = new Map(); // data-edit name → the agent's text, so dropping an edit (undo) brings it back
  const ready = () => new Promise((resolve, reject) => {
    let tries = 0;
    const check = () => {
      if (window.shot && typeof window.shot.frame === 'function') return resolve(window.shot);
      if (++tries > 400) return reject(new Error('页面没有设置 window.shot = { frame(t) }'));
      setTimeout(check, 25);
    };
    check();
  }).then(async shot => { await document.fonts.ready; await shot.ready; return shot; });
  const shotReady = ready();
  shotReady.then(() => parent.postMessage({ type: 'ot-ready' }, '*'), error => parent.postMessage({ type: 'ot-error', error: String(error.message || error) }, '*'));
  function applyEdits(edits) {
    const key = JSON.stringify(edits || {});
    if (key === applied) return [];
    applied = key;
    const missing = [];
    for (const el of document.querySelectorAll('[data-edit]')) {
      const name = el.getAttribute('data-edit');
      if (!originals.has(name)) originals.set(name, el.textContent);
      const text = edits && Object.prototype.hasOwnProperty.call(edits, name) ? String(edits[name]) : originals.get(name);
      if (el.textContent !== text) el.textContent = text;
    }
    for (const name of Object.keys(edits || {})) if (!document.querySelector(`[data-edit="${CSS.escape(name)}"]`)) missing.push(name);
    return missing;
  }
  // by geometry, not elementsFromPoint: pages often turn pointer events off on their text
  function hit(x, y) {
    let target, area = Infinity;
    for (const el of document.querySelectorAll('[data-edit]')) {
      const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
      if (!r.width || !r.height || cs.visibility === 'hidden' || Number(cs.opacity) === 0) continue;
      const pad = 12; // a little slack around thin text
      if (x < r.left - pad || x > r.right + pad || y < r.top - pad || y > r.bottom + pad) continue;
      if (r.width * r.height < area) { target = el; area = r.width * r.height; }
    }
    if (target) {
      const r = target.getBoundingClientRect(), cs = getComputedStyle(target);
      return {
        name: target.getAttribute('data-edit'), text: target.textContent,
        rect: { x: r.left, y: r.top, w: r.width, h: r.height },
        style: { fontFamily: cs.fontFamily, fontSize: cs.fontSize, fontWeight: cs.fontWeight, fontStyle: cs.fontStyle, color: cs.color, textAlign: cs.textAlign, lineHeight: cs.lineHeight, letterSpacing: cs.letterSpacing },
      };
    }
    return {};
  }
  // the person's moves of page elements (same rule as kit/web/page-edits.js applyPageOverrides), after every frame
  const SIZE = { small: 0.8, mid: 1, large: 1.25 };
  function applyOverrides(overrides) {
    const now = new Set();
    for (const [selector, o] of Object.entries(overrides || {})) {
      let el = null;
      try { el = document.querySelector(selector); } catch { el = null; }
      if (!el) continue;
      now.add(el); el.setAttribute('data-ot-moved', '');
      const dx = Number(o && o.dx) || 0, dy = Number(o && o.dy) || 0, factor = SIZE[o && o.size] || 1, turn = Number(o && o.rotate) || 0;
      el.style.translate = ''; el.style.scale = ''; el.style.rotate = '';
      if (factor !== 1 || turn) el.style.transformOrigin = pivotOf(el); // about the words' own middle, as page-edits.js does
      el.style.translate = dx || dy ? `${dx}px ${dy}px` : '';
      el.style.scale = factor !== 1 ? String(factor) : '';
      el.style.rotate = turn ? `${turn}deg` : '';
    }
    for (const el of document.querySelectorAll('[data-ot-moved]')) if (!now.has(el)) { el.style.translate = ''; el.style.scale = ''; el.style.rotate = ''; el.style.transformOrigin = ''; el.removeAttribute('data-ot-moved'); }
  }
  // the words' own box inside an element (a heading is often a full-width block with the words at one end)
  function wordsBox(el) {
    if ([...el.childNodes].some(n => n.nodeType === 3 && n.data.trim())) {
      const range = document.createRange(); range.selectNodeContents(el);
      const r = range.getBoundingClientRect();
      if (r.width && r.height) return r;
    }
    return el.getBoundingClientRect();
  }
  function pivotOf(el) {
    const box = el.getBoundingClientRect(), r = wordsBox(el);
    return `${r.left + r.width / 2 - box.left}px ${r.top + r.height / 2 - box.top}px`;
  }
  // a selector that finds this element again in the same page: its data-edit name, its id, or its path from <body>
  function selectorOf(el) {
    if (el.hasAttribute('data-edit')) return `[data-edit="${CSS.escape(el.getAttribute('data-edit'))}"]`;
    if (el.id) return `#${CSS.escape(el.id)}`;
    const steps = [];
    for (let node = el; node && node !== document.body; node = node.parentElement) {
      const same = [...node.parentElement.children].filter(c => c.localName === node.localName);
      steps.unshift(`${node.localName}:nth-of-type(${same.indexOf(node) + 1})`);
    }
    return `body>${steps.join('>')}`;
  }
  // what a click may pick in a page: its words (data-edit, or an element with its own text), pictures and drawings —
  // the smallest one under the point, never a full-frame background
  function pick(x, y) {
    const area = innerWidth * innerHeight;
    let best, bestArea = Infinity;
    for (const el of document.querySelectorAll('body *')) {
      if (el.closest('svg') && el.localName !== 'svg') continue;
      const own = [...el.childNodes].some(n => n.nodeType === 3 && n.data.trim());
      if (!(el.hasAttribute('data-edit') || own || ['img', 'svg', 'video', 'canvas'].includes(el.localName) || el.hasAttribute('data-move'))) continue;
      const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
      if (!r.width || !r.height || cs.visibility === 'hidden' || Number(cs.opacity) === 0 || r.width * r.height > area * 0.6) continue;
      if (x < r.left - 6 || x > r.right + 6 || y < r.top - 6 || y > r.bottom + 6) continue;
      if (r.width * r.height < bestArea) { best = el; bestArea = r.width * r.height; }
    }
    if (!best) return {};
    // a page often wraps a title in a clipping box for its reveal; moving the title alone would slide it out of view,
    // so the clipping box (not a full-frame one) moves with it
    let target = best;
    for (let node = best.parentElement; node && node !== document.body; node = node.parentElement) {
      const cs = getComputedStyle(node), r = node.getBoundingClientRect();
      if (r.width * r.height > area * 0.6) break;
      if (cs.overflow !== 'visible' || cs.overflowX !== 'visible' || cs.overflowY !== 'visible' || (cs.clipPath && cs.clipPath !== 'none')) target = node;
    }
    const r = wordsBox(best === target ? target : best);
    return { selector: selectorOf(target), rect: { x: r.left, y: r.top, w: r.width, h: r.height }, kind: ['img', 'video', 'canvas'].includes(best.localName) ? 'image' : best.localName === 'svg' ? 'shape' : 'text' };
  }
  function rectOf(selector) {
    let el = null;
    try { el = document.querySelector(selector); } catch { el = null; }
    if (!el) return undefined;
    const r = wordsBox(el);
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  }
  addEventListener('message', async event => {
    const m = event.data;
    if (m && m.type === 'ot-pick' && event.source === parent) { parent.postMessage({ type: 'ot-pick', token: m.token, ...pick(Number(m.x) || 0, Number(m.y) || 0) }, '*'); return; }
    if (m && m.type === 'ot-rect' && event.source === parent) { parent.postMessage({ type: 'ot-rect', token: m.token, rect: rectOf(String(m.selector)) }, '*'); return; }
    if (m && m.type === 'ot-hit' && event.source === parent) { parent.postMessage({ type: 'ot-hit', token: m.token, ...hit(Number(m.x) || 0, Number(m.y) || 0) }, '*'); return; }
    if (!m || m.type !== 'ot-seek' || event.source !== parent) return;
    try {
      const shot = await shotReady;
      const missing = applyEdits(m.edits);
      await shot.frame(Math.max(0, Number(m.t) || 0));
      applyOverrides(m.overrides);
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      parent.postMessage({ type: 'ot-frame', token: m.token, missing }, '*');
    } catch (error) { parent.postMessage({ type: 'ot-error', token: m.token, error: String(error?.message || error) }, '*'); }
  });
  // texts the person may edit (data-edit), for the inspector
  shotReady.then(() => parent.postMessage({ type: 'ot-texts', texts: [...document.querySelectorAll('[data-edit]')].map(el => ({ name: el.getAttribute('data-edit'), text: el.textContent })) }, '*'));
})();
