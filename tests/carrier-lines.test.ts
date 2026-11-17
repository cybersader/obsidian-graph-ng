import { test, expect } from 'bun:test';
import './support/obsidian-fixture';
import { carrierPairs, carrierThrough, carrierFocus, carrierAdmitted } from '../src/carrier-lines';
import { defaults, upgradeSettings } from '../src/settings';
import { DetailRenderer } from '../src/webgl-renderer';
import { lineAdmitted, carrierCoverage, carrierAlpha } from '../src/render-effects';
import { readFileSync } from 'node:fs';

function fixture() {
  const p: any = { nodeCount: 4, source: new Uint32Array([0, 1, 0, 1, 2]), target: new Uint32Array([1, 2, 1, 3, 3]), carrier: new Uint32Array([7, 7, 7, 7, 0xffffffff]), carrierNodes: new Uint32Array([0, 8, 0, 0]) };
  const on = new Uint8Array(5).fill(1), visible = new Uint8Array(4).fill(1), ranks = new Uint32Array([0x1800000, 0x1800000, 0x1800000, 0x1800000, 0]);
  return { p, on, visible, ranks };
}
test('render pairs retain real endpoints, multi-target pairs, identity and ordinary edges', () => {
  const f = fixture(), before = Array.from(f.p.source), g = carrierPairs(f.p, f.on, f.visible, f.ranks);
  expect(Array.from(g.ends)).toEqual([3, 0x80000001, 4, 0x80000001, 0]);
  expect(Array.from(g.nodes)).toEqual([0xffffffff, 0x1800000, 0xffffffff, 0xffffffff]);
  expect(Array.from(f.p.source)).toEqual(before);
  f.visible[2] = 0; const partial = carrierPairs(f.p, f.on, f.visible, f.ranks);
  expect(Array.from(partial.enabled)).toEqual([0, 0, 1, 1, 1]); expect(Array.from(f.on)).toEqual([1, 1, 1, 1, 1]); expect(partial.nodes[1]).toBe(0x1800000);
  f.on[0] = f.on[2] = 0; expect(carrierPairs(f.p, f.on, f.visible, f.ranks).nodes[1]).toBe(0xffffffff); expect(f.on[3]).toBe(1);
  f.p.carrier[1] = 6; expect(carrierPairs(f.p, f.on, f.visible, f.ranks).ends[0]).toBe(0);
});
test('no orphan dots, dangling legs or double bridges across zoom, ink, edge modes and tiny sizes', () => {
  const f = fixture(), r: any = Object.create(DetailRenderer.prototype), settings = defaults('links');
  Object.assign(r, { settings, projection: f.p, lineRanks: f.ranks, carrierGeometry: carrierPairs(f.p, f.on, f.visible, f.ranks), stateBytes: new Uint8Array(16), camera: { ratio: 1 }, homeRatio: 1, visibleCarriers: 1, selected: -1, hoverFx: { n: -1 }, focusNode: -1, tierMask: 15 });
  for (const radius of [.0001, .3, 1.49, 1.5, 2, 10]) for (const zoom of [.01, .4, 1, 8]) for (const share of [0, .25, .5, .50001, 1]) for (const mode of ['auto', 'through', 'direct'] as const) {
    settings.visuals.carrierLines = mode; settings.visuals.carrierSize = 1; r.camera.ratio = zoom; r.baseNodeRadius = () => radius;
    const through = carrierThrough(mode, radius), admitted = lineAdmitted(f.ranks[0]!, share, 1e6, 1);
    expect(r.carrierShown(1, share, 0)).toBe(through && admitted);
    const a = r.lineTarget(0, +through), b = r.lineTarget(1, +through);
    expect(a).toBe(through ? 1 : 2); expect(b).toBe(through ? 2 : -1);
    const legs = through && admitted ? [a, b] : [], bridge = !through && admitted ? [a] : [];
    expect(legs.length === 2).toBe(r.carrierShown(1, share, 0)); expect(legs.length && bridge.length).toBe(0);
    for (const edgeMode of ['off', 'focus'] as const) { settings.visuals.edgeMode = edgeMode; expect(r.carrierShown(1, share, 0)).toBe(false); } settings.visuals.edgeMode = 'all';
    settings.visuals.edgeOpacity = 0; expect(r.carrierShown(1, share, 0)).toBe(false); settings.visuals.edgeOpacity = .4;
  }
  // The nominal size only decides topology. Through mode always floors the rendered dot at 2 CSS px.
  const source = readFileSync(new URL('../src/webgl-renderer.ts', import.meta.url), 'utf8');
  expect(source).toContain('if (note) radius = max(radius, 2.);');
  expect(source).toContain('if (through && alpha > 0.) alpha = max(.25, alpha);');
  expect(source).toContain('carrierRank & 16777215u'); expect(source).toContain('lineRank & 16777215u');
  expect(source).toContain('if (foldEnd >= 2147483648u) { gl_Position = offscreen; return; }');
});
test('legacy fold booleans migrate readably, explicit choices win, and every old carrier key survives', () => {
  for (const carrierLod of [true, false]) {
    const s: any = defaults('links'); delete s.visuals.carrierLines; s.visuals.carrierLod = carrierLod;
    const old = { ...s.visuals }, migrated = upgradeSettings(s, 'links');
    expect(migrated.visuals.carrierLines).toBe(carrierLod ? 'auto' : 'through');
    for (const key of Object.keys(old).filter(k => k.startsWith('carrier'))) expect((migrated.visuals as any)[key]).toEqual(old[key]);
    for (const mode of ['auto', 'through', 'direct'] as const) { s.visuals.carrierLines = mode; expect(upgradeSettings(s, 'links').visuals.carrierLines).toBe(mode); }
  }
  expect(defaults('links').visuals.carrierLines).toBe('auto');
});

test('nested relationship endpoints retain the whole carrier component in Direct, tiny Auto and Through', () => {
  const p: any = { nodeCount: 5, source: new Uint32Array([0, 1, 1, 3]), target: new Uint32Array([1, 2, 3, 4]), carrier: new Uint32Array([7, 7, 8, 8]), carrierNodes: new Uint32Array([0, 8, 0, 9, 0]) };
  const on = new Uint8Array(4).fill(1), visible = new Uint8Array(5).fill(1), ranks = new Uint32Array([0x1e00000, 0x1e00000, 0x1f00000, 0x1f00000]);
  const geometry = carrierPairs(p, on, visible, ranks), settings = defaults('links'), r: any = Object.create(DetailRenderer.prototype);
  expect(geometry.groups.map(g => g[0])).toEqual([[1, 3]]); expect(Array.from(ranks)).toEqual(Array(4).fill(0x3ffffff));
  Object.assign(r, { settings, projection: p, lineRanks: ranks, carrierGeometry: geometry, stateBytes: new Uint8Array(20), camera: { ratio: 1 }, homeRatio: 1, visibleCarriers: 2, selected: -1, hoverFx: { n: -1 }, focusNode: -1, tierMask: 15, baseNodeRadius: () => .00001 });
  for (const mode of ['auto', 'through', 'direct'] as const) {
    settings.visuals.carrierLines = mode;
    for (const share of [0, .00001, .1, 1]) {
      expect(r.carrierShown(1, share, 0)).toBe(share === 1); expect(r.carrierShown(3, share, 0)).toBe(share === 1);
      for (let e = 0; e < 4; e++) expect(r.lineTarget(e, 0)).toBe(p.target[e]);
    }
  }
  settings.visuals.edgeMode = 'focus'; expect(r.carrierShown(1, 1, 1)).toBe(false); expect(r.carrierShown(3, 1, 1)).toBe(false);
  const touched = [1]; r.stateBytes[5] = 255; carrierFocus(geometry, ranks, r.stateBytes, touched);
  expect(touched).toEqual([1, 3]); expect(r.stateBytes[13]).toBe(255); r.tierMask = 0;
  expect(r.carrierShown(1, 1, 1)).toBe(true); expect(r.carrierShown(3, 1, 1)).toBe(true);
  for (const n of touched) r.stateBytes[n * 4 + 1] = 0;
  carrierFocus(geometry, ranks, r.stateBytes, []); expect(r.carrierShown(3, 1, 1)).toBe(false);
  settings.visuals.edgeMode = 'all'; settings.visuals.carrierOpacity = 0;
  expect(r.carrierShown(1, 1, 0)).toBe(false); expect(r.carrierShown(3, 1, 0)).toBe(false);
});
test('an ordinary link targeting a relationship retains its endpoint and complete legs; filters still win', () => {
  const f = fixture(); f.p.source[4] = 3; f.p.target[4] = 1;
  let g = carrierPairs(f.p, f.on, f.visible, f.ranks);
  expect(g.groups.map(g => g[0])).toEqual([[1]]); expect(g.nodes[1]).toBe(0x3ffffff); expect(Array.from(f.ranks)).toEqual(Array(5).fill(0x3ffffff));
  f.visible[0] = 0; g = carrierPairs(f.p, f.on, f.visible, f.ranks);
  expect(g.nodes[1]).toBe(0xffffffff); expect(Array.from(g.enabled)).toEqual([0, 0, 0, 0, 0]); expect(Array.from(f.on)).toEqual([1, 1, 1, 1, 1]);
});

test('a retained multi-target carrier suppresses its whole attachment when one required pair is filtered', () => {
  const f = fixture(); f.p.source[4] = 3; f.p.target[4] = 1; f.visible[2] = 0;
  const g = carrierPairs(f.p, f.on, f.visible, f.ranks);
  expect(g.groups).toEqual([]); expect(g.nodes[1]).toBe(0xffffffff); expect(Array.from(g.enabled)).toEqual([0, 0, 0, 0, 0]); expect(Array.from(f.on)).toEqual([1, 1, 1, 1, 1]);
});

test('whole component budgets prioritize focus then size and never exceed their row allocation', () => {
  const p: any = { nodeCount: 9, source: new Uint32Array([0,1,0,3,3,4,8,7]), target: new Uint32Array([1,2,3,2,4,5,7,6]), carrier: new Uint32Array([7,7,8,8,9,9,10,10]), carrierNodes: new Uint32Array([0,8,0,9,10,0,0,11,0]) };
  // Ordinary attachments make the two isolated pairs eligible retained components too.
  p.source = new Uint32Array([...p.source, 2, 6]); p.target = new Uint32Array([...p.target, 1, 7]); p.carrier = new Uint32Array([...p.carrier, 0xffffffff, 0xffffffff]);
  const ranks = new Uint32Array(10), g = carrierPairs(p, new Uint8Array(10).fill(1), new Uint8Array(9).fill(1), ranks), state = new Uint8Array(36);
  expect(g.groups.map(x => x[1].length)).toEqual([3,3,4]);
  for (const focused of [-1, 3, 7]) { state.fill(0); if (focused >= 0) state[focused * 4 + 1] = 255; carrierFocus(g, ranks, state, []);
    if (focused >= 0) expect(g.groups[0]![0]).toContain(focused);
    for (const share of [0, .1, .3, .4, .6, .7, .99, 1]) {
      let rows = 0; for (const [nodes, edges] of g.groups) { const yes = carrierAdmitted(g.nodes[nodes[0]!]!, share); for (const n of nodes) expect(carrierAdmitted(g.nodes[n]!, share)).toBe(yes); for (const e of edges) expect(carrierAdmitted(ranks[e]!, share)).toBe(yes); if (yes) rows += edges.length; }
      expect(rows).toBeLessThanOrEqual(Math.floor(share * ranks.length));
    }
  }
});

test('current coverage preserves legacy non-folding opacity without importing old fold thresholds', () => {
  const v = defaults('links').visuals;
  for (const count of [0, 15000, 1000000]) for (const zoom of [.001, .3, 1, 8]) for (const opacity of [0, .1, .9]) { const s = { ...v, carrierOpacity: opacity }; expect(carrierCoverage(s, count, zoom)).toBe(carrierAlpha({ ...s, carrierLod: false }, count, zoom)); }
});

test('retention review two: ordinary rows and retained components share one weighted allocation', () => {
  const source: number[] = [], target: number[] = [], own: number[] = [], notes = new Uint32Array(122);
  for (let i = 0; i < 30; i++) { const n = i * 3; source.push(n, n + 1, n + 2); target.push(n + 1, n + 2, n + 1); own.push(i, i, 0xffffffff); notes[n + 1] = i + 1; }
  for (let i = 0; i < 30; i++) { source.push(90 + i); target.push(91 + i); own.push(0xffffffff); }
  const p: any = { nodeCount: 122, source: Uint32Array.from(source), target: Uint32Array.from(target), carrier: Uint32Array.from(own), carrierNodes: notes };
  // Ordinary rows deliberately own the lowest original ranks, reproducing the old double allocation.
  const ranks = Uint32Array.from({ length: 120 }, (_, e) => e < 90 ? 0x1ffffff : Math.floor((e - 90 + .5) * 0x1000000 / 120));
  const g = carrierPairs(p, new Uint8Array(120).fill(1), new Uint8Array(122).fill(1), ranks);
  for (const share of [0, .001, .1, .24999999, .25, .5, .75, .99, 1]) {
    const admitted = Array.from(ranks, rank => rank & 0x2000000 ? carrierAdmitted(rank, share) : lineAdmitted(rank, share, 1, Infinity));
    expect(admitted.filter(Boolean).length).toBeLessThanOrEqual(Math.floor(120 * share));
    for (const [, edges] of g.groups) expect(edges.every(e => admitted[e] === admitted[edges[0]!])).toBe(true);
  }
  expect(Array.from(ranks).filter(rank => lineAdmitted(rank, .25, 1, Infinity))).toHaveLength(30);
});
