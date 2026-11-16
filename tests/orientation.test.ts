import { test, expect } from 'bun:test';
import { zoomStep, ZOOM_OUT_LIMIT } from '../src/zoom-limit';
import { miniFit, toMini, toCamera, viewRect, densityGrid, miniBounds, viewMarker, MINI_MARKER } from '../src/minimap';
import { crumbs, trail, trimHistory } from '../src/breadcrumb';
import { NavHistory } from '../src/connection-card';

test('density scalar loop exactly matches point-transform oracle including grid boundaries', () => {
  const positions = new Float32Array(4000), visible = new Uint8Array(2000), frame = { minX: -50, minY: -30, width: 100, height: 60 }, fit = miniFit(frame, 160, 120);
  for (let i = 0; i < visible.length; i++) { positions[i * 2] = (i * 31 % 200) - 100; positions[i * 2 + 1] = (i * 43 % 120) - 60; visible[i] = +(i % 3 !== 0); }
  const expected = new Uint32Array(160 * 120);
  for (let i = 0; i < visible.length; i++) if (visible[i]) {
    const px = positions[i * 2]!, py = positions[i * 2 + 1]!;
    if (px < -50 || px > 50 || py < -30 || py > 30) continue;
    const [x, y] = toMini(frame, fit, px, py); expected[Math.min(119, Math.max(0, Math.floor(y))) * 160 + Math.min(159, Math.max(0, Math.floor(x)))]!++;
  }
  expect(densityGrid(positions, visible, frame, fit, 160, 120)).toEqual(expected);
});

test('zoom out clamps at the limit and never hands over to Groups', () => {
  // min .02, limit 1.8.
  const step = (ratio: number, factor: number) => zoomStep(ratio, factor, .02, 1.8);
  expect(step(1, 1.5)).toEqual({ ratio: 1.5, clamped: false });
  expect(step(1.5, 2)).toEqual({ ratio: 1.8, clamped: true });
  expect(step(1.8, 2.7)).toEqual({ ratio: 1.8, clamped: true });
  // Already past the limit (a framing): zooming out holds, zooming in still works.
  expect(step(3, 2)).toEqual({ ratio: 3, clamped: true });
  expect(step(3, .5)).toEqual({ ratio: 1.5, clamped: false });
  expect(step(.03, .1)).toEqual({ ratio: .02, clamped: false });
  // The renderer's limit is the larger of the whole layout and Fit all, times the margin: Fit all is always inside.
  for (const home of [.4, 1, 1.3, 3]) expect(Math.max(1, home) * ZOOM_OUT_LIMIT).toBeGreaterThan(home);
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

test('review: minimap retains both bounds endpoints without admitting out-of-frame notes', () => {
  const frame = { minX: 100, minY: 100, width: 100, height: 100 }, fit = miniFit(frame, 160, 120);
  const grid = densityGrid(new Float32Array([100, 100, 200, 200, 201, 200, 200, 201, 99, 100]), new Uint8Array([1, 1, 1, 1, 1]), frame, fit, 160, 120);
  expect(grid.reduce((a, b) => a + b, 0)).toBe(2); expect(grid[20]).toBe(1); expect(grid[119 * 160 + 140]).toBe(1);
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

test('minimap bounds hold the layout and the whole viewport, so the view rectangle is always inside', () => {
  const layout = { minX: 0, minY: 0, width: 100, height: 100 }, inside = (cx: number, cy: number, w: number, h: number) => {
    const b = miniBounds(layout, cx, cy, w, h), m = miniFit(b, 160, 120), r = viewRect(b, m, cx, cy, w, h, layout);
    expect(r.x).toBeGreaterThan(0); expect(r.y).toBeGreaterThan(0); expect(r.x + r.w).toBeLessThan(160); expect(r.y + r.h).toBeLessThan(120);
    // The layout stays inside too.
    const [lx, ly] = toMini(b, m, 0, 0), [hx, hy] = toMini(b, m, 100, 100); expect(lx).toBeGreaterThan(0); expect(ly).toBeGreaterThan(0); expect(hx).toBeLessThan(160); expect(hy).toBeLessThan(120);
    return { b, m, r };
  };
  // A view inside the layout: bounds are the padded layout, independent of the pan.
  const a = inside(.5, .5, 20, 15).b, c = inside(.3, .7, 20, 15).b; expect(a).toEqual(c); expect(a.minX).toBeCloseTo(-6); expect(a.width).toBeCloseTo(112);
  // Zoomed out past the layout: the rectangle encloses the whole dot cloud.
  const out = inside(.5, .5, 1000, 750), [lx, ly] = toMini(out.b, out.m, 0, 0), [hx, hy] = toMini(out.b, out.m, 100, 100);
  expect(out.r.x).toBeLessThan(lx); expect(out.r.y).toBeLessThan(ly); expect(out.r.x + out.r.w).toBeGreaterThan(hx); expect(out.r.y + out.r.h).toBeGreaterThan(hy);
  // Panned far away: both still fit, with the view a real rectangle (not a line along an edge).
  const away = inside(6, -4, 40, 30); expect(away.r.w).toBeGreaterThan(2); expect(away.r.h).toBeGreaterThan(2);
  // Clicking the rectangle's centre in the drawn bounds returns the camera centre.
  const [cx, cy] = toCamera(away.b, away.m, away.r.x + away.r.w / 2, away.r.y + away.r.h / 2, layout); expect(cx).toBeCloseTo(6); expect(cy).toBeCloseTo(-4);
});

test('minimap marker: a tiny viewport keeps a minimum-size marker with a crosshair, clamped inside', () => {
  expect(viewMarker({ x: 50, y: 40, w: 30, h: 20 }, 160, 120)).toEqual({ x: 50, y: 40, w: 30, h: 20, cx: 65, cy: 50, tiny: false });
  const t = viewMarker({ x: 80, y: 60, w: .4, h: .3 }, 160, 120);
  expect(t.tiny).toBe(true); expect(t.w).toBe(MINI_MARKER); expect(t.h).toBe(MINI_MARKER); expect(t.cx).toBeCloseTo(80.2); expect(t.cy).toBeCloseTo(60.15);
  // At the edge the marker stays fully drawn instead of being cut to a line.
  const edge = viewMarker({ x: 159.9, y: -1, w: .1, h: .1 }, 160, 120); expect(edge.x + edge.w).toBeLessThanOrEqual(159); expect(edge.y).toBeGreaterThanOrEqual(1);
  // Larger than the canvas: clamped to the frame, never past it.
  const big = viewMarker({ x: -50, y: -50, w: 400, h: 300 }, 160, 120); expect([big.x, big.y, big.w, big.h]).toEqual([1, 1, 158, 118]);
});

test('trail: hidden under two visits, current emphasised, older visits overflow into the … menu', () => {
  expect(trail([], -1).shown).toEqual([]); expect(trail([5], 0)).toEqual({ shown: [], older: [] });
  expect(trail([5, 6], 1)).toEqual({ shown: [{ index: 0, node: 5, current: false }, { index: 1, node: 6, current: true }], older: [] });
  const items = [10, 11, 12, 13, 14, 15, 16], last = trail(items, 6);
  expect(last.shown.map(c => c.node)).toEqual([13, 14, 15, 16]); expect(last.older.map(c => c.node)).toEqual([12, 11, 10]);
  // Gone back: the window keeps the current entry with a forward one after it; older still collapse.
  const back = trail(items, 2); expect(back.shown.map(c => [c.node, c.current])).toEqual([[12, true], [13, false], [14, false], [15, false]]); expect(back.older.map(c => c.index)).toEqual([6, 1, 0]);
  expect(trail(Array.from({ length: 40 }, (_, i) => i), 39).older.length).toBe(32);
});

test('every retained history visit stays reachable, even when current is near the oldest entry', () => {
  const h = new NavHistory(); for (let n = 0; n < 1000; n++) h.visit(n);
  expect(h.items.length).toBe(32); expect(h.items[0]).toBe(968);
  for (let at = 0; at < h.items.length; at++) {
    const t = trail(h.items, at), indices = [...t.shown, ...t.older].map(c => c.index).sort((a, b) => a - b);
    expect(indices).toEqual(Array.from({ length: 32 }, (_, n) => n));
    expect(t.shown.some(c => c.current)).toBe(true);
  }
});
test('history trim and remove edit the original authority while preserving the selected visit', () => {
  const h = new NavHistory(); [10, 20, 30, 40, 50].forEach(n => h.visit(n));
  h.go(-2); const items = h.items; trimHistory(h, h.at, true);
  expect(h.items).toBe(items); expect(h.items).toEqual([10, 20, 30]); expect(h.at).toBe(2);
  trimHistory(h, 0, false); expect(h.items).toEqual([20, 30]); expect(h.at).toBe(1);
  h.go(-1); trimHistory(h, 1, false); expect(h.items).toEqual([20]); expect(h.at).toBe(0);
  trimHistory(h, -1, false); trimHistory(h, 99, true); expect(h.items).toEqual([20]);
  trimHistory(h, 0, false); expect(h.at).toBe(-1); expect(h.items).toEqual([]);
});
