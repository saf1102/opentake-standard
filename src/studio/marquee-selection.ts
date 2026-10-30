export type SelectionRect = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

export function normalizedSelectionRect(
  startX: number,
  startY: number,
  endX: number,
  endY: number,
): SelectionRect {
  return {
    left: Math.min(startX, endX),
    top: Math.min(startY, endY),
    right: Math.max(startX, endX),
    bottom: Math.max(startY, endY),
  };
}

export function selectionRectsIntersect(
  left: SelectionRect,
  right: SelectionRect,
) {
  return !(
    left.right < right.left ||
    left.left > right.right ||
    left.bottom < right.top ||
    left.top > right.bottom
  );
}

export function mergeMarqueeSelection(
  initialIds: string[],
  hitIds: string[],
  additive: boolean,
) {
  if (!additive) return [...new Set(hitIds)];
  return [...new Set([...initialIds, ...hitIds])];
}
