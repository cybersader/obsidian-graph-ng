/** Shared progressive range slider: curve-mapped position, exact numeric input, fine scrubbing. Stored values keep their own units. */
export interface Curve { min: number; max: number; /** power curve exponent; >1 adds resolution near min */ k?: number; /** logarithmic (min > 0) */ log?: boolean }
export const STEPS = 1000;
const clamp01 = (t: number) => t > 0 ? t < 1 ? t : 1 : 0;
/** Slider position 0–1 → value; endpoints exact, interior rounded to 4 significant digits. */
export function toValue(c: Curve, t: number): number {
  t = clamp01(t); if (t === 0) return c.min; if (t === 1) return c.max;
  const v = c.log ? c.min * (c.max / c.min) ** t : c.min + (c.max - c.min) * t ** (c.k ?? 1);
  return Math.min(c.max, Math.max(c.min, Number(v.toPrecision(4))));
}
/** Value → slider position 0–1; out-of-range values pin to an end without changing the value. */
export function toPosition(c: Curve, v: number): number {
  if (!(v > c.min)) return 0; if (v >= c.max) return 1;
  return c.log ? Math.log(v / c.min) / Math.log(c.max / c.min) : ((v - c.min) / (c.max - c.min)) ** (1 / (c.k ?? 1));
}
/** Drag speed by vertical pointer distance (CSS px) from the track centre. */
export const fineFactor = (dy: number) => dy < 30 ? 1 : dy < 80 ? .5 : dy < 150 ? .25 : .1;
export const fineLabel = (f: number) => `Fine: ${f === .5 ? '½' : f === .25 ? '¼' : '1/10'} speed`;
/** Keyboard position delta: arrows 0.4%, Shift+arrows 4%, PageUp/Down 10%, Home/End full range. */
export function keyStep(key: string, shift: boolean): number | null {
  const dir = key === 'ArrowUp' || key === 'ArrowRight' || key === 'PageUp' || key === 'End' ? 1 : key === 'ArrowDown' || key === 'ArrowLeft' || key === 'PageDown' || key === 'Home' ? -1 : 0;
  return !dir ? null : dir * (key.startsWith('Page') ? .1 : key.length < 5 || key === 'Home' ? 1 : shift ? .04 : .004);
}

/** Attach a progressive range after `number`; the number input remains the exact editable readout. */
export function progressiveSlider(parent: HTMLElement, number: HTMLInputElement, label: string, c: Curve, changed: (value: string) => void, commit?: () => void) {
  const range = parent.createEl('input', { attr: { type: 'range', min: '0', max: String(STEPS), step: 'any', 'aria-label': `${label} slider`, 'aria-valuemin': String(c.min), 'aria-valuemax': String(c.max) } });
  const hint = parent.createSpan({ cls: 'graph-ng-fine-hint', attr: { 'aria-hidden': 'true' } }); hint.hidden = true;
  range.disabled = number.disabled;
  let pos = 0, drag: { id: number; x: number } | null = null;
  const show = (raw: string, t: number) => {
    const n = raw.trim() ? Number(raw) : NaN; pos = clamp01(t); range.value = String(pos * STEPS);
    if (Number.isFinite(n)) { range.setAttribute('aria-valuenow', String(n)); range.setAttribute('aria-valuetext', raw); }
  };
  const move = (t: number) => {
    const v = String(toValue(c, t)), same = v === number.value; number.value = v; show(v, t); if (!same) changed(v);
  };
  show(number.value, toPosition(c, number.value.trim() ? Number(number.value) : NaN));
  number.oninput = () => { show(number.value, toPosition(c, number.value.trim() ? Number(number.value) : NaN)); changed(number.value); };
  range.oninput = () => { if (!drag) move(Number(range.value) / STEPS); };
  if (commit) range.onchange = number.onchange = commit;
  range.ontouchstart = e => e.preventDefault();
  range.onpointerdown = e => {
    const r = range.getBoundingClientRect(); if (range.disabled || e.button > 0 || !r.width) return;
    e.preventDefault(); const at = clamp01((e.clientX - r.left) / r.width);
    if (Math.abs(at - pos) * r.width > 10) move(at);
    drag = { id: e.pointerId, x: e.clientX }; range.setPointerCapture(e.pointerId); range.focus();
  };
  range.onpointermove = e => {
    const r = range.getBoundingClientRect(); if (!drag || e.pointerId !== drag.id || !r.width) return;
    const f = fineFactor(Math.abs(e.clientY - r.top - r.height / 2)); hint.hidden = f === 1; hint.textContent = fineLabel(f);
    move(pos + (e.clientX - drag.x) / r.width * f); drag.x = e.clientX;
  };
  range.onpointerup = range.onpointercancel = e => { if (!drag || e.pointerId !== drag.id) return; drag = null; hint.hidden = true; commit?.(); };
  range.onkeydown = e => { const d = keyStep(e.key, e.shiftKey); if (d === null || range.disabled) return; e.preventDefault(); move(pos + d); commit?.(); };
  return range;
}
