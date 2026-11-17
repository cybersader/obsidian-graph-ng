import { test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { edgeRanks, lineAdmitted, edgeInk } from '../../src/render-effects';
import { buildProjection } from '../../src/core/projection';
import { defaultDeclaration } from '../../src/core/declaration';
import { renderProjection } from '../../src/render-projection';
import { defaults } from '../../src/settings';
import { performanceRenderer } from './performance-renderer';

const source = readFileSync(new URL('../../src/webgl-renderer.ts', import.meta.url), 'utf8');
const shader = (name: string) => source.match(new RegExp('const ' + name + ' = (?:common \\+ )?glsl`([\\s\\S]*?)`;'))![1]!;

test('90000 unequal carrier legs are admitted whole, with a row-weighted budget and shader/CPU parity', () => {
  const m = 90000, s = new Uint32Array(m), t = new Uint32Array(m), carrier = new Uint32Array(m), notes = new Uint32Array(m), offsets = new Uint32Array(m + 1);
  for (let e = 0; e < m; e++) { const c = Math.floor(e / 3) * 3; s[e] = e % 3 ? c + 1 : c; t[e] = e % 3 ? c + 2 : c + 1; carrier[e] = c + 100; notes[c + 1] = c + 101; offsets[s[e]! + 1]!++; offsets[t[e]! + 1]!++; }
  for (let i = 1; i < offsets.length; i++) offsets[i]! += offsets[i - 1]!;
  const ranks = edgeRanks(s, t, offsets, undefined, undefined, () => true, carrier, notes);
  const vertex = shader('edgeVertex');
  const expression = (name: string) => new Function('lineRank', 'inkShare', 'fadeLength', 'len', 'min', 'max', 'float', `return ${vertex.match(new RegExp('float ' + name + ' = (.*);'))![1]!.replace(/(\d)u\b/g, '$1')};`);
  const share = expression('share'), quiet = new Function('share', 'lineRank', 'float', 'hot', 'retained', `return ${vertex.match(/float quiet = (.*);/)![1]!.replace(/(\d)u\b/g, '$1')};`);
  for (const fraction of [0, .001, .01, .1, .5, 1]) {
    let kept = 0;
    for (let e = 0; e < m; e += 3) {
      expect(ranks[e]).toBe(ranks[e + 1]!); expect(ranks[e]).toBe(ranks[e + 2]!);
      const lengths = [1, 100, 10000], yes = lengths.map(len => lineAdmitted(ranks[e]!, fraction, len, 10));
      expect(yes[0]).toBe(yes[1]!); expect(yes[1]).toBe(yes[2]!); kept += yes[0] ? 3 : 0;
      // Actual vertex expressions, including the packed marker, not a duplicate desired formula.
      if (e < 30) for (const len of lengths) expect(!!quiet(share(ranks[e], fraction, 10, len, Math.min, Math.max, Number), ranks[e], Number)).toBe(yes[0]!);
    }
    expect(Math.abs(kept - m * fraction)).toBeLessThanOrEqual(3);
  }
  const ink = edgeInk(new Float32Array([0, 0, 1, 0, 1000, 0]), new Uint32Array([0, 1]), new Uint32Array([1, 2]), () => true, 4096, true);
  expect(ink.clipped).toBe(ink.length); // no budget credit for a fade indivisible legs cannot use
});

test('only explicit carrier legs group; filters stay authoritative and ordinary links retain length fade', () => {
  const s = new Uint32Array([0, 1, 1, 0, 3]), t = new Uint32Array([1, 2, 3, 2, 2]), c = new Uint32Array([7, 7, 0xffffffff, 0xffffffff, 7]), notes = new Uint32Array([0, 8, 0, 0]), offsets = new Uint32Array([0, 2, 5, 8, 10]);
  const ranks = edgeRanks(s, t, offsets, undefined, undefined, () => true, c, notes);
  expect(ranks[0]).toBe(ranks[1]!); expect(ranks[0]! & 16777216).not.toBe(0);
  for (const e of [2, 3, 4]) expect(ranks[e]! & 16777216).toBe(0);
  const filtered = edgeRanks(s, t, offsets, undefined, undefined, e => e !== 1, c, notes);
  expect(filtered[1]).toBe(0); expect(lineAdmitted(filtered[0]!, 1, 1e6, 1)).toBe(true);
  expect(lineAdmitted(8000000, .75, 1000, 1)).toBe(false); expect(lineAdmitted(8000000, .75, 1, 1)).toBe(true);
});

test('fragment rounding is edge-seeded, never pixel-seeded, including all curve segments and pan phases', () => {
  const fragment = shader('solidFragment');
  expect(fragment).not.toContain('gl_FragCoord'); expect(fragment).toContain('uint h = seed * 26699u;');
  expect(shader('edgeVertex')).toContain('seed = uint(gl_InstanceID)');
  expect(shader('edgeVertex')).toContain('if (lineRank >= 16777216u) seed = lineRank;'); // even faint legs round together
  const quantize = new Function('tint', 'h', 'floor', 'float', `return ${fragment.match(/outputColor = (.*);/)![1]!.replace(/(\d)u\b/g, '$1')};`);
  for (let seed = 0; seed < 100; seed++) {
    let h = Math.imul(seed, 26699); h = Math.imul(h ^ h >>> 16, 73244475); h ^= h >>> 16;
    for (const alpha of [0, .0001, .0015, .004, .07]) {
      const expected = quantize(alpha, h, Math.floor, Number);
      for (let pan = 0; pan < 16; pan++) for (let segment = 0; segment < 8; segment++) expect(quantize(alpha, h, Math.floor, Number)).toBe(expected);
    }
  }
});

test('tiny node footprint always contains a full core sample at DPR 1/2 across subpixel pans', () => {
  const vertex = shader('nodeVertex'); expect(vertex).toContain('radius = max(radius, 1. / pixelRatio);');
  const radius = new Function('radius', 'pixelRatio', 'max', `return ${vertex.match(/radius = (max\(radius, 1\. \/ pixelRatio\));/)![1]};`);
  for (const dpr of [1, 2]) for (const requested of [.016, .096, .16, .5, 2]) {
    const r = radius(requested, dpr, Math.max) * dpr;
    for (let x = 0; x <= 32; x++) for (let y = 0; y <= 32; y++) {
      const distance = Math.hypot(x / 32 - .5, y / 32 - .5);
      expect(distance / r).toBeLessThan(.82); // shader core = 1 below .82, no disappearing sample
    }
  }
});

test('compiled WebGL and Canvas retain admitted edge/node sets on a fixed-zoom pan with selection', async () => {
  const d = defaultDeclaration('fixture'); d.display.reifiedAsNodes = true;
  d.edges = [{ name: 'relation', kind: 'reified', sourceProperty: 'source', targetProperty: 'target' }];
  const rows = Array.from({ length: 64 }, (_, i) => ({ path: `Node-${i}.md`, properties: {} as Record<string, unknown> }));
  for (let i = 0; i < 128; i++) rows.push({ path: `Relation-${i}.md`, properties: { source: `Node-${i % 64}.md`, target: `Node-${(i * 7 + 1) % 64}.md` } });
  const p = renderProjection(buildProjection(rows, d)), xy = Float32Array.from({ length: p.nodeCount * 2 }, (_, i) => (i * 137 % 997) / 10);
  for (const gpu of [false, true]) {
    const h = performanceRenderer(gpu), k = h.key, settings = defaults('fixture'); let r: any;
    settings.nodeSize = .16; settings.visuals.emphasis = 'adaptive'; settings.visuals.carrierLod = false;
    settings.visuals.edgeOpacity = .155; settings.visuals.curvedEdges = false; settings.visuals.groupHalos = false;
    try {
      r = await h.Renderer.create(h.stage, p, xy, new Uint8Array(p.nodeCount).fill(1), settings, () => {}, () => {}, new Uint32Array(p.nodeCount), () => true, !gpu);
      r[k('setFocus')](0, true); r.selected = 0; h.draw(r);
      const ranks = r[k('lineRanks')], state = Array.from(r[k('stateBytes')]), ratio = r.camera.ratio;
      const admitted = () => { const [share, fade] = r[k('edgeQuiet')](1); return Array.from(ranks as Uint32Array, (rank, e) => lineAdmitted(rank, share, Math.hypot(xy[p.source[e]! * 2]! - xy[p.target[e]! * 2]!, xy[p.source[e]! * 2 + 1]! - xy[p.target[e]! * 2 + 1]!) * r.scale, Math.min(fade, 1e9))); };
      const before = admitted();
      for (const pan of [0, .001, .01, -.03, .1]) {
        r.setCamera(.5 + pan, .5 - pan, ratio); h.draw(r);
        expect(r[k('lineRanks')]).toBe(ranks); expect(admitted()).toEqual(before); expect(Array.from(r[k('stateBytes')])).toEqual(state);
        for (let n = 1; n < p.nodeCount; n++) expect(r[k('drawnRadius')](n, false, 1)).toBeGreaterThanOrEqual(1);
      }
    } finally { h.dispose(r); }
  }
});
