import { useState, type PointerEvent as ReactPointerEvent } from 'react';

/** A rectangle in percent of the box the layer is positioned in. */
export type PlacementRect = { x: number; y: number; width: number; height: number };
export type PlacementSlot = { id: string; label: string; rect: PlacementRect; current: boolean };

/** The drag behind every swap handle: press and drag past 4 px and the preset slots appear, a ghost of the layer rides
 *  with the pointer, and it lands in the slot it is over on release. A press without a drag does nothing; Esc cancels.
 *  `bounds` is the box the percentages refer to. Shared by the 口播 preview's handles and the general preview's 移动. */
export function usePlacementDrag({ rect, slots, onPlace, bounds }: {
  rect: PlacementRect; slots: PlacementSlot[]; onPlace: (id: string) => void; bounds: () => DOMRect | undefined;
}) {
  const [carry, setCarry] = useState<{ dx: number; dy: number; target?: string }>();
  const begin = (event: ReactPointerEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const box = bounds();
    if (!box || !slots.length) return;
    const startX = event.clientX;
    const startY = event.clientY;
    const home = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    let target: PlacementSlot | undefined;
    let moved = false;
    const move = (next: PointerEvent) => {
      const dx = next.clientX - startX;
      const dy = next.clientY - startY;
      moved = moved || Math.hypot(dx, dy) > 4;
      if (!moved) return;
      const x = home.x + dx / box.width * 100;
      const y = home.y + dy / box.height * 100;
      const centre = (slot: PlacementSlot) => (slot.rect.x + slot.rect.width / 2 - x) ** 2 + (slot.rect.y + slot.rect.height / 2 - y) ** 2;
      target = slots.reduce((best, slot) => centre(slot) < centre(best) ? slot : best);
      setCarry({ dx, dy, target: target.id });
    };
    const finish = (keep: boolean) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('keydown', key, true);
      setCarry(undefined);
      if (keep && moved && target && !target.current) onPlace(target.id);
    };
    const up = () => finish(true);
    const key = (next: KeyboardEvent) => { if (next.key === 'Escape') { next.stopPropagation(); finish(false); } };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('keydown', key, true);
  };
  return { begin, carry };
}

