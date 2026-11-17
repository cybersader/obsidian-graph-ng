import { test, expect } from 'bun:test';
import './support/obsidian-fixture';
import { carrierPairs, carrierThrough } from '../src/carrier-lines';
import { defaults, upgradeSettings } from '../src/settings';
import { DetailRenderer } from '../src/webgl-renderer';
import { lineAdmitted } from '../src/render-effects';
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
