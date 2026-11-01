import { useCallback, useEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';
import './components/preview-zoom.css';

type View = { zoom: number; x: number; y: number };
const MAX = 8;
const clampView = (view: View, width: number, height: number): View => {
  const zoom = Math.max(1, Math.min(MAX, view.zoom));
  // The picture may not leave the viewport: at most half of it past each edge.
  const limitX = Math.max(0, (width * zoom - width) / 2), limitY = Math.max(0, (height * zoom - height) / 2);
  return { zoom, x: Math.max(-limitX, Math.min(limitX, view.x)), y: Math.max(-limitY, Math.min(limitY, view.y)) };
};

/**
 * Zoom the preview about the pointer and pan it (S先生 10-31): ⌘ + wheel or a trackpad pinch zooms; holding Space,
 * or the middle button, drags the picture. Only the editor's view changes, never the film.
 */
export function usePreviewZoom(viewport: RefObject<HTMLElement | null>, canvas: { width: number; height: number }) {
  const [view, setView] = useState<View>({ zoom: 1, x: 0, y: 0 });
  const viewRef = useRef(view); viewRef.current = view;
  const space = useRef(false);
  const [panning, setPanning] = useState(false);
  const apply = useCallback((next: View) => setView(clampView(next, canvas.width, canvas.height)), [canvas.width, canvas.height]);
  const zoomAt = useCallback((factor: number, clientX?: number, clientY?: number) => {
    const element = viewport.current; if (!element) return;
    const box = element.getBoundingClientRect();
    const current = viewRef.current;
    const zoom = Math.max(1, Math.min(MAX, current.zoom * factor));
    // Keep the point under the pointer where it is: offsets are measured from the viewport's centre.
    const px = (clientX ?? box.left + box.width / 2) - (box.left + box.width / 2);
    const py = (clientY ?? box.top + box.height / 2) - (box.top + box.height / 2);
    const ratio = zoom / current.zoom;
    apply({ zoom, x: px - (px - current.x) * ratio, y: py - (py - current.y) * ratio });
  }, [apply, viewport]);
  useEffect(() => {
    const element = viewport.current; if (!element) return;
    const wheel = (event: WheelEvent) => {
      // A trackpad pinch arrives as a wheel with ctrlKey; ⌘ + wheel is the mouse way.
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      zoomAt(Math.exp(-event.deltaY * (event.ctrlKey && !event.metaKey ? 0.012 : 0.0025)), event.clientX, event.clientY);
    };
    const down = (event: PointerEvent) => {
      if (!(event.button === 1 || (event.button === 0 && space.current)) || viewRef.current.zoom <= 1) return;
      event.preventDefault(); event.stopPropagation();
      const start = { x: event.clientX, y: event.clientY, view: viewRef.current };
      setPanning(true);
      const move = (e: PointerEvent) => apply({ ...start.view, x: start.view.x + e.clientX - start.x, y: start.view.y + e.clientY - start.y });
      const up = () => { setPanning(false); window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
      window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
    };
    const typing = (target: EventTarget | null) => target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
    const keydown = (event: KeyboardEvent) => { if (event.code === 'Space' && !typing(event.target) && viewRef.current.zoom > 1 && element.matches(':hover')) { space.current = true; element.dataset.panReady = ''; } };
    const keyup = (event: KeyboardEvent) => { if (event.code === 'Space') { space.current = false; delete element.dataset.panReady; } };
    element.addEventListener('wheel', wheel, { passive: false });
    element.addEventListener('pointerdown', down, true);
    window.addEventListener('keydown', keydown); window.addEventListener('keyup', keyup);
    return () => { element.removeEventListener('wheel', wheel); element.removeEventListener('pointerdown', down, true); window.removeEventListener('keydown', keydown); window.removeEventListener('keyup', keyup); };
  }, [apply, viewport, zoomAt]);
  useEffect(() => {
    const element = viewport.current; if (!element) return;
    if (view.zoom > 1.001) element.dataset.previewZoomed = ''; else delete element.dataset.previewZoomed;
  }, [view.zoom, viewport]);
  const canvasStyle: CSSProperties = view.zoom === 1 && !view.x && !view.y ? {} : { transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`, transformOrigin: 'center center' };
  const zoomed = view.zoom > 1.001;
  /** Space held: the picture pans instead of answering presses (plays well with the editor's own drags). */
  const spaceHeld = () => space.current && zoomed;
  const fit = () => setView({ zoom: 1, x: 0, y: 0 });
  // sits over the top middle of the picture, a little in from its edge (clear of the full-screen button)
  const hud = <div className="preview-zoom-hud" data-zoomed={zoomed ? '' : undefined} data-panning={panning ? '' : undefined}
    style={{ '--preview-canvas-h': `${canvas.height}px` } as CSSProperties}>
    <button type="button" aria-label="缩小预览" onClick={() => zoomAt(1 / 1.25)} disabled={!zoomed}>−</button>
    <b>{Math.round(view.zoom * 100)}%</b>
    <button type="button" aria-label="放大预览" onClick={() => zoomAt(1.25)} disabled={view.zoom >= MAX}>+</button>
    <button type="button" className="fit" onClick={fit} disabled={!zoomed}>适应</button>
  </div>;
  // Where the zoomed view looks, drawn over the whole frame.
  const mini = zoomed ? <div className="preview-zoom-mini" aria-hidden="true">
    <i style={{
      width: `${100 / view.zoom}%`, height: `${100 / view.zoom}%`,
      left: `${50 - 50 / view.zoom - (view.x / (canvas.width * view.zoom)) * 100}%`,
      top: `${50 - 50 / view.zoom - (view.y / (canvas.height * view.zoom)) * 100}%`,
    }} />
  </div> : null;
  return { zoom: view.zoom, canvasStyle, hud, mini, fit, spaceHeld };
}
