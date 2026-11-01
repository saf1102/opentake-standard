import { useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react';
import type { TimelineClip } from '../../types/editor';
import { gainToLevel, levelToGain, maxClipFade } from '../clip-audio';
import { volumeLabel } from '../volume-db';
import './clip-audio.css';

type AudioPatch = Partial<Pick<TimelineClip, 'volume' | 'fadeIn' | 'fadeOut'>>;

/**
 * On a sounding clip in the timeline (S先生 10-31): a dot at each end drags the fade in / out, the thin line across
 * drags the volume, with its dB beside it. They show while the pointer is over the clip; the fade ramps stay drawn.
 * The waveform follows the line through `--clip-gain-live` on the clip's media strip while dragging.
 */
/** How far in from the clip's edge a dot at 0 s sits: clear of the 11 px trim handle (and its snapping). */
const EDGE = 14;

export function ClipAudioHandles({ clip, width, onChange }: { clip: TimelineClip; width: number; onChange: (patch: AudioPatch) => void }) {
  const [draft, setDraft] = useState<AudioPatch | null>(null);
  const dragged = useRef(false);
  const shown = { volume: clip.volume, fadeIn: clip.fadeIn, fadeOut: clip.fadeOut, ...draft };
  const max = maxClipFade(clip);
  const fadeIn = Math.min(shown.fadeIn, max), fadeOut = Math.min(shown.fadeOut, max);
  const begin = (kind: 'in' | 'out' | 'volume') => (event: ReactPointerEvent<HTMLElement>) => {
    // ⌘ 点击 belongs to the clip (its disc), not to the line or the dots
    if (event.button !== 0 || event.metaKey) return;
    dragged.current = false;
    event.preventDefault(); event.stopPropagation();
    const box = event.currentTarget.closest('.clip-audio')!.getBoundingClientRect();
    const strip = event.currentTarget.closest('.timeline-clip')?.querySelector<HTMLElement>('.timeline-media-strip');
    const perSecond = box.width / Math.max(0.001, clip.duration);
    // fades land on 0.05 s and let go to nothing near the edge
    const fade = (seconds: number) => { const s = Math.max(0, Math.min(max, seconds)); return s < 0.05 ? 0 : Math.round(s * 20) / 20; };
    // by how far the pointer moved, so pressing never makes the value jump
    const start = { x: event.clientX, y: event.clientY, fadeIn, fadeOut, level: gainToLevel(shown.volume) };
    let latest: AudioPatch = {};
    const move = (e: PointerEvent) => {
      dragged.current = true;
      if (kind === 'in') latest = { fadeIn: fade(start.fadeIn + (e.clientX - start.x) / perSecond) };
      else if (kind === 'out') latest = { fadeOut: fade(start.fadeOut + (start.x - e.clientX) / perSecond) };
      else {
        latest = { volume: levelToGain(start.level - (e.clientY - start.y) / box.height) };
        strip?.style.setProperty('--clip-gain-live', String(latest.volume));
      }
      setDraft(latest);
    };
    const up = () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up);
      setDraft(null);
      if (Object.keys(latest).length) onChange(latest);
      requestAnimationFrame(() => strip?.style.removeProperty('--clip-gain-live'));
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);
  };
  // a click that ended a drag is not a click on the clip; a plain click (or ⌘ 点击) still selects it
  const stop = (event: { stopPropagation: () => void }) => { if (dragged.current) { dragged.current = false; event.stopPropagation(); } };
  const reset = (patch: AudioPatch) => (event: ReactMouseEvent) => { event.stopPropagation(); onChange(patch); };
  const top = `${(1 - gainToLevel(shown.volume)) * 100}%`;
  const inWidth = `${fadeIn / clip.duration * 100}%`, outWidth = `${fadeOut / clip.duration * 100}%`;
  return <span className="clip-audio" data-dragging={draft ? '' : undefined} onClick={stop}>
    {fadeIn > 0 && <svg className="clip-audio-ramp" style={{ left: 0, width: inWidth }} viewBox="0 0 10 10" preserveAspectRatio="none" aria-hidden><path d="M0 10 L10 0 L0 0Z" /></svg>}
    {fadeOut > 0 && <svg className="clip-audio-ramp" style={{ right: 0, width: outWidth }} viewBox="0 0 10 10" preserveAspectRatio="none" aria-hidden><path d="M10 10 L0 0 L10 0Z" /></svg>}
    <span className="clip-audio-line" style={{ top }} title="上下拖调音量；双击恢复 0 dB" onPointerDown={begin('volume')} onDoubleClick={reset({ volume: 1 })}>
      <i data-loud={shown.volume > 1 ? '' : undefined} data-below={gainToLevel(shown.volume) > 0.55 ? '' : undefined}>{volumeLabel(shown.volume)}</i>
    </span>
    {width >= 48 && <><span className="clip-audio-dot" style={{ left: `max(${EDGE}px, ${inWidth})` }} title={`淡入 ${fadeIn.toFixed(2)} 秒；往里拖加长，双击取消`}
      onPointerDown={begin('in')} onDoubleClick={reset({ fadeIn: 0 })} onClick={stop} />
    <span className="clip-audio-dot is-out" style={{ right: `max(${EDGE}px, ${outWidth})` }} title={`淡出 ${fadeOut.toFixed(2)} 秒；往里拖加长，双击取消`}
      onPointerDown={begin('out')} onDoubleClick={reset({ fadeOut: 0 })} onClick={stop} /></>}
    {draft && (draft.fadeIn !== undefined || draft.fadeOut !== undefined) && <b className="clip-audio-tip" style={draft.fadeIn !== undefined ? { left: `calc(max(${EDGE}px, ${inWidth}) + 12px)` } : { right: `calc(max(${EDGE}px, ${outWidth}) + 12px)` }}>
      {draft.fadeIn !== undefined ? `淡入 ${fadeIn.toFixed(2)}s` : `淡出 ${fadeOut.toFixed(2)}s`}</b>}
  </span>;
}
