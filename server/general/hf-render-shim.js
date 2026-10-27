// OpenTake's export of a HyperFrames film (export B, our own frame renderer): __otRender over the runtime's
// window.__hf, with every <video> painted by a stand-in picture of the exact source frame (extracted beforehand).
(() => {
  const FPS = window.__otFps || 30;
  const style = document.createElement('style');
  style.textContent = 'video[data-ot-standin]{visibility:hidden!important}';
  document.head.append(style);
  const until = async (ok, ms = 45000) => { const t0 = Date.now(); while (!ok()) { if (Date.now() - t0 > ms) throw new Error('HyperFrames 运行时没有就绪'); await new Promise(r => setTimeout(r, 20)); } };
  const ready = async () => {
    await until(() => window.__hf && typeof window.__hf.seek === 'function' && window.__hf.duration > 0);
    const reg = (window.__hf && window.__hf.buildReady) || {};
    await Promise.all(Object.values(reg).map(p => Promise.resolve(p).catch(() => {})));
    await document.fonts.ready;
  };
  const visible = el => { for (let e = el.parentElement; e; e = e.parentElement) { const cs = getComputedStyle(e); if (cs.display === 'none' || cs.visibility === 'hidden') return false; } return true; };
  const shown = new Map();
  window.__otRender = {
    async select(id) {
      await ready();
      // GSAP .from() records its start values on the first seek: every page starts at frame 0 (as HyperFrames does)
      window.__hf.seek(0, { suppressEvents: true });
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      const root = document.querySelector('[data-composition-id]');
      return { id, width: +root.dataset.width || 1920, height: +root.dataset.height || 1080, fps: FPS, durationInFrames: Math.round(window.__hf.duration * FPS) };
    },
    async seek(frame) {
      const t = frame / FPS;
      window.__hf.seek(t, { suppressEvents: false });
      // the person's edits (hf-edit-bridge.js), in case the seek mounted something new
      window.__otApplyEdits?.();
      const waits = [];
      for (const v of document.querySelectorAll('video[data-start]')) {
        v.setAttribute('data-ot-standin', '');
        // clip starts snap to the composition's frame grid (HyperFrames quantizes timing to frames)
        const start = Math.round(+v.dataset.start * FPS) / FPS, dur = +(v.dataset.duration || 0), rate = +(v.dataset.playbackRate || 1), m0 = +(v.dataset.mediaStart || 0);
        let img = shown.get(v);
        if (!img) { img = document.createElement('img'); img.className = v.className; img.alt = ''; v.after(img); shown.set(v, img); }
        // the stand-in takes the video's whole box (padding moves a contained picture) and the runtime's per-frame state
        const cs = getComputedStyle(v);
        for (const k of ['position', 'left', 'top', 'right', 'bottom', 'width', 'height', 'boxSizing', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'margin', 'objectFit', 'objectPosition', 'background', 'borderRadius', 'opacity', 'transform', 'translate', 'scale', 'rotate', 'transformOrigin', 'filter', 'clipPath', 'mixBlendMode', 'zIndex']) img.style[k] = cs[k];
        const active = t >= start && t < start + dur && v.style.visibility !== 'hidden' && cs.display !== 'none' && visible(v);
        img.style.visibility = active ? 'visible' : 'hidden';
        if (!active) continue;
        const mt = m0 + (t - start) * rate, abs = decodeURIComponent(new URL(v.getAttribute('src'), location.href).pathname);
        const info = (window.__otVideos || {})[abs];
        if (!info) continue;
        // the frame a <video> shows at mt: the last one whose own timestamp is at or before it
        let idx = 0, lo = 0, hi = info.pts.length - 1;
        while (lo <= hi) { const m = (lo + hi) >> 1; if (info.pts[m] <= mt + 1e-6) { idx = m; lo = m + 1; } else hi = m - 1; }
        const src = `/__ot_frames/${info.key}/${Math.min(info.count - 1, idx)}.jpg`;
        if (img.getAttribute('src') !== src) { img.src = src; waits.push(img.decode().catch(() => {})); }
      }
      await Promise.all(waits);
      // rAF-driven updates (counters, canvas) land a tick after the seek
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    },
  };
})();
