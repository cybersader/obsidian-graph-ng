import { expect, test } from 'bun:test';
import { anchoredLabels, ANCHORED_LABELS, ANCHORED_CANDIDATES, DIRECT_LABELS, middleTruncate, overviewScale, radialLabels, stickyLevel, tierFont, tierType, type LabelItem } from '../src/label-layout';
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
  expect(free.hidden).toBe(0); expect(free.more).toBeDefined(); // reserved: an overlay may still hide a placed label
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

test('dense anchored and ranked hubs share six direct labels without spending slots on blocked names', () => {
  const items = Array.from({ length: 46 }, (_, i) => item(i, i ? 1 : 0, i % 8 * 200 + 50, Math.floor(i / 8) * 100 + 50));
  const blocked = (x: number, y: number, w: number, h: number) => x < 260 && x + w > 240 && y < 60 && y + h > 40;
  const anchored = anchoredLabels(items, 64, new Map(), blocked, 6), ranked = radialLabels(items, 64, 6, 45, 120, 32);
  expect(anchored.filter(s => s.rank === 1).length).toBe(6); expect(anchored[0]!.node).toBe(0);
  expect(anchored.some(s => s.node === 1)).toBe(false); expect(anchored.some(s => s.node === 7)).toBe(true);
  expect(ranked.slots.filter(s => s.rank === 1).length).toBe(6); expect(ranked.hidden).toBe(39);
  // Hover keeps a separate priority slot even after the six direct names have been admitted.
  const hovered = anchoredLabels([...items, { ...items[45]!, rank: 0 }], 64, new Map(), blocked, 6);
  expect(hovered.some(s => s.node === 45)).toBe(true);
  expect(anchoredLabels(items.slice(0, 8), 64, new Map(), () => false, DIRECT_LABELS).length).toBe(8);
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

test('small dots never suppress all ranked hub labels when zoom-adaptive labels are enabled', () => {
  for (const nodeSize of [.1, .7, 3]) for (const ratio of [.12, .27, 1, 4]) {
    const f = labelFade(nodeSize, 6, ratio, LABEL_RATIOS, true);
    const alpha = (rank: number) => { const t = Math.max(0, Math.min(1, (rank - f.cut) / .15)); return f.alpha * t * t * (3 - 2 * t); };
    expect(alpha(1)).toBe(1); expect(alpha(0)).toBe(0);
  }
  expect(labelFade(.7, 6, .27, LABEL_RATIOS, false)).toEqual({ alpha: 0, cut: 0 });
});

test('annotation boxes reserve their own height at every view edge', async () => {
  const { labelInView, insetLabel } = await import('../src/label-layout');
  for (const h of [16, 24, 32]) for (const [x, y] of [[-10, 100], [100, -10], [790, 100], [100, 590], [400, 300]]) {
    const [a, b] = insetLabel(x!, y!, 80, h, 800, 600);
    expect(labelInView(a!, b!, 80, h, 800, 600)).toBe(true);
    expect(a).toBeGreaterThanOrEqual(h); expect(b).toBeGreaterThanOrEqual(h);
    expect(a! + 80).toBeLessThanOrEqual(800 - h); expect(b! + h).toBeLessThanOrEqual(600 - h);
  }
  expect(labelInView(32, 31, 80, 32, 800, 600)).toBe(false);
  expect(labelInView(32, 32, 80, 32, 800, 600)).toBe(true);
  const [x, y] = insetLabel(0, 0, 800, 32, 800, 600);
  expect(labelInView(x!, y!, 800, 32, 800, 600)).toBe(false);
});


test('anchored names default on, ranked remains selectable, bad style values fail closed', () => {
  const v = defaultVisuals(); expect(v.labelStyle).toBe('anchored');
  validateVisuals({ ...v, labelStyle: 'ranked' });
  for (const labelStyle of ['auto', '', true, 1, null]) expect(() => validateVisuals({ ...v, labelStyle })).toThrow('labelStyle');
});

test('anchored placement reserves plates, dot rings and leaders without overlap at any zoom', () => {
  let previous = new Map<number, number>();
  const blocks = [[300, 200, 100, 180], [10, 10, 500, 40], [650, 450, 140, 140]];
  const overlaps = (a: number[], b: number[]) => a[0]! < b[0]! + b[2]! && a[0]! + a[2]! > b[0]! && a[1]! < b[1]! + b[3]! && a[1]! + a[3]! > b[1]!;
  const blocked = (x: number, y: number, w: number, h: number) => x < 0 || y < 0 || x + w > 800 || y + h > 600 || blocks.some(b => overlaps([x, y, w, h], b));
  for (const zoom of [.1, .2, .5, .99, 1, 1.05, 1.2, 2, 4]) {
    const items = Array.from({ length: 256 }, (_, i) => item(i, i ? 1 : 0, 400 + Math.sin(i * 17) * 500 * zoom, 300 + Math.cos(i * 3) * 300 * zoom, 40 + i % 5 * 20, 24, .16));
    const slots = anchoredLabels(items, 64, previous, blocked);
    expect(slots.length).toBeGreaterThan(0); expect(slots.length).toBeLessThanOrEqual(ANCHORED_LABELS);
    slots.forEach((s, i) => {
      expect(blocked(...s.box as [number, number, number, number])).toBe(false);
      expect(s.left).toBeGreaterThanOrEqual(s.box[0]!); expect(s.left + s.w).toBeLessThanOrEqual(s.box[0]! + s.box[2]!);
      expect(s.x - 3).toBeGreaterThanOrEqual(s.box[0]!); expect(s.x + 3).toBeLessThanOrEqual(s.box[0]! + s.box[2]!);
      for (const b of slots.slice(i + 1)) expect(overlaps(s.box, b.box)).toBe(false);
    });
    previous = new Map(slots.map(s => [s.node, s.side]));
  }
});

test('anchored placement has hard candidate and output caps and stable side preference', () => {
  const items = Array.from({ length: 1000 }, (_, i) => item(i, 5, i * 200, 200, 80, 24));
  const free = () => false;
  expect(anchoredLabels(items, 1000, new Map(), free).length).toBe(64);
  expect(anchoredLabels(items, 3, new Map(), free).length).toBe(3);
  expect(anchoredLabels(items, 0, new Map(), free).length).toBe(0);
  expect(anchoredLabels(items, 64, new Map(), x => x < ANCHORED_CANDIDATES * 200).length).toBe(0);
  const prev = new Map([[0, 1]]), kept = anchoredLabels(items.slice(0, 1), 1, prev, free)[0]!;
  expect(kept.side).toBe(1); expect(kept.left + kept.w).toBeLessThan(kept.x);
  // Four pixels of entry clearance, but an already shown label survives the same boundary.
  const edge = (x: number) => x < -6;
  expect(anchoredLabels([item(0, 0, 0, 200)], 1, new Map(), edge)).toHaveLength(0);
  expect(anchoredLabels([item(0, 0, 0, 200)], 1, new Map([[0, 0]]), edge)).toHaveLength(1);
});

test('anchored renderer parity uses one overlay and preserves accessible help without hover tooltips', async () => {
  const { readFileSync } = await import('node:fs');
  const source = readFileSync(new URL('../src/webgl-renderer.ts', import.meta.url), 'utf8');
  expect(source).toContain('this.drawCanvas(); this.placeOverlay()');
  expect(source).toContain("v.labelStyle === 'ranked' && this.atlas");
  expect(source).toContain("s.visuals.labelStyle === 'ranked' && nodes");
  expect(source).toContain("this.canvas.setAttribute('aria-describedby', help.id)");
  expect(source).toContain('Graph notes. Arrows select, Enter opens');
  expect(source).not.toContain("this.canvas.setAttribute('aria-label'");
  expect(source).not.toContain('this.container.title = hub');
  expect(source).not.toContain('el.title = full');
});

test('pooled anchored labels update descriptions when different nodes have the same caption', async () => {
  const { DetailRenderer } = await import('../src/webgl-renderer'), { ControlElement } = await import('./support/controls-dom');
  const { defaults } = await import('../src/settings');
  const r: any = Object.create(DetailRenderer.prototype), label = new ControlElement('SPAN');
  (label.style as any).setProperty = () => {};
  Object.assign(r, { settings: defaults('fixture'), theme: { font: 'sans-serif' }, width: 800, height: 600, focusNode: -1,
    visible: new Uint8Array([1, 1]), anchorPrevious: new Map(), anchorPool: [label], stateBytes: new Uint8Array(8),
    lodLevel: () => 0, screenPoint: () => ({ x: 200, y: 200 }), name: (n: number) => n ? 'Synthetic/B/Same.md' : 'Synthetic/A/Same.md' });
  r.anchorKey = [r.atlas, -1, -1, r.settings.labelSize, r.theme, r.tierMask, r.visible, 0];
  for (const node of [0, 1]) {
    r.anchorNames = [{ node, rank: 5, text: 'Same', w: 60 }];
    r.placeAnchored(-1, 0, () => 2, () => false);
    expect(label.textContent).toBe('Same'); expect(label.getAttribute('aria-description')).toBe(r.name(node));
  }
});
