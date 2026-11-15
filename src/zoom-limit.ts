/** How far past the whole-graph view zooming out may go: the larger of the full layout (ratio 1)
 * and the Fit all view, times this. Fit all is therefore always inside the limit. */
export const ZOOM_OUT_LIMIT = 1.8;
/** One wheel or pinch zoom step. Zooming out clamps at `limit` (never switches views); a camera
 * already past it holds. `clamped` reports a zoom-out step that hit the limit. */
export function zoomStep(ratio: number, factor: number, min: number, limit: number) {
  const want = Math.max(min, ratio * factor), cap = Math.max(ratio, limit);
  return { ratio: Math.min(want, cap), clamped: factor > 1 && want >= cap };
}

/** "Zoomed all the way out" chip with a Group overview button. Text only. `hit` reports a clamped
 * step: the chip shows once per gesture (steps under 400 ms apart) and hides after 3 s unless hovered or focused. */
export function zoomChip(parent: HTMLElement, overview: () => void) {
  const chip = parent.appendChild(Object.assign(document.createElement('div'), { className: 'graph-ng-zoom-chip', hidden: true })), text = chip.appendChild(Object.assign(document.createElement('span'), { textContent: 'Zoomed all the way out' }));
  text.setAttribute('role', 'status');
  let last = -1e9, timer: ReturnType<typeof setTimeout> | undefined;
  const hide = () => { if (chip.matches?.(':hover,:focus-within')) timer = setTimeout(hide, 3000); else chip.hidden = true; };
  const stop = () => { clearTimeout(timer); chip.hidden = true; };
  chip.appendChild(Object.assign(document.createElement('button'), { textContent: 'Group overview', onclick: () => { stop(); overview(); } }));
  return { chip, stop, hit(now: number) { if (now - last > 400) { clearTimeout(timer); chip.hidden = false; timer = setTimeout(hide, 3000); } last = now; } };
}
