import { useEffect, useState } from 'react';

/** Preview playback speed (S先生 10-31: 1×, 2×, 4× only). It changes how fast the preview plays, never the film. */
export const PREVIEW_SPEEDS = [1, 2, 4] as const;
export type PreviewSpeed = typeof PREVIEW_SPEEDS[number];

let current: PreviewSpeed = 1;
const EVENT = 'opentake-preview-speed';

export const getPreviewSpeed = () => current;

export function setPreviewSpeed(value: PreviewSpeed) {
  if (!PREVIEW_SPEEDS.includes(value) || value === current) return;
  current = value;
  window.dispatchEvent(new CustomEvent(EVENT, { detail: value }));
}

export function usePreviewSpeed(): PreviewSpeed {
  const [speed, setSpeed] = useState(current);
  useEffect(() => {
    const changed = () => setSpeed(current);
    window.addEventListener(EVENT, changed);
    return () => window.removeEventListener(EVENT, changed);
  }, []);
  return speed;
}
