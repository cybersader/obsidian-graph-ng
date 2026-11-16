import { test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { defaults, validateVisuals, upgradeSettings, EDGE_MODES } from '../src/settings';
import { edgeInk, edgeRanks, overdraw, inkShare, unionAlpha, fadeLength, lengthFade, INK, LINES, LENGTH_FADE, type EdgeInk } from '../src/render-effects';
const source = readFileSync(new URL('../src/webgl-renderer.ts', import.meta.url), 'utf8');
const edgeShader = source.match(/const edgeVertex = common \+ glsl`([\s\S]*?)`;/)![1]!;
const visuals = (o: Partial<ReturnType<typeof defaults>['visuals']> = {}) => ({ ...defaults('links').visuals, edgeOpacity: .155, ...o });

test('edge ink samples mean length, the long-line clip and the core area of the drawn web', () => {
  // Two short lines (length 1) and one long line (length 10), endpoints symmetric about the origin.
  const positions = new Float32Array([-1, 0, 0, 0, 1, 0, -5, 0, 5, 0]), source = new Uint32Array([0, 1, 3]), target = new Uint32Array([1, 2, 4]);
  const ink = edgeInk(positions, source, target, () => true), mean = 12 / 3;
  expect(ink.length).toBeCloseTo(mean, 6);
  expect(ink.clipped).toBeCloseTo((1 + 1 + Math.min(10, LENGTH_FADE * mean)) / 3, 6);
  expect(ink.area).toBeCloseTo(Math.PI * (1 + 0 + 0 + 1 + 25 + 25) / 6, 6);
  // Undrawn lines (hidden types, filtered endpoints) do not count; nothing drawn is an empty web.
  expect(edgeInk(positions, source, target, e => e !== 2).length).toBeCloseTo(1, 6);
  expect(edgeInk(positions, source, target, () => false)).toEqual({ length: 0, clipped: 0, area: 0 });
  // Bounded sampling: a large web reads at most `samples` rows.
  let reads = 0; edgeInk(new Float32Array(200), new Uint32Array(100000), new Uint32Array(100000), () => { reads++; return true; }, 512);
  expect(reads).toBeLessThanOrEqual(512);
});

test('density maths: WebGL draws a share of whole lines, so the core keeps about LINES lines per pixel at every zoom', () => {
  const ink: EdgeInk = { length: 40, clipped: 30, area: 1e6 }, v = visuals();
  let previous = Infinity;
  for (const scale of [.05, .2, 1, 4, 16]) {
    const layers = overdraw(ink, 50000, 1, scale);
    expect(layers).toBeCloseTo(50000 * 30 / (1e6 * scale), 9);
    expect(layers).toBeLessThan(previous); previous = layers; // zooming in thins the web as 1 / scale
    const share = inkShare(v, layers);
    if (share < 1) expect(share * layers).toBeCloseTo(LINES, 12); else expect(layers).toBeLessThanOrEqual(LINES);
  }
  // More lines or wider strokes never add ink: the share shrinks in proportion.
  expect(inkShare(v, overdraw(ink, 100000, 1, 1))).toBeCloseTo(inkShare(v, overdraw(ink, 50000, 1, 1)) / 2, 12);
  expect(inkShare(v, overdraw(ink, 50000, 2, 1))).toBeCloseTo(inkShare(v, overdraw(ink, 50000, 1, 1)) / 2, 12);
  // The share does not depend on opacity (opacity sets each line's alpha); off or an empty web keeps every line.
  expect(inkShare(visuals({ edgeOpacity: .4 }), 50)).toBe(inkShare(visuals({ edgeOpacity: .2 }), 50));
  expect(inkShare(visuals({ zoomAdapt: false }), 1e4)).toBe(1); expect(inkShare(v, 0)).toBe(1); expect(overdraw({ length: 0, clipped: 0, area: 0 }, 9, 1, 1)).toBe(0);
});

test('density maths: Canvas union alpha reaches the budgeted core coverage', () => {
  const v = visuals(), budget = INK * v.edgeOpacity;
  for (const layers of [2, 8, 64, 4096]) expect(unionAlpha(v, layers) * (1 - Math.exp(-layers))).toBeCloseTo(1 - Math.exp(-budget), 12);
  expect(unionAlpha(visuals({ zoomAdapt: false }), 64)).toBe(1); expect(unionAlpha(v, .001)).toBe(1);
});

test('length fade: a long line adds no more ink than a typical one, and only while the web is crowded', () => {
  const ink: EdgeInk = { length: 40, clipped: 30, area: 1e6 }, scale = 2, f = fadeLength(visuals(), ink, scale, 5);
  expect(f).toBeCloseTo(LENGTH_FADE * 40 * scale, 9); // screen px of 1.5 mean lines
  for (const length of [1, f / 2, f]) expect(lengthFade(length, f)).toBe(1);
  for (const length of [2 * f, 10 * f, 1000 * f]) expect(lengthFade(length, f) * length).toBeCloseTo(f, 6);
  // Below one layer the fade length grows as 1 / layers: sparse or zoomed-in views keep every line.
  expect(fadeLength(visuals(), ink, scale, .25)).toBeCloseTo(4 * f, 9);
  expect(fadeLength(visuals(), ink, scale, 0)).toBe(Infinity); expect(fadeLength(visuals({ zoomAdapt: false }), ink, scale, 5)).toBe(Infinity);
  expect(lengthFade(0, 1)).toBe(1);
});

// The shader's stable line rank, evaluated in 32-bit unsigned arithmetic like GLSL.
const rankOf = (id: number) => { let k = Math.imul(id, 2654435769) >>> 0; k = (k ^ k >>> 15) >>> 0; k = Math.imul(k, 2246822519) >>> 0; return ((k ^ k >>> 13) >>> 0) >>> 8; };
test('edge shader keeps a stable share of whole context lines; focus tiers fade back to full alpha', () => {
  expect(edgeShader).toContain('float quiet = share * 16777216. > float(lineRank) ? 1. : 0.;');
  const fn = (line: string) => new Function('s', `with (s) { return (${line}); }`) as (s: any) => number;
  const env = { min: Math.min, max: Math.max, mix: (a: number, b: number, t: number) => a + (b - a) * t };
  const share = fn(edgeShader.match(/float share = (.*);/)![1]!), factor = fn(edgeShader.match(/alpha \*= (.*);/)![1]!.replace(/(\d)u\b/g, '$1'));
  for (const [ink, f, len] of [[.1, 300, 900], [.5, 300, 100], [1, 1e9, 5000]] as const) expect(share({ ...env, inkShare: ink, fadeLength: f, len })).toBeCloseTo(ink * lengthFade(len, f), 12);
  // The kept fraction matches the share; a larger share keeps a superset (zooming in only adds lines).
  const ids = 50000, kept = (s: number) => { const out: number[] = []; for (let i = 0; i < ids; i++) if (s * 16777216 > rankOf(i)) out.push(i); return out; };
  for (const s of [.02, .1, .37, .8]) expect(Math.abs(kept(s).length / ids - s)).toBeLessThan(.01);
  const few = kept(.05), many = new Set(kept(.3)); expect(few.every(i => many.has(i))).toBe(true);
  expect(kept(1).length).toBe(ids); expect(kept(0).length).toBe(0);
  // Kept context lines draw at full line alpha; dropped ones are not rasterized unless a focus tier fades them in.
  for (const quiet of [0, 1]) {
    expect(factor({ ...env, quiet, tier: 0, focus: 1, focusOnly: 0 })).toBe(quiet);
    expect(factor({ ...env, quiet, tier: 255, focus: 1, focusOnly: 0 })).toBe(1);
    expect(factor({ ...env, quiet, tier: 255, focus: .5, focusOnly: 1 })).toBeCloseTo((quiet + (1 - quiet) * .5) * .5, 12);
  }
  expect(edgeShader).toContain('if (quiet < .5 && (tier == 0u || focus <= 0.) && gl_InstanceID != edgeHovered) { gl_Position = offscreen; return; }');
  // "Focus only" removes context lines before rasterizing (no zero-alpha fragments, no dither speckle).
  expect(edgeShader).toContain('focusOnly > 0. && tier == 0u) { gl_Position = offscreen; return; }');
});

test('edge mode setting: three values, validated, defaulted for old settings', () => {
  expect(EDGE_MODES).toEqual(['all', 'focus', 'off']); expect(defaults('links').visuals.edgeMode).toBe('all');
  for (const mode of EDGE_MODES) expect(() => validateVisuals(visuals({ edgeMode: mode }))).not.toThrow();
  for (const bad of ['none', 'Focus', '', 1, null, undefined]) expect(() => validateVisuals({ ...visuals(), edgeMode: bad })).toThrow('visuals.edgeMode must be all, focus or off');
  const old = defaults('links') as any; delete old.visuals.edgeMode;
  expect(upgradeSettings(old, 'links').visuals.edgeMode).toBe('all');
  expect(upgradeSettings({ ...old, visuals: { ...old.visuals, edgeMode: 'focus' } }, 'links').visuals.edgeMode).toBe('focus');
  expect(() => upgradeSettings({ ...old, visuals: { ...old.visuals, edgeMode: 'some' } }, 'links')).toThrow();
});

test('edge dither rounds premultiplied RGBA together: zero stays zero, no clamped dark-line bias', () => {
  const fragment = source.match(/const solidFragment = glsl`([\s\S]*?)`;/)![1]!;
  // Evaluate the actual shader expression for each component (GLSL floor is componentwise).
  const expression = fragment.match(/outputColor = (.*);/)![1]!.replace(/1023u/g, '1023');
  const quantize = new Function('tint', 'h', 'floor', 'float', `return ${expression}`) as (v: number, h: number, f: typeof Math.floor, cast: NumberConstructor) => number;
  for (const alpha of [0, .00001, .0005, .003, .01, .4, 1]) {
    const tint = [.05 * alpha, .4 * alpha, alpha, alpha], sum = [0, 0, 0, 0];
    for (let h = 0; h < 1024; h++) {
      const q = tint.map(v => quantize(v, h, Math.floor, Number));
      expect(q.every(v => v >= 0 && v <= q[3]!)).toBe(true);
      q.forEach((v, i) => sum[i]! += v);
    }
    sum.forEach((v, i) => expect(Math.abs(v / 1024 - tint[i]!)).toBeLessThanOrEqual(1 / (2048 * 255) + 1e-12));
  }
});


test('importance ranks conserve the exact share while favouring hub spokes, bridges and declared interest', () => {
  const m = 12000, source = Uint32Array.from({ length: m }, (_, e) => e * 2), target = source.map(n => n + 1);
  const offsets = Uint32Array.from({ length: 2 * m + 1 }, (_, n) => n);
  const groups = new Uint32Array(2 * m), interest = new Float32Array(2 * m);
  // Same degree for all pairs. Half bridge groups, one quarter also has declared interest.
  for (let e = m / 2; e < m; e++) groups[target[e]!] = 1;
  for (let e = 3 * m / 4; e < m; e++) interest[source[e]!] = 1;
  const ranked = edgeRanks(source, target, offsets, groups, interest, () => true);
  expect(edgeRanks(source, target, offsets, groups, interest, () => true)).toEqual(ranked);
  for (const share of [0, .01, .1, .5, 1]) expect([...ranked].filter(r => r < share * 16777216)).toHaveLength(m * share);
  const buckets = [0, 0, 0, 0]; ranked.forEach((r, e) => { if (r < .1 * 16777216) buckets[Math.floor(e / (m / 4))]!++; });
  expect(buckets[2]!).toBeGreaterThan(buckets[0]! * 1.5); expect(buckets[3]!).toBeGreaterThan(buckets[2]! * 1.5);
  // Hub degree alone biases selection, without dependence on displayed node-size settings.
  const high = Uint32Array.from(offsets, (n, i) => n + (i > 0 ? 10000 : 0)); source.fill(0, m / 2);
  const hubs = edgeRanks(source, target, high, undefined, undefined, () => true);
  expect([...hubs.slice(m / 2)].filter(r => r < .1 * 16777216).length).toBeGreaterThan(1000);
  // Hidden rows do not consume the share. Sparse/off admission includes every eligible row.
  const subset = edgeRanks(source, target, high, groups, interest, e => e % 2 === 0);
  expect([...subset].filter((r, e) => e % 2 === 0 && r < .1 * 16777216)).toHaveLength(m / 20);
  expect(edgeRanks(new Uint32Array(), new Uint32Array(), new Uint32Array([0]), undefined, undefined, () => true)).toHaveLength(0);
});

test('both renderers and picking consume the same importance column and context share', () => {
  expect(edgeShader).toContain('layout(location=4) in uint lineRank;');
  expect(source).toContain('this.integer(4, this.lineRanks)');
  expect(source).toContain('this.lineRanks[e]! >= ink * lengthFade');
  expect(source).toContain('* 16777216 <= this.lineRanks[e]!');
  expect(source).not.toContain('unionAlpha');
  expect(source).toContain('edgeAlpha(v, v.zoomAdapt ? 0 : this.visibleEdges');
  expect(source).toContain('edgeAlpha(s.visuals, s.visuals.zoomAdapt ? 0 : this.visibleEdges');
  expect(source).toContain('ctx.lineWidth = 2 * Math.max(.5, width) * wide');
});
