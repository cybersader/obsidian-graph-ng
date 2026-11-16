import { setIcon } from 'obsidian';
import { settingRow } from './panel-help';
/** Shared progressive range slider: curve-mapped position, exact numeric chip, fine scrubbing. Stored values keep their own units. */
export interface Curve { min: number; max: number; /** power curve exponent; >1 adds resolution near min */ k?: number; /** logarithmic (min > 0) */ log?: boolean; /** whole numbers only */ int?: boolean }
export const STEPS = 1000;
const clamp01 = (t: number) => t > 0 ? t < 1 ? t : 1 : 0;
/** Slider position 0–1 → value; endpoints exact, interior rounded to 4 significant digits. */
export function toValue(c: Curve, t: number): number {
  t = clamp01(t); if (t === 0) return c.min; if (t === 1) return c.max;
  const v = c.log ? c.min * (c.max / c.min) ** t : c.min + (c.max - c.min) * t ** (c.k ?? 1);
  return Math.min(c.max, Math.max(c.min, c.int ? Math.round(v) : Number(v.toPrecision(4))));
}
/** Value → slider position 0–1; out-of-range values pin to an end without changing the value. */
export function toPosition(c: Curve, v: number): number {
  if (!(v > c.min)) return 0; if (v >= c.max) return 1;
  return c.log ? Math.log(v / c.min) / Math.log(c.max / c.min) : ((v - c.min) / (c.max - c.min)) ** (1 / (c.k ?? 1));
}
/** Drag speed by vertical pointer distance (CSS px) from the track centre. */
export const fineFactor = (dy: number) => dy < 30 ? 1 : dy < 80 ? .5 : dy < 150 ? .25 : .1;
export const fineLabel = (f: number) => `fine ×${f}`;
/** Keyboard position delta: arrows 0.4%, Shift+arrows 4%, PageUp/Down 10%, Home/End full range. */
export function keyStep(key: string, shift: boolean): number | null {
  const dir = key === 'ArrowUp' || key === 'ArrowRight' || key === 'PageUp' || key === 'End' ? 1 : key === 'ArrowDown' || key === 'ArrowLeft' || key === 'PageDown' || key === 'Home' ? -1 : 0;
  return !dir ? null : dir * (key.startsWith('Page') ? .1 : key.length < 5 || key === 'Home' ? 1 : shift ? .04 : .004);
}
/** Number-chip arrow step in value units: a round decimal near 1% of the span (log curves: of the value), ×10 with Shift.
 * In-range values stay in range; a typed out-of-range value steps unclamped. */
export function chipStep(c: Curve, v: number, dir: 1 | -1, big: boolean): number {
  const mag = c.log ? Math.max(Math.abs(dir < 0 ? v * .999 : v), c.min) : c.max - c.min;
  let step = 10 ** (c.log ? Math.floor(Math.log10(mag)) - 1 : Math.round(Math.log10(mag)) - 2) * (big ? 10 : 1);
  if (c.int) step = Math.max(1, Math.round(step));
  const next = Number((v + dir * step).toPrecision(12));
  return v < c.min || v > c.max ? next : Math.min(c.max, Math.max(c.min, next));
}
/** Thumb diameter in CSS px (styles.css); markers sit where the thumb centre would. */
const THUMB = 16;
const at = (t: number) => `calc(${(t * 100).toFixed(2)}% + ${(THUMB / 2 - THUMB * t).toFixed(2)}px)`;
export interface SliderOptions {
  /** Accessible name of the number chip; the range is named "<label> slider". */
  label: string;
  /** Visible name when it differs from `label`. */
  name?: string;
  /** On-demand help attached to the name. */
  desc?: string;
  unit?: string;
  curve: Curve;
  value: string;
  /** Default value: a tick on the track, plus reset (icon or double-click the thumb) while the value differs. */
  def?: number;
  disabled?: boolean;
  /** Extra attributes for the number chip (min, max, step). */
  attr?: Record<string, string>;
  cls?: string;
  changed: (value: string) => void;
  commit?: () => void;
}
/** Name with on-demand help, then track, exact value and a fixed reset slot. */
export function progressiveSlider(parent: HTMLElement, o: SliderOptions) {
  const { curve: c, unit = '', def } = o, name = o.name ?? o.label;
  const row = settingRow(parent, name, `graph-ng-slider${o.cls ? ` ${o.cls}` : ''}`, o.desc);
  const reset = row.createEl('button', { cls: 'clickable-icon graph-ng-slider-reset', attr: { 'aria-label': `Reset ${name} to ${def}${unit ? ` ${unit}` : ''}` } });
  setIcon(reset, 'rotate-ccw');
  const line = row.createDiv({ cls: 'graph-ng-slider-line' }), track = line.createDiv({ cls: 'graph-ng-slider-track' });
  const scale = track.createSpan({ cls: 'graph-ng-slider-scale', attr: { 'aria-hidden': 'true' } });
  const fill = track.createSpan({ cls: 'graph-ng-slider-fill', attr: { 'aria-hidden': 'true' } });
  const tick = track.createSpan({ cls: 'graph-ng-slider-tick', attr: { 'aria-hidden': 'true', title: `Default ${def}` } });
  const range = track.createEl('input', { attr: { type: 'range', min: '0', max: String(STEPS), step: 'any', 'aria-label': `${o.label} slider`, 'aria-valuemin': String(c.min), 'aria-valuemax': String(c.max) } });
  const bubble = track.createDiv({ cls: 'graph-ng-slider-bubble', attr: { 'aria-hidden': 'true' } }), shown = bubble.createSpan(), mode = bubble.createSpan({ cls: 'graph-ng-slider-mode' });
  const chip = line.createEl('label', { cls: 'graph-ng-slider-chip' });
  const number = chip.createEl('input', { attr: { type: 'number', step: 'any', 'aria-label': o.label, ...o.attr } });
  if (unit) chip.createSpan({ cls: 'graph-ng-slider-unit', text: unit, attr: { 'aria-hidden': 'true' } });
  line.appendChild(reset);
  number.value = o.value; bubble.hidden = mode.hidden = true;
  range.disabled = number.disabled = reset.disabled = !!o.disabled;
  if (def === undefined) tick.hidden = true; else tick.style.left = at(toPosition(c, def));
  const numeric = (raw: string) => raw.trim() ? Number(raw) : NaN;
  let pos = 0, drag: { id: number; x: number } | null = null;
  const show = (raw: string, t: number) => {
    const n = numeric(raw); pos = clamp01(t); range.value = String(pos * STEPS);
    // The bubble leans inward near the ends so it never leaves the panel.
    fill.style.width = bubble.style.left = at(pos); bubble.style.transform = `translateX(-${(pos * 100).toFixed(1)}%)`; shown.textContent = `${raw}${unit ? ` ${unit}` : ''}`;
    reset.hidden = def === undefined || n === def;
    if (Number.isFinite(n)) { range.setAttribute('aria-valuenow', String(n)); range.setAttribute('aria-valuetext', shown.textContent); }
  };
  const set = (v: string, t = toPosition(c, numeric(v))) => { const same = v === number.value; number.value = v; show(v, t); if (!same) o.changed(v); };
  const move = (t: number) => set(String(toValue(c, t)), t);
  const fine = (f: number) => { mode.hidden = f === 1; mode.textContent = f < 1 ? fineLabel(f) : ''; track.toggleClass('is-fine', f < 1); scale.style.backgroundSize = `${Math.round(6 / f)}px 100%`; };
  const restore = () => { if (def === undefined || range.disabled) return; set(String(def)); o.commit?.(); };
  show(number.value, toPosition(c, numeric(number.value)));
  number.oninput = () => { show(number.value, toPosition(c, numeric(number.value))); o.changed(number.value); };
  number.onkeydown = e => {
    const dir = e.key === 'ArrowUp' ? 1 : e.key === 'ArrowDown' ? -1 : 0; if (!dir || number.disabled) return;
    e.preventDefault(); const n = numeric(number.value);
    set(String(chipStep(c, Number.isFinite(n) ? n : def ?? c.min, dir, e.shiftKey))); o.commit?.();
  };
  reset.onclick = restore; range.ondblclick = restore;
  range.oninput = () => { if (!drag) move(Number(range.value) / STEPS); };
  if (o.commit) range.onchange = number.onchange = o.commit;
  range.ontouchstart = e => e.preventDefault();
  range.onpointerdown = e => {
    const r = range.getBoundingClientRect(); if (drag || range.disabled || e.button > 0 || !r.width) return;
    e.preventDefault(); const t = clamp01((e.clientX - r.left - THUMB / 2) / Math.max(1, r.width - THUMB));
    if (Math.abs(t - pos) * r.width > 10) move(t);
    drag = { id: e.pointerId, x: e.clientX }; range.setPointerCapture(e.pointerId); range.focus(); bubble.hidden = false; fine(1);
  };
  range.onpointermove = e => {
    const r = range.getBoundingClientRect(); if (!drag || e.pointerId !== drag.id || !r.width) return;
    const f = fineFactor(Math.abs(e.clientY - r.top - r.height / 2)); fine(f);
    // The magnified scale travels with the pointer while the thumb moves f times as far.
    scale.style.backgroundPosition = `${Math.round(e.clientX - r.left)}px 0`;
    move(f === 1 ? (e.clientX - r.left - THUMB / 2) / Math.max(1, r.width - THUMB) : pos + (e.clientX - drag.x) / Math.max(1, r.width - THUMB) * f); drag.x = e.clientX;
  };
  range.onpointerup = range.onpointercancel = range.onlostpointercapture = e => { if (!drag || e.pointerId !== drag.id) return; drag = null; bubble.hidden = true; fine(1); o.commit?.(); };
  range.onkeydown = e => { const d = keyStep(e.key, e.shiftKey); if (d === null || range.disabled) return; e.preventDefault(); move(pos + d); o.commit?.(); };
  return { row, range, number, reset, sync: (value: string) => { number.value = value; show(value, toPosition(c, numeric(value))); } };
}
