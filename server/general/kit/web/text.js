// Text items of a layered film (film.json version 2), drawn as DOM. The kit's compositor and OpenTake's preview use
// this same file, so what the agent sees in `film look` is what the person sees and exports. Pure function of t.

const MARGIN = 0.07;              // of the short side
// Usual size of each role (of the short side: the styles' median title / caption / label). A preset made for one role
// and put on a text of another keeps its look and takes that role's size, by this ratio.
const ROLE_SIZE = { title: 0.078, caption: 0.042, label: 0.03 };
/** The preset as worn by a text of `role`: unchanged when it is made for that role (or names no roles). */
export function presetForRole(preset, role) {
  const roles = preset?.roles;
  if (!roles?.length || !role || roles.includes(role) || !ROLE_SIZE[role] || !ROLE_SIZE[roles[0]]) return preset;
  return { ...preset, size: (preset.size || ROLE_SIZE[roles[0]]) * ROLE_SIZE[role] / ROLE_SIZE[roles[0]] };
}
/** The person's size steps, as a factor on the preset's size. */
export const SIZE_FACTOR = { small: 0.8, mid: 1, large: 1.25 };
const BOX = { bottom: [0.5, 1, 0.84], top: [0.5, 0, 0.84], center: [0.5, 0.5, 0.84], 'lower-left': [0, 1, 0.6], 'lower-right': [1, 1, 0.6], 'upper-left': [0, 0, 0.6], 'upper-right': [1, 0, 0.6], left: [0, 0.5, 0.6], right: [1, 0.5, 0.6] };

/** `变化在{屏幕里}` → [{text:'变化在'}, {text:'屏幕里', accent:true}] */
export function accentRuns(line) {
  const runs = [];
  const re = /\{([^{}]*)\}/g;
  let at = 0, m;
  while ((m = re.exec(line))) { if (m.index > at) runs.push({ text: line.slice(at, m.index) }); runs.push({ text: m[1], accent: true }); at = m.index + m[0].length; }
  if (at < line.length) runs.push({ text: line.slice(at) });
  return runs;
}

/** Reveal units for `word`: Latin words, single CJK characters, punctuation attached to what precedes it. */
export function revealUnits(text) {
  const out = [];
  for (const piece of text.match(/[A-Za-z0-9'’-]+[^\sA-Za-z0-9㐀-鿿]*|[㐀-鿿][，。、！？；：,.!?;:）」』”]*|\s+|./gu) || []) out.push(piece);
  return out;
}

const ease = u => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));

/** Opacity of the whole item and of each unit at film time t. */
export function revealAt(item, t) {
  const u = t - item.start, left = item.end - t, dur = item.end - item.start;
  const outFade = ease(Math.min(1, left / 0.2));
  if (item.reveal === 'none') return { whole: 1, unit: () => 1 };
  if (item.reveal === 'fade') return { whole: ease(Math.min(1, u / 0.2)) * outFade, unit: () => 1 };
  if (item.reveal === 'line') return { whole: outFade, unit: (k) => ease((u - k * 0.25) / 0.2), per: 'line' };
  const span = Math.min(1, 0.4 * dur);
  return { whole: outFade, unit: (k, n) => ease((u - (n > 1 ? (k * span) / n : 0)) / 0.12), per: 'unit' };
}

function styleFor(preset, short) {
  const px = preset.size * short;
  const css = [
    `font-family:"${preset.font || 'Noto Sans SC'}",${preset.fallback ? `"${preset.fallback}",` : ''}"PingFang SC",sans-serif`, `font-weight:${preset.weight || 600}`, `font-size:${px}px`,
    `line-height:${preset.lineHeight || 1.25}`, `color:${preset.color || '#fff'}`, `letter-spacing:${(preset.tracking || 0)}em`, 'white-space:pre-wrap', 'word-break:break-word',
  ];
  if (preset.shadow) css.push(`text-shadow:0 ${px * 0.04}px ${px * 0.18}px rgba(0,0,0,.55)`);
  if (preset.stroke) css.push(`-webkit-text-stroke:${preset.stroke}em ${preset.strokeColor || '#000'}`, 'paint-order:stroke fill');
  if (preset.box) css.push(`background:${preset.boxColor || 'rgba(0,0,0,.6)'}`, 'padding:.18em .5em', `border-radius:${preset.radius ?? 0.22}em`, '-webkit-box-decoration-break:clone', 'box-decoration-break:clone');
  // optional, each from a style's own subtitle design (absent = the earlier look, pixel for pixel)
  if (preset.boxBorder) css.push(`border:${preset.boxBorder}`);                  // a hairline on a toast, a dialog frame
  if (preset.boxShadow) css.push(`box-shadow:${preset.boxShadow}`);              // layered frames, a soft lift
  if (preset.rule === 'top') css.push(`border-top:${preset.ruleWidth ?? 0.05}em solid ${preset.ruleColor || 'currentColor'}`, 'padding-top:.32em');
  if (preset.rule === 'left') css.push(`border-left:${preset.ruleWidth ?? 0.16}em solid ${preset.ruleColor || 'currentColor'}`, 'padding-left:.42em');
  if (preset.vertical) css.push('writing-mode:vertical-rl', 'text-orientation:mixed');
  if (preset.italic) css.push('font-style:italic');
  if (preset.uppercase) css.push('text-transform:uppercase');
  if (preset.align) css.push(`text-align:${preset.align}`);
  return css.join(';');
}

/** Replace root's children with the text items visible at t. root is an absolutely positioned width × height box. */
export function renderTextLayer(root, items, t, { width, height, presets, fallback = '简洁' }) {
  const short = Math.min(width, height), m = MARGIN * short;
  root.replaceChildren();
  for (const item of items) {
    if (!(t >= item.start && t < item.end)) continue;
    const base = presetForRole(presets[item.preset] || presets[fallback] || Object.values(presets)[0], item.role);
    const factor = SIZE_FACTOR[item.size] || 1;
    const preset = factor === 1 ? base : { ...base, size: (base.size || 0.042) * factor };
    const turn = Number(item.rotate) ? ` rotate(${Number(item.rotate)}deg)` : '';
    const [ax, ay, maxW] = BOX[item.place] || BOX.bottom;
    const r = revealAt(item, t);
    const el = document.createElement('div');
    el.dataset.textId = item.id;
    el.style.cssText = `position:absolute;max-width:${maxW * width}px;text-align:${ax === 0 ? 'left' : ax === 1 ? 'right' : 'center'};opacity:${r.whole};${styleFor(preset, short)}`;
    const x = ax === 0 ? m : ax === 1 ? width - m : width / 2, y = ay === 0 ? m : ay === 1 ? height - m * (item.role === 'caption' ? 1.4 : 1) : height / 2;
    el.style.left = `${x}px`; el.style.top = `${y}px`;
    el.style.transform = `translate(${-ax * 100}%, ${-ay * 100}%)${turn}`;
    // Explicit content sizing avoids the CSS shrink-to-fit sliver at right anchors.
    // Opt-in keeps the old presets' positioning pixel-identical.
    if (preset.layout === 'content') {
      el.style.width = 'max-content'; el.style.boxSizing = 'border-box';
      el.style.maxWidth = `${Math.min(maxW * width, width - 2 * m)}px`;
    }
    if (preset.bar) {
      el.style.left = `${m}px`; el.style.width = `${width - 2 * m}px`;
      el.style.maxWidth = 'none'; el.style.boxSizing = 'border-box';
      el.style.background = preset.barColor || 'rgba(0,0,0,.8)';
      el.style.padding = '.18em .5em';
      el.style.transform = `translate(0, ${-ay * 100}%)${turn}`;
    }
    const lines = item.text.split('\n');
    const all = r.per === 'unit' ? revealUnits(item.text.replace(/[{}]/g, '').replace(/\n/g, '')).length : 0;
    let unitIndex = 0;
    lines.forEach((line, li) => {
      const row = document.createElement('div');
      if (r.per === 'line') row.style.opacity = String(r.unit(li));
      // a small mark that opens the text (a seal square, a marker dash, a speaking dot), on its first line
      if (preset.marker && li === 0) {
        const mark = document.createElement('span');
        const [w, h, radius] = { square: [0.5, 0.5, 0.04], dash: [0.9, 0.14, 0.07], dot: [0.36, 0.36, 0.18] }[preset.marker] || [0.5, 0.5, 0];
        mark.style.cssText = `display:inline-block;width:${w}em;height:${h}em;border-radius:${radius}em;background:${preset.markerColor || preset.accent || 'currentColor'};margin-right:.42em;vertical-align:.12em`;
        row.append(mark);
      }
      for (const run of accentRuns(line)) {
        const parts = r.per === 'unit' ? revealUnits(run.text) : [run.text];
        for (const part of parts) {
          const span = document.createElement('span');
          span.textContent = part;
          if (run.accent) {
            span.style.color = preset.accent || '#ffd23f';
            if (preset.accentStyle === 'box') {
              span.style.backgroundColor = preset.accentBox || '#ffd23f';
              span.style.boxDecorationBreak = 'clone';
              span.style.webkitBoxDecorationBreak = 'clone';
            }
            if (preset.accentStyle === 'underline') {
              span.style.textDecoration = 'underline';
              span.style.textDecorationThickness = '.08em';
              span.style.textUnderlineOffset = '.12em';
            }
          }
          if (r.per === 'unit') span.style.opacity = String(r.unit(unitIndex++, all));
          row.append(span);
        }
      }
      el.append(row);
    });
    root.append(el);
  }
}
