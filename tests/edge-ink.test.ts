import { test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { defaults, validateVisuals, upgradeSettings, EDGE_MODES } from '../src/settings';
import { edgeInk, overdraw, inkAlpha, unionAlpha, fadeLength, lengthFade, INK, LENGTH_FADE, type EdgeInk } from '../src/render-effects';
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

test('density maths: per-line alpha spends a fixed ink budget, so core coverage is the same at every zoom', () => {
  const ink: EdgeInk = { length: 40, clipped: 30, area: 1e6 }, v = visuals(), target = 1 - Math.exp(-INK * v.edgeOpacity);
  let previous = Infinity;
  for (const scale of [.05, .2, 1, 4, 16]) {
    const layers = overdraw(ink, 50000, 1, scale);
    expect(layers).toBeCloseTo(50000 * 30 / (1e6 * scale), 9);
    expect(layers).toBeLessThan(previous); previous = layers; // zooming in thins the web as 1 / scale
    const a = inkAlpha(v, layers), coverage = 1 - (1 - a) ** layers;
    // Source-over coverage with a = budget / layers lies in [1 − e^(−budget), budget] for any layers ≥ 1.
    if (a < 1 && layers >= 1) { expect(a * layers).toBeCloseTo(INK * v.edgeOpacity, 12); expect(coverage).toBeGreaterThanOrEqual(target - 1e-12); expect(coverage).toBeLessThanOrEqual(INK * v.edgeOpacity + 1e-12); }
  }
  // More lines or wider strokes never add ink: the alpha shrinks in proportion.
  expect(inkAlpha(v, overdraw(ink, 100000, 1, 1))).toBeCloseTo(inkAlpha(v, overdraw(ink, 50000, 1, 1)) / 2, 12);
  expect(inkAlpha(v, overdraw(ink, 50000, 2, 1))).toBeCloseTo(inkAlpha(v, overdraw(ink, 50000, 1, 1)) / 2, 12);
  // The opacity setting still scales the budget; off ("Adapt to zoom") or an empty web never caps.
  expect(inkAlpha(visuals({ edgeOpacity: .4 }), 50)).toBeCloseTo(inkAlpha(visuals({ edgeOpacity: .2 }), 50) * 2, 12);
  expect(inkAlpha(visuals({ zoomAdapt: false }), 1e4)).toBe(1); expect(inkAlpha(v, 0)).toBe(1); expect(overdraw({ length: 0, clipped: 0, area: 0 }, 9, 1, 1)).toBe(0);
  expect(inkAlpha(visuals({ edgeOpacity: 0 }), 50)).toBe(0);
});

test('density maths: Canvas union alpha reaches the same core coverage as WebGL source-over', () => {
  const v = visuals(), budget = INK * v.edgeOpacity;
  for (const layers of [2, 8, 64, 4096]) {
    const webgl = 1 - (1 - inkAlpha(v, layers)) ** layers, canvas = unionAlpha(v, layers) * (1 - Math.exp(-layers));
    expect(canvas).toBeCloseTo(1 - Math.exp(-budget), 12); expect(Math.abs(webgl - canvas)).toBeLessThan(.002);
  }
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

test('edge shader evaluates the same quieting as the maths, and focus tiers regain full alpha', () => {
  const quiet = new Function('s', `with (s) { return (${edgeShader.match(/float quiet = (.*);/)![1]!}); }`) as (s: any) => number;
  const scale = (line: string) => new Function('s', `with (s) { return (${line}); }`) as (s: any) => number;
  const factor = scale(edgeShader.match(/alpha \*= (.*);/)![1]!.replace(/(\d)u\b/g, '$1'));
  const env = { min: Math.min, max: Math.max, mix: (a: number, b: number, t: number) => a + (b - a) * t };
  for (const [edgeAlpha, ink, f, len] of [[.02, .004, 300, 900], [.02, .5, 300, 100], [.3, .01, 1e9, 5000]] as const) {
    const q = quiet({ ...env, edgeAlpha, inkAlpha: ink, fadeLength: f, len });
    expect(q).toBeCloseTo(Math.min(1, ink / edgeAlpha) * lengthFade(len, f), 12);
    expect(factor({ ...env, quiet: q, tier: 0, focus: 1, focusOnly: 0 })).toBeCloseTo(q, 12);
    expect(factor({ ...env, quiet: q, tier: 255, focus: 1, focusOnly: 0 })).toBe(1);
    expect(factor({ ...env, quiet: q, tier: 255, focus: .5, focusOnly: 1 })).toBeCloseTo((q + (1 - q) * .5) * .5, 12);
  }
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
