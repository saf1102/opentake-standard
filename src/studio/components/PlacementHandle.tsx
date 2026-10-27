import { useRef, type CSSProperties } from 'react';
import { ArrowLeftRight } from 'lucide-react';

import { usePlacementDrag, type PlacementRect, type PlacementSlot } from './placement-drag';
export type { PlacementRect, PlacementSlot } from './placement-drag';

const place = (rect: PlacementRect): CSSProperties => ({ left: `${rect.x}%`, top: `${rect.y}%`, width: `${rect.width}%`, height: `${rect.height}%` });

/** The slots and the riding ghost while a drag is on (positioned in percent of the same box as the layer). */
export function PlacementSlots({ rect, slots, carry, round = false }: { rect: PlacementRect; slots: PlacementSlot[]; carry?: { dx: number; dy: number; target?: string }; round?: boolean }) {
  if (!carry) return null;
  return <>
    <div className="motion-slot-layer motion-slot-layer--picture" aria-hidden="true">
      {slots.map((slot) => <span key={slot.id} style={place(slot.rect)}
        className={`motion-slot${round ? ' is-round' : ''}${slot.current ? ' is-current' : ''}${carry.target === slot.id ? ' is-target' : ''}`}>
        <span className="motion-slot__box"><span>{slot.current ? `${slot.label} · 当前` : slot.label}</span></span>
      </span>)}
    </div>
    <div className={`placement-ghost${round ? ' is-round' : ''}`} style={{ ...place(rect), translate: `${carry.dx}px ${carry.dy}px` }} aria-hidden="true" />
  </>;
}

/** The swap handle for a picture layer that sits in preset positions (a picture-in-picture, the person over a full
 *  card). Same gesture as on motion cards (usePlacementDrag). `framed` draws the selection frame for layers that have
 *  none of their own. */
export function PlacementHandle({ rect, round = false, framed = false, slots, onPlace }: {
  rect: PlacementRect;
  round?: boolean;
  framed?: boolean;
  slots: PlacementSlot[];
  onPlace: (id: string) => void;
}) {
  const anchor = useRef<HTMLDivElement>(null);
  // percentages resolve against the containing block (a wrapper may be display: contents and have no box)
  const { begin, carry } = usePlacementDrag({ rect, slots, onPlace, bounds: () => (anchor.current?.offsetParent as HTMLElement | null)?.getBoundingClientRect() });
  return <>
    <PlacementSlots rect={rect} slots={slots} carry={carry} round={round} />
    <div ref={anchor} className={`placement-frame${framed ? ' is-framed' : ''}${round ? ' is-round' : ''}`} style={place(rect)}>
      <button type="button" className={`motion-swap-button${carry ? ' is-carrying' : ''}`} aria-label="按住拖到想放的位置" title="按住拖到九宫格的位置"
        onPointerDown={begin} onClick={(event) => event.stopPropagation()} onDoubleClick={(event) => event.stopPropagation()}>
        <ArrowLeftRight />
      </button>
    </div>
  </>;
}
