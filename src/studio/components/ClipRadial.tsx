import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { volumeDb, volumeGain, volumeLabel } from '../volume-db';
import './clip-radial.css';

/**
 * One piece of the disc: a value that opens a panel on hover (变速、音量…), or an action that runs on a click
 * (分割、复制、删除…). Order matters: values first, actions after, 删除 last.
 */
export type RadialItem = { id: string; label: string; danger?: boolean; disabled?: boolean; panel?: ReactNode; run?: () => void };

const R = 126, r = 46, GAP = 2.4, CORNER = 7, CLOSE_MS = 180;

/** An annular sector with small rounded corners (S先生 10-31). Angles in degrees, 0 at the top, clockwise. */
function wedgePath(cx: number, cy: number, a0: number, a1: number) {
  const p = (a: number, radius: number) => { const t = (a - 90) * Math.PI / 180; return `${(cx + radius * Math.cos(t)).toFixed(2)} ${(cy + radius * Math.sin(t)).toFixed(2)}`; };
  const dR = CORNER / R * 180 / Math.PI, dr = CORNER / r * 180 / Math.PI;
  return `M${p(a0 + dR, R)} A${R} ${R} 0 0 1 ${p(a1 - dR, R)} Q${p(a1, R)} ${p(a1, R - CORNER)} L${p(a1, r + CORNER)} Q${p(a1, r)} ${p(a1 - dr, r)}`
    + ` A${r} ${r} 0 0 0 ${p(a0 + dr, r)} Q${p(a0, r)} ${p(a0, r + CORNER)} L${p(a0, R - CORNER)} Q${p(a0, R)} ${p(a0 + dR, R)}Z`;
}

type Place = { cx: number; cy: number; clipTop: number; clipX: number; clipLeft: number; clipRight: number };

/**
 * ⌘ 点击素材 opens this disc over the clip (S先生 10-31): frosted glass grows out of the clip's top, the pieces gather
 * in from outside one after another (all in 0.5 s), the hub ring closes. Hover a value to change it in the panel
 * beside the disc; click an action. 1–8 pick a piece, Esc or a click elsewhere closes it.
 */
export function ClipRadial({ clipId, title, items, onClose }: { clipId: string; title: string; items: RadialItem[]; onClose: () => void }) {
  const [place, setPlace] = useState<Place>();
  const [phase, setPhase] = useState<'in' | 'out'>('in');
  const [active, setActive] = useState<number>();
  const [hover, setHover] = useState<number>();
  const root = useRef<HTMLDivElement>(null), panel = useRef<HTMLDivElement>(null);
  const closing = useRef(false);
  const maskId = `clip-radial-${useId().replace(/:/g, '')}`;
  const close = () => {
    if (closing.current) return;
    closing.current = true;
    setPhase('out');
    window.setTimeout(onClose, CLOSE_MS);
  };
  const closeRef = useRef(close); closeRef.current = close;

  // Follow the clip while the timeline zooms and scrolls to it.
  useLayoutEffect(() => {
    let frame = 0;
    const follow = () => {
      const element = document.querySelector<HTMLElement>(`[data-timeline-clip-id="${CSS.escape(clipId)}"]`);
      if (!element) { closeRef.current(); return; }
      const box = element.getBoundingClientRect();
      const cx = Math.max(R + 8, Math.min(window.innerWidth - R - 8, box.left + box.width / 2));
      const cy = Math.max(R + 8, box.top - 14 - R);
      setPlace(current => current && Math.abs(current.cx - cx) < .5 && Math.abs(current.cy - cy) < .5 && Math.abs(current.clipTop - box.top) < .5 ? current
        : { cx, cy, clipTop: box.top, clipX: Math.max(box.left, Math.min(box.right, cx)),
          clipLeft: Math.max(2, box.left + 1), clipRight: Math.min(window.innerWidth - 2, box.right - 1) });
      frame = requestAnimationFrame(follow);
    };
    follow();
    return () => cancelAnimationFrame(frame);
  }, [clipId]);

  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) && event.key !== 'Escape') return;
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeRef.current(); return; }
      const index = Number(event.key) - 1;
      if (!(index >= 0 && index < items.length) || event.metaKey || event.ctrlKey || event.altKey) return;
      event.preventDefault(); event.stopPropagation();
      choose(index);
    };
    const press = (event: PointerEvent) => {
      const target = event.target as Node;
      if (root.current?.contains(target) || panel.current?.contains(target)) return;
      closeRef.current();
    };
    window.addEventListener('keydown', key, true);
    window.addEventListener('pointerdown', press, true);
    return () => { window.removeEventListener('keydown', key, true); window.removeEventListener('pointerdown', press, true); };
  });

  const choose = (index: number) => {
    const item = items[index];
    if (!item || item.disabled) return;
    if (item.panel) { setActive(index); return; }
    item.run?.();
    close();
  };

  if (!place) return null;
  const { cx, cy } = place;
  const step = 360 / items.length;
  const shown = active !== undefined ? items[active] : undefined;
  // the panel sits beside the disc, on whichever side has room
  const panelLeft = cx + R + 18 + 300 < window.innerWidth ? cx + R + 18 : cx - R - 18 - 300;
  // where each line meets the rim: on the way from the disc's centre to that end of the clip
  const rim = (x: number) => { const dx = x - cx, dy = place.clipTop - cy, length = Math.hypot(dx, dy) || 1; return `${cx + dx / length * R} ${cy + dy / length * R}`; };
  const links = [`M${place.clipLeft} ${place.clipTop} L${rim(place.clipLeft)}`, `M${place.clipRight} ${place.clipTop} L${rim(place.clipRight)}`];
  const style = { '--origin-x': `${place.clipX - (cx - R)}px`, '--origin-y': `${place.clipTop - (cy - R)}px` } as CSSProperties;

  return createPortal(<div className="clip-radial" data-phase={phase} ref={root} style={style}>
    {/* dashed lines from the clip's two ends up to the disc's rim; a mask draws them on so they stay dashed */}
    <svg className="clip-radial-links" aria-hidden="true">
      <defs><mask id={maskId} maskUnits="userSpaceOnUse" x={0} y={0} width="100%" height="100%">{links.map((d, index) => <path key={index} className="reveal" pathLength={100} d={d} />)}</mask></defs>
      <g mask={`url(#${maskId})`}>{links.map((d, index) => <path key={index} d={d} />)}</g>
    </svg>
    {/* the shadow and the glass are separate: the glass is clipped to a circle so its blur stays round */}
    <div className="clip-radial-shadow" style={{ left: cx - R, top: cy - R, width: R * 2, height: R * 2 }} />
    <div className="clip-radial-glass" style={{ left: cx - R, top: cy - R, width: R * 2, height: R * 2 }} />
    <svg className="clip-radial-disc" style={{ left: cx - R, top: cy - R }} width={R * 2} height={R * 2} role="group" aria-label={`${title} 的常用编辑`}>
      {items.map((item, index) => {
        const a0 = index * step - step / 2 + GAP / 2, a1 = index * step + step / 2 - GAP / 2;
        const t = (index * step - 90) * Math.PI / 180, mid = (R + r) / 2 + 2;
        const x = R + mid * Math.cos(t), y = R + mid * Math.sin(t);
        const hot = index === active || index === hover;
        return <g key={item.id} className="clip-radial-piece" role="button" aria-label={`${index + 1} ${item.label}`} aria-disabled={item.disabled || undefined}
          data-hot={hot ? '' : undefined} data-danger={item.danger ? '' : undefined} data-open={index === active ? '' : undefined}
          style={{ '--i': index, '--dx': `${(Math.cos(t) * 69).toFixed(1)}px`, '--dy': `${(Math.sin(t) * 69).toFixed(1)}px` } as CSSProperties}
          onPointerEnter={() => { setHover(index); if (item.panel && !item.disabled) setActive(index); }}
          onPointerLeave={() => setHover(current => current === index ? undefined : current)}
          onClick={() => choose(index)}>
          <path d={wedgePath(R, R, a0, a1)} />
          <text x={x} y={y}>{item.label}</text>
          <text className="n" x={x} y={y + 14}>{index + 1}</text>
        </g>;
      })}
      <g className="clip-radial-hub">
        <circle cx={R} cy={R} r={r - 6} pathLength={100} />
        <text x={R} y={R - 2}>{title.length > 8 ? `${title.slice(0, 7)}…` : title}</text>
        <text className="s" x={R} y={R + 13}>Esc 退出</text>
      </g>
    </svg>
    {shown?.panel && <div className="clip-radial-panel" ref={panel} key={shown.id} style={{ left: panelLeft, top: Math.max(8, cy - R) }}>
      <h4>{shown.label}</h4>
      {shown.panel}
    </div>}
  </div>, document.body);
}

/** 音量: a dB slider, changed for real when let go. */
export function RadialVolume({ volume, onChange, extra }: { volume: number; onChange: (gain: number) => void; extra?: ReactNode }) {
  const [db, setDb] = useState(volume <= 0 ? -60 : volumeDb(volume));
  const commit = () => { const gain = volumeGain(db); if (Math.abs(gain - volume) > 1e-4) onChange(gain); };
  return <div className="clip-radial-field">
    <div className="clip-radial-value">{volumeLabel(volumeGain(db))}</div>
    <input type="range" min={-60} max={20} step={0.5} value={db} aria-label="音量 dB" onChange={event => setDb(Number(event.currentTarget.value))}
      onPointerUp={commit} onKeyUp={commit} onBlur={commit} onDoubleClick={() => { setDb(0); onChange(1); }} />
    <div className="clip-radial-marks"><span>−60</span><span>0 dB</span><span>+20</span></div>
    <p>拖动后松开生效 · 双击恢复 0 dB</p>
    {extra}
  </div>;
}

/** 淡入淡出: two sliders, each at most half the clip. */
export function RadialFades({ fadeIn, fadeOut, max, onChange }: { fadeIn: number; fadeOut: number; max: number; onChange: (patch: { fadeIn?: number; fadeOut?: number }) => void }) {
  const [values, setValues] = useState({ fadeIn: Math.min(fadeIn, max), fadeOut: Math.min(fadeOut, max) });
  const row = (key: 'fadeIn' | 'fadeOut', label: string) => {
    const commit = () => { if (Math.abs(values[key] - (key === 'fadeIn' ? fadeIn : fadeOut)) > 1e-4) onChange({ [key]: values[key] }); };
    return <label className="clip-radial-row">
      <span>{label}</span>
      <input type="range" min={0} max={Math.max(0.05, max)} step={0.05} value={values[key]} aria-label={`${label}秒数`}
        onChange={event => setValues(current => ({ ...current, [key]: Number(event.currentTarget.value) }))} onPointerUp={commit} onKeyUp={commit} onBlur={commit} />
      <b>{values[key].toFixed(2)}s</b>
    </label>;
  };
  return <div className="clip-radial-field">{row('fadeIn', '淡入')}{row('fadeOut', '淡出')}<p>每头最长半个片段 · 松开生效</p></div>;
}

/** 改字: Enter keeps it, Shift+Enter for a new line. */
export function RadialText({ text, onCommit }: { text: string; onCommit: (text: string) => void }) {
  const [value, setValue] = useState(text);
  const commit = () => { if (value.trim() && value !== text) onCommit(value); };
  return <div className="clip-radial-field">
    <textarea autoFocus rows={3} value={value} onChange={event => setValue(event.currentTarget.value)} onBlur={commit}
      onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); commit(); (event.currentTarget as HTMLTextAreaElement).blur(); } }} />
    <p>回车保存 · Shift+回车换行</p>
  </div>;
}
