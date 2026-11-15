import { test, expect } from 'bun:test';
import { toValue, toPosition, fineFactor, fineLabel, keyStep, progressiveSlider, STEPS, type Curve } from '../src/progressive-slider';
import { ControlElement } from './support/controls-dom';
const curves: Curve[] = [{ min: 0, max: 1, k: 2.5 }, { min: 0, max: 1 }, { min: .01, max: 20, k: 3 }, { min: .1, max: 100, log: true }, { min: .25, max: 3, log: true }, { min: 0, max: 20, k: 3 }];
test('progressive mapping: exact endpoints, monotonic and round-trips within value precision', () => {
  for (const c of curves) {
    expect(toValue(c, 0)).toBe(c.min); expect(toValue(c, 1)).toBe(c.max); expect(toValue(c, -5)).toBe(c.min); expect(toValue(c, 9)).toBe(c.max);
    expect(toPosition(c, c.min)).toBe(0); expect(toPosition(c, c.max)).toBe(1); expect(toPosition(c, c.max * 10)).toBe(1); expect(toPosition(c, NaN)).toBe(0);
    let prev = -Infinity, prevPos = -Infinity;
    for (let i = 0; i <= STEPS; i++) {
      const v = toValue(c, i / STEPS); expect(v).toBeGreaterThanOrEqual(prev); prev = v;
      const back = toPosition(c, v); expect(back).toBeGreaterThanOrEqual(prevPos); prevPos = back;
      expect(Math.abs(toValue(c, back) - v)).toBeLessThanOrEqual(Math.abs(v) * 1e-3 + 1e-12);
    }
  }
});
test('progressive curves put more resolution in the commonly tuned low range', () => {
  expect(toValue({ min: 0, max: 1, k: 2.5 }, .5)).toBeLessThan(.2); expect(toValue({ min: .1, max: 100, log: true }, 1 / 3)).toBeCloseTo(1, 2);
});
test('fine scrub sensitivity falls progressively with vertical distance', () => {
  expect([0, 29, 30, 79, 80, 149, 150, 1e4].map(fineFactor)).toEqual([1, 1, .5, .5, .25, .25, .1, .1]);
  expect(fineLabel(.25)).toBe('Fine: ¼ speed'); expect(fineLabel(.5)).toBe('Fine: ½ speed'); expect(fineLabel(.1)).toBe('Fine: 1/10 speed');
});
test('keyboard steps: arrows small, Shift larger, Page largest, Home/End to ends', () => {
  expect(keyStep('ArrowRight', false)).toBe(.004); expect(keyStep('ArrowDown', false)).toBe(-.004); expect(keyStep('ArrowUp', true)).toBe(.04);
  expect(keyStep('PageUp', false)).toBe(.1); expect(keyStep('PageDown', true)).toBe(-.1); expect(keyStep('Home', false)).toBe(-1); expect(keyStep('End', false)).toBe(1); expect(keyStep('a', false)).toBeNull();
});
function mount(value: string) {
  const row = new ControlElement(), number: any = row.createEl('input', { attr: { type: 'number' } }), seen: string[] = []; let commits = 0; number.value = value;
  const range: any = progressiveSlider(row as any, number, 'Glow', { min: 0, max: 1, k: 2 }, v => seen.push(v), () => commits++);
  Object.assign(range, { getBoundingClientRect: () => ({ left: 0, top: 0, width: 200, height: 20 }), setPointerCapture() {}, focus() {} });
  return { number, range, seen, commits: () => commits, hint: row.querySelector('.graph-ng-fine-hint')! };
}
test('slider keeps real-value aria, keyboard moves through the curve and commits', () => {
  const m = mount('0.25'); expect(Number(m.range.value)).toBeCloseTo(500, 6); expect(m.range.getAttribute('aria-valuenow')).toBe('0.25');
  const key = (k: string, shiftKey = false) => m.range.onkeydown({ key: k, shiftKey, preventDefault() {} });
  key('PageUp'); expect(m.number.value).toBe('0.36'); key('End'); expect(m.number.value).toBe('1'); expect(m.range.getAttribute('aria-valuetext')).toBe('1');
  key('Home'); expect(m.seen).toEqual(['0.36', '1', '0']); expect(m.commits()).toBe(3);
  m.number.value = '5'; m.number.oninput(); expect(m.range.value).toBe(String(STEPS)); expect(m.seen.at(-1)).toBe('5');
});
test('pointer drag scrubs at reduced speed away from the track and shows the hint', () => {
  const m = mount('0.25'), ev = (x: number, y: number) => ({ clientX: x, clientY: y, pointerId: 1, button: 0, preventDefault() {} });
  m.range.onpointerdown(ev(100, 10)); expect(m.seen).toEqual([]); // pressed on the thumb: no jump
  m.range.onpointermove(ev(120, 10)); expect(Number(m.range.value)).toBeCloseTo(600, 6); expect(m.hint.hidden).toBe(true);
  m.range.onpointermove(ev(140, 200)); expect(Number(m.range.value)).toBeCloseTo(610, 6); expect(m.hint.hidden).toBe(false); expect(m.hint.textContent).toBe('Fine: 1/10 speed');
  m.range.onpointerup(ev(140, 200)); expect(m.hint.hidden).toBe(true); expect(m.commits()).toBe(1);
  m.range.onpointerdown(ev(0, 10)); expect(m.number.value).toBe('0'); m.range.onpointercancel(ev(0, 10)); expect(m.commits()).toBe(2);
});

test('integer curves only produce whole numbers', async () => {
  const { toValue } = await import('../src/progressive-slider');
  for (let t = 0; t <= 1; t += 0.037) expect(Number.isInteger(toValue({ min: 1, max: 1000, log: true, int: true }, t))).toBe(true);
});
