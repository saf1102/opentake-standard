// Shared by the compositor and isolated page rendering. No selector interpolation:
// names may contain quotes or CSS metacharacters; replacement is always plain text.
export function applyPageEdits(document, edits = {}) {
  const nodes = [...document.querySelectorAll('[data-edit]')];
  const missing = [];
  for (const [name, text] of Object.entries(edits)) {
    const matches = nodes.filter(node => node.getAttribute('data-edit') === name);
    if (!matches.length) missing.push(name);
    for (const node of matches) node.textContent = text;
  }
  return missing;
}

/**
 * The person's moves of elements inside a page (S先生 2026-10-25, like OpenFilm's overrides): per CSS selector, a shift
 * in page pixels, a size step and a turn in 15° steps, set as the element's own translate / scale / rotate properties
 * so they compose with the page's animated transform. Applied after every frame; an element no longer listed gets
 * its properties back (data-ot-moved marks what was touched). Returns the selectors that matched nothing.
 */
export function applyPageOverrides(document, overrides = {}) {
  const SIZE = { small: 0.8, mid: 1, large: 1.25 };
  const now = new Set();
  const missing = [];
  for (const [selector, o] of Object.entries(overrides || {})) {
    let el = null;
    try { el = document.querySelector(selector); } catch { el = null; }
    if (!el) { missing.push(selector); continue; }
    now.add(el);
    el.setAttribute('data-ot-moved', '');
    const dx = Number(o?.dx) || 0, dy = Number(o?.dy) || 0, factor = SIZE[o?.size] || 1, turn = Number(o?.rotate) || 0;
    el.style.translate = ''; el.style.scale = ''; el.style.rotate = '';
    // turn and size about the words' own middle (a heading is often a full-width block with the words at one end)
    if (factor !== 1 || turn) el.style.transformOrigin = pivotOf(document, el);
    el.style.translate = dx || dy ? `${dx}px ${dy}px` : '';
    el.style.scale = factor !== 1 ? String(factor) : '';
    el.style.rotate = turn ? `${turn}deg` : '';
  }
  for (const el of document.querySelectorAll('[data-ot-moved]')) {
    if (now.has(el)) continue;
    el.style.translate = ''; el.style.scale = ''; el.style.rotate = ''; el.style.transformOrigin = ''; el.removeAttribute('data-ot-moved');
  }
  return missing;
}

/** Where an element's words sit inside its box (its own middle for a picture), as a transform-origin. */
export function pivotOf(document, el) {
  const box = el.getBoundingClientRect();
  let r = box;
  if ([...el.childNodes].some(n => n.nodeType === 3 && n.data.trim())) {
    try {
      const range = document.createRange(); range.selectNodeContents(el);
      const words = range.getBoundingClientRect();
      if (words.width && words.height) r = words;
    } catch { /* no layout for ranges here: the box's middle */ }
  }
  return `${r.left + r.width / 2 - box.left}px ${r.top + r.height / 2 - box.top}px`;
}
