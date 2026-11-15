import { expect, test } from 'bun:test';
import { DIRECT_LABELS, middleTruncate, overviewScale, radialLabels, stickyLevel, tierFont, tierType, type LabelItem } from '../src/label-layout';
import { LABEL_RATIOS } from '../src/render-data';
import { labelFade } from '../src/render-effects';
import { defaultVisuals, validateVisuals } from '../src/settings';

test('type scale: focus largest and bold, direct at the label size, 2-hop smaller; scale 1 keeps one size', () => {
  const sizes = [0, 1, 2, 3, 4, 5].map(r => tierType(r, 13, 1.2));
  expect(sizes.map(t => t.size)).toEqual([18.5, 13, 13, 11, 10, 10]);
  expect(sizes.map(t => t.weight)).toEqual([700, 600, 500, 400, 400, 400]);
  for (let r = 1; r < 6; r++) expect(sizes[r]!.size).toBeLessThanOrEqual(sizes[r - 1]!.size);
  expect([0, 1, 3, 5].map(r => tierType(r, 13, 1).size)).toEqual([13, 13, 13, 13]);
  // Clamped to readable bounds; out-of-range ranks clamp to the nearest tier.
  expect(tierType(0, 60, 1.6).size).toBe(64); expect(tierType(5, 4, 1.6).size).toBe(6); expect(tierType(9, 13, 1.2)).toEqual(tierType(5, 13, 1.2));
  expect(tierFont(1, 13, 1.2, 'Inter')).toBe('600 13px Inter');
  // Hubs: the largest gets the focus size, falling quickly to the label size.
  expect(overviewScale(0, 1.2)).toBeCloseTo(1.44, 12); expect(overviewScale(1, 1.2)).toBe(1); expect(overviewScale(.5, 1)).toBe(1);
  expect(overviewScale(.1, 1.2)).toBeGreaterThan(overviewScale(.3, 1.2));
});

test('middle truncation keeps both ends, counts code points and leaves short names alone', () => {
  expect(middleTruncate('short', 10)).toBe('short');
  expect(middleTruncate('abcdefghij', 10)).toBe('abcdefghij');
  const t = middleTruncate('Access Control Policy and Procedures', 15);
  expect(Array.from(t).length).toBe(15); expect(t.startsWith('Access ')).toBe(true); expect(t.endsWith('ures')).toBe(true); expect(t).toContain('…');
  expect(middleTruncate('abcdef', 4)).toBe('ab…f'); expect(middleTruncate('abcdef', 2)).toBe('a…'); expect(middleTruncate('abcdef', 1)).toBe('…');
  // Emoji (surrogate pairs) are never split.
  const e = middleTruncate('😀😀😀😀😀😀', 4); expect(e).toBe('😀😀…😀'); expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(e)).toBe(false);
});

test('label level hysteresis: no switch within the margin of a boundary, immediate on big jumps', () => {
  // LABEL_RATIOS[3] = 1 is the boundary between level 3 and level 4.
  expect(stickyLevel(-1, 1.05, LABEL_RATIOS)).toBe(4);
  expect(stickyLevel(3, 1.05, LABEL_RATIOS)).toBe(3);
  expect(stickyLevel(3, 1.2, LABEL_RATIOS)).toBe(4);
  expect(stickyLevel(4, .95, LABEL_RATIOS)).toBe(4);
  expect(stickyLevel(4, .8, LABEL_RATIOS)).toBe(3);
  // Oscillating around the boundary never flips the level.
  let level = 3; for (const r of [.98, 1.04, .97, 1.08, 1, 1.1]) { level = stickyLevel(level, r, LABEL_RATIOS); expect(level).toBe(3); }
  expect(stickyLevel(0, 4, LABEL_RATIOS)).toBe(5); expect(stickyLevel(6, 99, LABEL_RATIOS)).toBe(6);
  // The importance cut clamps while the level is held: no jump back to 0 just past the boundary.
  const held = labelFade(3, 1, 1.05, LABEL_RATIOS, true, 3), free = labelFade(3, 1, 1.05, LABEL_RATIOS, true);
  expect(held.cut).toBeCloseTo(.55, 12); expect(free.cut).toBeLessThan(.1);
});

const item = (node: number, rank: number, x: number, y: number, w = 40, h = 12, r = 3): LabelItem => ({ node, rank, x, y, r, w, h });
test('radial placement: labels stay beside their dots when free; collisions push direct labels outward with leaders', () => {
  const focus = item(0, 0, 0, 0, 60);
  // Free: right of the dot, centred, no leader.
  const free = radialLabels([focus, item(1, 1, 200, 0), item(2, 3, 0, 200)], 10, DIRECT_LABELS, 1, 50, 32);
  expect(free.slots.map(s => [s.node, s.dx, s.dy, !!s.leader])).toEqual([[0, 7, 0, false], [1, 7, 0, false], [2, 7, 0, false]]);
  expect(free.hidden).toBe(0); expect(free.more).toBeUndefined();
  // Dense: four direct dots stacked where their default boxes overlap.
  const dense = [focus, ...[1, 2, 3, 4].map(n => item(n, 1, 100, n * 2))], out = radialLabels(dense, 10, DIRECT_LABELS, 4, 50, 32);
  expect(out.slots.map(s => s.node)).toEqual([0, 1, 2, 3, 4]); expect(out.slots[1]!.leader).toBeUndefined();
  const boxes = out.slots.map(s => { const it = dense.find(d => d.node === s.node)!; return [it.x + s.dx, it.y + s.dy - it.h / 2, it.w, it.h] as const; });
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) { const [ax, ay, aw, ah] = boxes[i]!, [bx, by, bw, bh] = boxes[j]!; expect(ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by).toBe(false); }
  for (const s of out.slots.slice(2)) { expect(s.leader).toBeDefined(); const [x0, y0, x1, y1] = s.leader!; expect(Math.hypot(x0, y0)).toBeCloseTo(4, 9); expect(Math.hypot(x1, y1)).toBeGreaterThan(Math.hypot(x0, y0)); }
  // A colliding 2-hop label is dropped rather than displaced.
  expect(radialLabels([focus, item(1, 1, 100, 0), item(5, 3, 100, 2)], 10, DIRECT_LABELS, 1, 50, 32).slots.map(s => s.node)).toEqual([0, 1]);
  // Deterministic.
  expect(radialLabels(dense, 10, DIRECT_LABELS, 4, 50, 32)).toEqual(out);
});

test('radial placement caps direct labels and folds the rest into one "+N more" beside the focus', () => {
  const focus = item(0, 0, 0, 0, 60, 20), dots = Array.from({ length: 40 }, (_, i) => item(i + 1, 1, 300 * Math.cos(i), 300 * Math.sin(i), 30, 12));
  const out = radialLabels([focus, ...dots], 64, 5, 40, 70, 32);
  expect(out.slots.filter(s => s.rank === 1).length).toBe(5); expect(out.hidden).toBe(35);
  // The "+N more" box sits next to the focus label without overlapping it.
  const m = out.more!; expect(m).toBeDefined(); const top = m.dy - 16; expect(top >= 10 + 2 - 1e-9 || top + 32 <= -10).toBe(true);
  // The label budget also hides direct labels, and the count reflects it.
  const tight = radialLabels([focus, ...dots], 3, DIRECT_LABELS, 40, 70, 32); expect(tight.slots.length).toBe(3); expect(tight.hidden).toBe(38);
  // Without a focus (a selected relationship) nothing is displaced or folded.
  const none = radialLabels(dots.slice(0, 3), 10, DIRECT_LABELS, 0, 70, 32); expect(none.hidden).toBe(0); expect(none.more).toBeUndefined();
});

test('label tier settings default, validate and reject out-of-range values', () => {
  const v = defaultVisuals(); expect(v.labelTierScale).toBe(1.2); expect(v.labelPlates).toBe(true); validateVisuals(v);
  expect(() => validateVisuals({ ...v, labelTierScale: .9 })).toThrow('labelTierScale'); expect(() => validateVisuals({ ...v, labelTierScale: 1.7 })).toThrow('labelTierScale');
  expect(() => validateVisuals({ ...v, labelPlates: 'yes' })).toThrow('labelPlates');
});
