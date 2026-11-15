/** One wheel or pinch zoom step. With a focus held (a selection or the lens), zooming out clamps at
 * `limit` (the Group overview threshold) and never asks for the overview; without one, reaching
 * `limit` hands over as before. Zooming in is never clamped by `limit`. */
export function zoomStep(ratio: number, factor: number, min: number, max: number, limit: number, hold: boolean) {
  let next = Math.max(min, Math.min(max, ratio * factor));
  if (hold) next = Math.min(next, Math.max(ratio, limit));
  return { ratio: next, overview: !hold && next >= limit };
}
/** The camera sits at (or beyond) the clamp. */
export const atZoomLimit = (ratio: number, limit: number) => ratio >= limit * .999;

/** "Zoomed all the way out" chip with a Group overview button. Text only. */
export function zoomChip(parent: HTMLElement, overview: () => void) {
  const chip = parent.appendChild(Object.assign(document.createElement('div'), { className: 'graph-ng-zoom-chip' })), text = chip.appendChild(Object.assign(document.createElement('span'), { textContent: 'Zoomed all the way out' }));
  text.setAttribute('role', 'status');
  const go = chip.appendChild(Object.assign(document.createElement('button'), { textContent: 'Group overview' })); go.onclick = overview;
  chip.hidden = true; return chip;
}
