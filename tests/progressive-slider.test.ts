import { test, expect } from 'bun:test';
import './support/obsidian-fixture';
const { toValue, toPosition, fineFactor, fineLabel, keyStep, chipStep, progressiveSlider, STEPS } = await import('../src/progressive-slider');
type Curve = import('../src/progressive-slider').Curve;
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
  expect(fineLabel(.25)).toBe('fine ×0.25'); expect(fineLabel(.5)).toBe('fine ×0.5'); expect(fineLabel(.1)).toBe('fine ×0.1');
});
test('keyboard steps: arrows small, Shift larger, Page largest, Home/End to ends', () => {
  expect(keyStep('ArrowRight', false)).toBe(.004); expect(keyStep('ArrowDown', false)).toBe(-.004); expect(keyStep('ArrowUp', true)).toBe(.04);
  expect(keyStep('PageUp', false)).toBe(.1); expect(keyStep('PageDown', true)).toBe(-.1); expect(keyStep('Home', false)).toBe(-1); expect(keyStep('End', false)).toBe(1); expect(keyStep('a', false)).toBeNull();
});
function mount(value: string, extra: Record<string, unknown> = {}) {
  const host = new ControlElement(), seen: string[] = []; let commits = 0;
  const { row, range, number, reset }: any = progressiveSlider(host as any, { label: 'Glow', curve: { min: 0, max: 1, k: 2 }, value, changed: v => seen.push(v), commit: () => commits++, ...extra });
  // Track is 200 px wide; the 16 px thumb centre travels 184 px.
  Object.assign(range, { getBoundingClientRect: () => ({ left: 0, top: 0, width: 200, height: 32 }), setPointerCapture() {}, focus() {} });
  const q = (cls: string) => row.querySelector(`.${cls}`)!;
  return { row, number, range, reset, seen, commits: () => commits, bubble: q('graph-ng-slider-bubble'), mode: q('graph-ng-slider-mode'), tick: q('graph-ng-slider-tick'), track: q('graph-ng-slider-track') };
}
test('slider keeps real-value aria, keyboard moves through the curve and commits', () => {
  const m = mount('0.25'); expect(Number(m.range.value)).toBeCloseTo(500, 6); expect(m.range.getAttribute('aria-valuenow')).toBe('0.25');
  const key = (k: string, shiftKey = false) => m.range.onkeydown({ key: k, shiftKey, preventDefault() {} });
  key('PageUp'); expect(m.number.value).toBe('0.36'); key('End'); expect(m.number.value).toBe('1'); expect(m.range.getAttribute('aria-valuetext')).toBe('1');
  key('Home'); expect(m.seen).toEqual(['0.36', '1', '0']); expect(m.commits()).toBe(3);
  key('ArrowRight'); expect(m.number.value).toBe('0.000016'); key('ArrowRight', true); expect(Number(m.range.value)).toBeCloseTo(44, 6);
  m.number.value = '5'; m.number.oninput(); expect(m.range.value).toBe(String(STEPS)); expect(m.seen.at(-1)).toBe('5');
});
test('ARIA: the range is a named slider with real min, max, now and unit-bearing text; the chip is named by the label', () => {
  const m = mount('4', { label: 'Node size', unit: 'px', curve: { min: .01, max: 20, k: 3 } });
  expect(m.range.getAttribute('type')).toBe('range'); expect(m.range.getAttribute('aria-label')).toBe('Node size slider');
  expect([m.range.getAttribute('aria-valuemin'), m.range.getAttribute('aria-valuemax'), m.range.getAttribute('aria-valuenow'), m.range.getAttribute('aria-valuetext')]).toEqual(['0.01', '20', '4', '4 px']);
  expect(m.number.getAttribute('type')).toBe('number'); expect(m.number.getAttribute('aria-label')).toBe('Node size');
  expect(m.row.querySelector('.graph-ng-slider-unit').textContent).toBe('px'); expect(m.bubble.getAttribute('aria-hidden')).toBe('true');
  expect(m.row.querySelector('.graph-ng-setting-name').textContent).toBe('Node size');
  const d = mount('1', { desc: 'Soft light around notes' }); expect(d.row.querySelector('.graph-ng-help-popover').textContent).toBe('Soft light around notes'); expect(d.row.querySelector('.graph-ng-help-popover').hidden).toBe(true);
  const off = mount('1', { disabled: true }); expect([off.range.disabled, off.number.disabled, off.reset.disabled]).toEqual([true, true, true]);
});
test('default tick sits at the default position; reset shows only off-default and restores by icon or double-click', () => {
  const none = mount('0.25'); expect(none.tick.hidden).toBe(true); expect(none.reset.hidden).toBe(true);
  const m = mount('0.25', { def: .25 }); expect(m.tick.hidden).toBe(false); expect(m.tick.style.left).toBe('calc(50.00% + 0.00px)');
  expect(m.reset.hidden).toBe(true); expect(m.reset.getAttribute('aria-label')).toBe('Reset Glow to 0.25'); expect(m.reset.querySelector('svg').getAttribute('data-icon')).toBe('rotate-ccw');
  m.range.onkeydown({ key: 'End', shiftKey: false, preventDefault() {} }); expect(m.reset.hidden).toBe(false);
  m.reset.onclick(); expect(m.number.value).toBe('0.25'); expect(m.reset.hidden).toBe(true); expect(Number(m.range.value)).toBeCloseTo(500, 6); expect(m.seen).toEqual(['1', '0.25']); expect(m.commits()).toBe(2);
  m.number.value = '0.9'; m.number.oninput(); expect(m.reset.hidden).toBe(false); m.range.ondblclick(); expect(m.number.value).toBe('0.25'); expect(m.commits()).toBe(3);
  m.number.value = '0.250'; m.number.oninput(); expect(m.reset.hidden).toBe(true);
});
test('number chip: arrows step a round decimal, Shift steps ten times, values stay in range and commit', () => {
  const m = mount('0.25', { def: .3 }), key = (k: string, shiftKey = false) => { let prevented = false; m.number.onkeydown({ key: k, shiftKey, preventDefault() { prevented = true; } }); return prevented; };
  expect(key('ArrowUp')).toBe(true); expect(m.number.value).toBe('0.26'); key('ArrowUp', true); expect(m.number.value).toBe('0.36'); key('ArrowDown'); expect(m.number.value).toBe('0.35');
  expect(m.range.getAttribute('aria-valuenow')).toBe('0.35'); expect(Number(m.range.value)).toBeCloseTo(Math.sqrt(.35) * STEPS, 6); expect(m.commits()).toBe(3);
  expect(key('ArrowLeft')).toBe(false); expect(m.number.value).toBe('0.35'); // caret keys stay native
  m.number.value = '0.98'; m.number.oninput(); key('ArrowUp', true); expect(m.number.value).toBe('1');
  m.number.value = ''; m.number.oninput(); key('ArrowUp'); expect(m.number.value).toBe('0.31'); // empty steps from the default
  expect(chipStep({ min: 0, max: 2000, k: 2 }, 350, 1, false)).toBe(360); expect(chipStep({ min: 1, max: 1000, log: true, int: true }, 300, -1, false)).toBe(290);
  expect(chipStep({ min: .1, max: 100, log: true }, 1, -1, false)).toBe(.99); expect(chipStep({ min: .1, max: 100, log: true }, 1, 1, false)).toBe(1.1);
  expect(chipStep({ min: .1, max: 100, log: true }, 100000, 1, false)).toBe(110000); // typed out-of-range values are not clamped
});
test('pointer drag scrubs at reduced speed away from the track; the bubble shows the value and the fine mode', () => {
  const m = mount('0.25', { unit: 'px' }), ev = (x: number, y: number) => ({ clientX: x, clientY: y, pointerId: 1, button: 0, preventDefault() {} });
  expect(m.bubble.hidden).toBe(true);
  m.range.onpointerdown(ev(100, 16)); expect(m.seen).toEqual([]); expect(m.bubble.hidden).toBe(false); expect(m.bubble.textContent).toBe('0.25 px'); expect(m.mode.hidden).toBe(true);
  m.range.onpointermove(ev(146, 16)); expect(Number(m.range.value)).toBeCloseTo(750, 6); expect(m.mode.hidden).toBe(true); expect(m.track.classes.has('is-fine')).toBe(false);
  m.range.onpointermove(ev(192, 200)); expect(Number(m.range.value)).toBeCloseTo(775, 6);
  expect(m.mode.hidden).toBe(false); expect(m.mode.textContent).toBe('fine ×0.1'); expect(m.track.classes.has('is-fine')).toBe(true);
  expect(m.row.querySelector('.graph-ng-slider-scale').style.backgroundSize).toBe('60px 100%');
  m.range.onpointermove(ev(192, 70)); expect(m.mode.textContent).toBe('fine ×0.5');
  m.range.onpointerup(ev(192, 70)); expect(m.bubble.hidden).toBe(true); expect(m.track.classes.has('is-fine')).toBe(false); expect(m.commits()).toBe(1);
  m.range.onpointerdown(ev(0, 16)); expect(m.number.value).toBe('0'); m.range.onpointercancel(ev(0, 16)); expect(m.commits()).toBe(2);
});

test('integer curves only produce whole numbers', async () => {
  const { toValue } = await import('../src/progressive-slider');
  for (let t = 0; t <= 1; t += 0.037) expect(Number.isInteger(toValue({ min: 1, max: 1000, log: true, int: true }, t))).toBe(true);
});

test('fine drag ends on lost capture and ignores a second pointer without trapping range input', () => {
  const m = mount('0.25'), ev = (id: number, x = 100, y = 16) => ({ pointerId: id, clientX: x, clientY: y, button: 0, preventDefault() {} });
  m.range.onpointerdown(ev(1)); m.range.onpointermove(ev(1, 146, 200));
  const value = m.number.value; expect(m.mode.hidden).toBe(false);
  m.range.onpointerdown(ev(2, 192)); expect(m.number.value).toBe(value);
  m.range.onlostpointercapture(ev(2)); expect(m.bubble.hidden).toBe(false); expect(m.commits()).toBe(0);
  m.range.onlostpointercapture(ev(1)); expect(m.bubble.hidden).toBe(true); expect(m.track.classes.has('is-fine')).toBe(false); expect(m.commits()).toBe(1);
  m.range.onpointerup(ev(1)); expect(m.commits()).toBe(1);
  m.range.value = '1000'; m.range.oninput(); expect(m.number.value).toBe('1');
  m.range.onpointermove(ev(1, 0)); expect(m.number.value).toBe('1');
});

test('fine drag snaps to the pointer only when it re-enters the track hit band', () => {
  const m = mount('0.25'), ev = (x: number, y: number) => ({ clientX: x, clientY: y, pointerId: 1, button: 0, preventDefault() {} });
  m.range.onpointerdown(ev(100, 16));
  m.range.onpointermove(ev(146, 200)); expect(Number(m.range.value)).toBeCloseTo(525, 6);
  m.range.onpointermove(ev(146, 46)); expect(Number(m.range.value)).toBeCloseTo(525, 6); // still 30px from centre
  m.range.onpointermove(ev(146, 45)); expect(Number(m.range.value)).toBeCloseTo(750, 6);
  expect(m.mode.hidden).toBe(true); expect(m.track.classes.has('is-fine')).toBe(false);
  m.range.onpointermove(ev(100, 16)); expect(Number(m.range.value)).toBeCloseTo(500, 6);
  m.range.onpointerup(ev(100, 16)); expect(m.commits()).toBe(1);
  m.range.onkeydown({ key: 'ArrowRight', shiftKey: false, preventDefault() {} });
  expect(Number(m.range.value)).toBeCloseTo(504, 6);
});
