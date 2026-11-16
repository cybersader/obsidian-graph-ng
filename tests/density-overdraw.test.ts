import { test, expect, afterAll } from 'bun:test';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { defaults } from '../src/settings';
import { edgeAlpha, effectPolicy, prominenceKeep, zoomFade } from '../src/render-effects';
import { baseRadius } from '../src/node-sizing';
import before from './support/compositing-before.json';
const source = readFileSync(new URL('../src/webgl-renderer.ts', import.meta.url), 'utf8');
const shader = (name: string) => source.match(new RegExp('const ' + name + ' = (?:common \\+ )?glsl`([\\s\\S]*?)`;'))![1]!;
const clamp = (x: number) => Math.max(0, Math.min(1, x));
const builtins = { max: Math.max, min: Math.min, exp: Math.exp, mix: (a: number, b: number, t: number) => a * (1 - t) + b * t, smoothstep: (a: number, b: number, x: number) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); } };
// Evaluate trusted repository shader SCALAR expressions, not a hand-copied desired formula.
// This is an ideal floating-point reference; no GPU rasterization/8-bit blend rounding claim.
const expression = (text: string) => new Function('s', `with (s) { return (${text.replaceAll('tint.rgb', 'tintColor').replaceAll('tint.a', 'tintAlpha').replace(/(\d)u\b/g, '$1')}); }`) as (scope: any) => number;
function args(text: string) { let depth = 0, start = 0; const parts: string[] = []; for (let i = 0; i < text.length; i++) { if (text[i] === '(') depth++; if (text[i] === ')') depth--; if (text[i] === ',' && depth === 0) { parts.push(text.slice(start, i)); start = i + 1; } } parts.push(text.slice(start)); return parts; }
function output(code: string, name: string) { const text = [...code.matchAll(new RegExp('\\s+' + name + ' = vec4\\((.*)\\);', 'g'))].at(-1)![1]!; return args(text).map(expression); }
function nodeProgram(code: string) {
  const read = (name: string) => expression(code.match(new RegExp('(?:float|vec3) ' + name + ' = (.*);'))![1]!);
  const core = read('core'), halo = read('halo'), shade = read('shade'), rim = code.includes('float rim') ? read('rim') : undefined, [rgb, alpha] = output(code, 'outputColor');
  return (color: number[], d: number, glow: number, tintAlpha = 1, dark = true, ring = 0) => {
    const s: any = { ...builtins, d, glow, spread: glow > 0 ? 2.3 : ring ? 1.4 : 1, tintAlpha, additive: +dark, ring };
    s.core = core(s); s.halo = halo(s); s.rim = rim ? rim(s) : s.halo;
    return [...color.map(tintColor => { s.tintColor = tintColor; s.shade = shade(s); return rgb!(s); }), alpha!(s)];
  };
}
function edgeProgram(code: string) {
  const initial = expression(code.match(/float alpha = (.*);/)![1]!);
  const focus = expression(code.match(/if \(focus > 0\.\) alpha = ([^;]+);/)![1]!);
  const hover = expression(code.match(/rgb = color\(4\).rgb; alpha = ([^;]+);/)![1]!);
  const [rgb, alpha] = output(code, 'tint');
  return (color: number[], requested: number, dark: boolean, emphasis = 0, hovered = false, direction = 0) => {
    // The focused edge is incident to the focus: old `s == focusNode`, graduated direct tier 255.
    const s: any = { ...builtins, edgeAlpha: requested, additive: +dark, direction, u: .5, s: 1, t: 2, focusNode: 1, tier: 255, dim: .12, focus: emphasis };
    s.alpha = initial(s); if (emphasis) s.alpha = focus(s); if (hovered) s.alpha = hover(s);
    return [...color.map(value => rgb!({ ...s, rgb: value })), alpha!(s)];
  };
}
const oldNode = nodeProgram(before.node), newNode = nodeProgram(shader('nodeFragment')), oldEdge = edgeProgram(before.edge), newEdge = edgeProgram(shader('edgeVertex'));
const background = [.08, .08, .08], colors = [[.92, .62, .32], [.24, .68, .88], [.62, .42, .84]];
// Blend factors are asserted against the production renderer below. Per-pixel fragments
// are independently composed; no global alpha adjustment or fabricated graph filtering.
function accumulate(fragments: number[][], count: number) { let pixel = [...background]; for (let i = 0; i < count; i++) { const fragment = fragments[i % fragments.length]!; pixel = pixel.map((c, k) => clamp(fragment[k]! + c * (1 - fragment[3]!))); } return pixel; }
const measurements: any[] = [], started = performance.now();
afterAll(() => { const directory = new URL('../.workspace/evidence/', import.meta.url); mkdirSync(directory, { recursive: true }); writeFileSync(new URL('density-overdraw.json', directory), JSON.stringify({ kind: 'ideal scalar source-equation reference, not GPU/native pixels', milliseconds: performance.now() - started, measurements }, null, 2)); });
test('density actual shader equations reproduce old whiteout and bound dense node glow and edges', () => {
  expect(source).toContain('gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)');
  const s = defaults('links'), a = edgeAlpha({ ...s.visuals, edgeOpacity: .05 }, 103058, 1, true);
  const cases = [['node-glow', colors.map(c => oldNode(c, 1.2, .3)), colors.map(c => newNode(c, 1.2, .3))], ['edges', colors.map(c => oldEdge(c, a, true)), colors.map(c => newEdge(c, a, true))]] as const;
  for (const [kind, oldFragments, fragments] of cases) for (const overlaps of [1, 8, 64, 512, 4096]) {
    const oldRGB = accumulate(oldFragments, overlaps), rgb = accumulate(fragments, overlaps); measurements.push({ kind, overlaps, oldRGB, rgb });
    rgb.forEach((v, k) => expect(v).toBeLessThanOrEqual(Math.max(background[k]!, ...colors.map(c => c[k]!)) + 1e-12));
    if (overlaps === 4096) { expect(oldRGB).toEqual([1, 1, 1]); expect(Math.min(...rgb)).toBeLessThan(.7); }
    if (overlaps === 1) rgb.forEach((v, k) => expect(Math.abs(v - oldRGB[k]!)).toBeLessThan(.01));
  }
});
test('density local crowded and sparse pixels are handled independently, without a global visibility cut', () => {
  const s = defaults('links'), alpha = edgeAlpha({ ...s.visuals, edgeOpacity: .05 }, 103058, 1, true), oldFragments = colors.map(c => oldEdge(c, alpha, true)), fragments = colors.map(c => newEdge(c, alpha, true));
  let oldWhite = 0, white = 0, fragmentsDrawn = 0;
  for (let y = -5; y <= 5; y++) for (let x = -5; x <= 5; x++) {
    const count = Math.hypot(x, y) < 3 ? 4096 : Math.hypot(x, y) < 5 ? 64 : 1; fragmentsDrawn += count;
    const a = accumulate(oldFragments, count), b = accumulate(fragments, count); oldWhite += +a.every(v => v > .98); white += +b.every(v => v > .98);
    if (count === 1) expect(b.some((v, i) => v > background[i]!)).toBe(true);
  }
  expect(oldWhite).toBeGreaterThan(0); expect(white).toBe(0); measurements.push({ kind: '121 independent fragment-occupancy patches, not a graph rasterizer', oldWhite, white, fragmentsDrawn });
});
test('density sparse node cores and light-theme output are unchanged; translucent coverage stays bounded', () => {
  for (const alpha of [0, 1 / 255, .25, 1]) for (const glow of [0, .3, 1]) for (const d of [0, .5, .9, 1, 1.2, 2]) for (const color of colors) {
    const result = newNode(color, d, glow, alpha); expect(result[3]).toBeGreaterThanOrEqual(0); expect(result[3]).toBeLessThanOrEqual(1);
    result.slice(0, 3).forEach(v => { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(result[3]! + 1e-12); });
    if (d < .82 || glow === 0) expect(result).toEqual(oldNode(color, d, glow, alpha));
    expect(newNode(color, d, glow, alpha, false)).toEqual(oldNode(color, d, glow, alpha, false));
    // The graduated focus ring is coverage, not addition: bounded by the tint alpha, premultiplied.
    for (const ring of [.5, 1]) { const r = newNode(color, d, glow, alpha, true, ring); expect(r[3]).toBeLessThanOrEqual(alpha + 1e-12); r.slice(0, 3).forEach(v => expect(v).toBeLessThanOrEqual(r[3]! + 1e-12)); }
  }
  for (const glow of [0, 1]) { expect(newNode(colors[0]!, 1.22, glow, 1, true, 1)[3]).toBeGreaterThan(newNode(colors[0]!, 1.22, glow, 1, true, 0)[3]! + .5); expect(newNode(colors[0]!, .5, glow, 1, true, 1)).toEqual(newNode(colors[0]!, .5, glow, 1, true, 0)); }
});
test('density zero-edge contract and explicit current focus remain continuous across zoom and density', () => {
  const settings = defaults('links'), saved = JSON.stringify(settings);
  for (const dark of [false, true]) for (const count of [1, 103058, 1000000]) for (const zoom of [.02, 1, 8]) for (const opacity of [0, .00001, .05, 1]) {
    const a = edgeAlpha({ ...settings.visuals, edgeOpacity: opacity }, count, zoom, dark);
    const context = newEdge(colors[0]!, a, dark), focus = newEdge(colors[0]!, a, dark, 1, true);
    if (!opacity) expect(focus).toEqual([0, 0, 0, 0]); else { expect(focus[3]).toBeGreaterThanOrEqual(context[3]!); expect(focus[3]).toBeLessThanOrEqual(1); }
    const rgb = accumulate([focus], 4096); rgb.forEach((v, i) => expect(v).toBeLessThanOrEqual(Math.max(colors[0]![i]!, background[i]!) + 1e-12));
    if (!dark) expect(context).toEqual(oldEdge(colors[0]!, a, dark));
  }
  expect(JSON.stringify(settings)).toBe(saved);
});
test('density correction leaves node radius and edge geometry/direction/focus equations intact', () => {
  // Graduated hover changes only the node tint line, the edge focus line and adds the edge tier attribute;
  // graduated tier styling adds the focus ring/growth lines and the focus-incident edge width factor.
  const focusFree = (code: string) => code.replace(/\n if \(emphasis > 0\.\) \{[\s\S]*? \} else \{([\s\S]*?)\n \}/, '$1').replace(/\n\s*\/\/[^\n]*/g, '').replace(/\n tint = vec4\(c\.rgb,.*;/, '').replace(/\n if \(focus > 0\.\) alpha = .*;/, '').replace(/\n if \(tier == 254u.*/, '').replace('\nlayout(location=3) in uint tier;', '')
    .replace(/\n.*(\bego\b|Graduated tiers).*/g, '')
    // The hover pulse grows and rings only the hovered note.
    .replace(/\n.*\bpulse\b.*/g, '')
    // Finding aids (optional, setting-gated): tier floor (lift), contrast ring bands/ink, legend mask (shownTier/tierByte), strong focus edges.
    .replace(/\n.*\b(lift|bands|ink|shownTier|tierByte|strong)\b.*/g, '').replace('\nout float ring;', '').replace(/\n float wide = .*;/, '').replace('* wide)', '* max(.5, edgeSize))')
    // Screen-space ink budget, long-line fade, "Focus only" and the dither seed change alpha and visibility only, never geometry.
    .replace(' || focusOnly > 0. && tier == 0u', '').replace(' seed = uint(gl_InstanceID);', '').replace('\nflat out uint seed;', '').replace('max(alpha, edgeAlpha)', 'alpha').replace(/\n.*\b(inkShare|fadeLength|focusOnly|quiet|lineRank)\b.*/g, '')
    // Ignore only the two new density branches, not the existing node-layer geometry.
    .replace(/\n if \(layer (?:>|==)[^\n]*/g, '');
  expect(focusFree(shader('nodeVertex'))).toBe(focusFree(before.nodeVertex)); expect(shader('nodeVertex')).not.toBe(before.nodeVertex);
  const geometry = (code: string) => focusFree(code.slice(0, code.lastIndexOf('tint = vec4(rgb * alpha,'))).replace(/vec4 sa = state\(s\), sb = state\(t\);/g, '').split('\n').map(s => s.trim()).filter(Boolean).join('\n'); expect(geometry(shader('edgeVertex'))).toBe(geometry(before.edge));
  const s = defaults('links'); s.nodeSizing = { policy: 'predictable', compensation: 1, floor: .3 };
  for (const zoom of [.02, 1, 8]) { const radius = baseRadius(s, 800, 600, 62230, zoom); expect(radius).toBeGreaterThanOrEqual(s.nodeSize * .3); expect(radius).toBeLessThanOrEqual(s.nodeSize); }
  expect(effectPolicy(s.visuals, 62230, 103058, 12, false, true).dark).toBe(true);
});
test('density zoom adaptation fades crowded edges as coverage, recovers zooming in, and never hides an edge', () => {
  const v = defaults('links').visuals, off = { ...v, zoomAdapt: false }, zooms = [.02, .1, .5, 1, 2, 4, 16, 64];
  expect(v.zoomAdapt).toBe(true);
  for (const dark of [false, true]) for (const count of [1, 3000, 49534, 103058, 1e6]) {
    let last = Infinity;
    for (const zoom of zooms) {
      const a = edgeAlpha(v, count, zoom, dark), plain = edgeAlpha(off, count, zoom, dark), f = zoomFade(v, count, zoom);
      // Uniform scalar on top of the reviewed formula: never above it, never below the .35 floor.
      expect(a).toBeLessThanOrEqual(plain + 1e-12); expect(a).toBeGreaterThanOrEqual(plain * .35 - 1e-12);
      expect(a).toBeLessThanOrEqual(last + 1e-12); last = a; // zooming out never brightens
      if (count <= 3000 && zoom <= 1) expect(f).toBe(1);
      if (v.edgeOpacity) expect(a).toBeGreaterThan(0);
      // Still coverage-preserving: 4096 local overlaps stay within the source/background hull.
      accumulate([newEdge(colors[1]!, a, dark)], 4096).forEach((c, k) => expect(c).toBeLessThanOrEqual(Math.max(colors[1]![k]!, background[k]!) + 1e-12));
    }
  }
  // Crowding is per pixel: the same graph in a smaller pane fades more; zero reference or off disables.
  expect(zoomFade(v, 6000, 1, 640, 400)).toBeLessThan(zoomFade(v, 6000, 1, 2560, 1600));
  expect(zoomFade({ ...v, edgeDensityReference: 0 }, 1e6, 64)).toBe(1); expect(zoomFade(off, 1e6, 64)).toBe(1);
  expect(zoomFade(v, 49534, 1)).toBeCloseTo(.35, 12); expect(zoomFade(v, 6000, .5)).toBe(1); expect(zoomFade(v, 12000, 1)).toBeCloseTo(.5, 12);
  // Hub prominence: unchanged at or inside home or uncrowded; zoom^-1/2 in half log2 steps, floored at 1/4.
  for (const zoom of [.01, .5, 1, 1.1]) expect(prominenceKeep(zoom, true)).toBe(1);
  expect(prominenceKeep(64, false)).toBe(1); expect(prominenceKeep(2, true)).toBeCloseTo(Math.SQRT1_2, 12); expect(prominenceKeep(4, true)).toBe(.5); expect(prominenceKeep(1e4, true)).toBe(.25);
  expect(prominenceKeep(2.1, true)).toBe(prominenceKeep(1.9, true));
  let previous = 1; for (const zoom of zooms) { const k = prominenceKeep(zoom, true); expect(k).toBeLessThanOrEqual(previous); previous = k; }
});
