import { test, expect } from 'bun:test';
import { zoomStep, atZoomLimit } from '../src/zoom-limit';
import { miniFit, toMini, toCamera, viewRect, densityGrid } from '../src/minimap';
import { crumbs } from '../src/breadcrumb';
import { NavHistory } from '../src/connection-card';

test('zoom out with a held focus clamps at the overview threshold and never hands over', () => {
  // min .02, max 8, Group overview threshold 1.8.
  const step = (ratio: number, factor: number, hold: boolean) => zoomStep(ratio, factor, .02, 8, 1.8, hold);
  expect(step(1, 1.5, true)).toEqual({ ratio: 1.5, overview: false });
  expect(step(1.5, 2, true)).toEqual({ ratio: 1.8, overview: false });
  expect(step(1.8, 2.7, true)).toEqual({ ratio: 1.8, overview: false });
  // Already past the threshold (a pinch or a framing): zooming out holds, zooming in still works.
  expect(step(3, 2, true)).toEqual({ ratio: 3, overview: false });
  expect(step(3, .5, true)).toEqual({ ratio: 1.5, overview: false });
  // Nothing held: today's handover at the threshold, camera limits still apply.
  expect(step(1.5, 2, false)).toEqual({ ratio: 3, overview: true });
  expect(step(1, 1.5, false)).toEqual({ ratio: 1.5, overview: false });
  expect(step(6, 2, false)).toEqual({ ratio: 8, overview: true });
  expect(step(.03, .1, true).ratio).toBe(.02);
  expect(atZoomLimit(1.8, 1.8)).toBe(true); expect(atZoomLimit(1.79, 1.8)).toBe(false); expect(atZoomLimit(4, 1.8)).toBe(true);
});

test('minimap coordinate mapping keeps aspect, centres the frame and round-trips camera coordinates', () => {
  const f = { minX: -100, minY: 50, width: 400, height: 100 }, m = miniFit(f, 160, 120);
  // A wide frame fits the width and is centred vertically.
  expect(m.s).toBe(.4); expect(m.ox).toBe(0); expect(m.oy).toBe(40);
  expect(toMini(f, m, -100, 50)).toEqual([0, 40]); expect(toMini(f, m, 300, 150)).toEqual([160, 80]);
  // Clicking the centre of the drawn frame centres the camera; corners map to 0 and 1.
  expect(toCamera(f, m, 80, 60)).toEqual([.5, .5]); expect(toCamera(f, m, 0, 40)).toEqual([0, 0]); expect(toCamera(f, m, 160, 80)).toEqual([1, 1]);
  for (const [x, y] of [[.25, .75], [.9, .1]] as const) {
    const [mx, my] = toMini(f, m, f.minX + x * f.width, f.minY + y * f.height), [cx, cy] = toCamera(f, m, mx, my);
    expect(cx).toBeCloseTo(x); expect(cy).toBeCloseTo(y);
  }
  // A tall frame fits the height instead.
  const tall = miniFit({ minX: 0, minY: 0, width: 10, height: 30 }, 160, 120); expect(tall.s).toBe(4); expect(tall.ox).toBe(60); expect(tall.oy).toBe(0);
  // The viewport rectangle is centred on the camera with the view's world size.
  expect(viewRect(f, m, .5, .5, 200, 50)).toEqual({ x: 40, y: 50, w: 80, h: 20 });
});

test('minimap density bins only visible notes inside the frame', () => {
  const f = { minX: 0, minY: 0, width: 4, height: 3 }, m = miniFit(f, 4, 3);
  const positions = new Float32Array([0.5, 0.5, 0.6, 0.4, 3.5, 2.5, 1.5, 1.5, 9, 9]), grid = densityGrid(positions, new Uint8Array([1, 1, 1, 0, 1]), f, m, 4, 3);
  expect([...grid]).toEqual([2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1]);
});

test('breadcrumb model: last 8 visited, current always included, shared card history', () => {
  expect(crumbs([], -1)).toEqual([]);
  expect(crumbs([4, 7], 1)).toEqual([{ index: 0, node: 4, current: false }, { index: 1, node: 7, current: true }]);
  const h = new NavHistory(); for (let i = 0; i < 12; i++) h.visit(i);
  const last = crumbs(h.items, h.at);
  expect(last.map(c => c.node)).toEqual([4, 5, 6, 7, 8, 9, 10, 11]); expect(last.filter(c => c.current).map(c => c.node)).toEqual([11]);
  // Going back past the window shifts it so the current entry stays visible, with forward entries after it.
  for (let i = 0; i < 9; i++) h.go(-1);
  const back = crumbs(h.items, h.at); expect(back[0]).toEqual({ index: 2, node: 2, current: true }); expect(back.length).toBe(8);
  // A new visit drops the forward branch, as the card does.
  h.visit(99); expect(crumbs(h.items, h.at).map(c => c.node)).toEqual([0, 1, 2, 99]);
  expect(crumbs([1, 2, 3], 1, 2).map(c => c.index)).toEqual([1, 2]);
});
