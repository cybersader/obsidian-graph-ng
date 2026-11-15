import { test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { lensConnections, lensLayout, lensAmount, lensCoordinate, pickLens } from '../src/lens-layout';
import { PickGrid, incidentEdges } from '../src/render-data';
import { encodeStrings } from '../src/core/columns';
import type { RenderProjection } from '../src/render-projection';

function graph(pairs: number[][], names = ['Focus', 'Zulu', 'Alpha', 'Beta', 'Far', 'Hidden']) {
  const p: RenderProjection = { nodeCount: names.length, paths: encodeStrings(names), offsets: new Uint32Array(names.length + 1), source: Uint32Array.from(pairs, e => e[0]!), target: Uint32Array.from(pairs, e => e[1]!), type: Uint32Array.from(pairs, e => e[2] ?? 0), types: ['alpha', 'zeta'], carrier: Uint32Array.from(pairs, e => e[3] ?? 0xffffffff), carrierNodes: new Uint32Array(names.length), groups: [], quarantined: [] };
  const inc = incidentEdges(p), on = new Uint8Array(pairs.length).fill(1), visible = new Uint8Array(names.length).fill(1);
  return { p, inc, on, visible, names, get: (rendered = visible) => lensConnections(0, p, inc, on, visible, rendered, n => names[n]!) };
}
test('lens connections sort by type then name, deduplicate parallel rows and ignore self-links', () => {
  const f = graph([[0, 1, 1], [2, 0], [0, 3], [0, 1], [0, 0], [1, 4]]);
  expect(f.get().map(c => c.node)).toEqual([2, 3, 1]);
  expect(f.get().map(c => c.type)).toEqual(['alpha', 'alpha', 'alpha']);
  f.on[3] = 0; expect(f.get().map(c => c.type)).toEqual(['alpha', 'alpha', 'zeta']);
  expect(f.get()).toEqual(f.get());
});
test('lens membership respects filters, hidden types, collapsed nodes and transparent carrier rows', () => {
  const f = graph([[0, 1, 1, 4], [1, 2, 1, 4], [1, 3], [0, 4], [0, 5]]);
  f.p.carrierNodes[1] = 5; f.visible[5] = 0; f.on[3] = 0;
  expect(f.get().map(c => c.node)).toEqual([2, 1]);
  const rendered = f.visible.slice(); rendered[1] = 0;
  expect(f.get(rendered).map(c => c.node)).toEqual([2]);
  f.visible[1] = 0; expect(f.get()).toEqual([]);
  expect(lensConnections(-1, f.p, f.inc, f.on, f.visible, f.visible, () => '')).toEqual([]);
});
test('lens ring geometry is deterministic, empty-safe, ordered and has no overlap at high degree', () => {
  expect(lensLayout([]).size).toBe(0);
  for (const count of [1, 2, 6, 7, 32, 400]) {
    const rows = Array.from({ length: count }, (_, node) => ({ node, type: '', name: String(node) })), points = lensLayout(rows, 70, 90);
    expect([...points.keys()]).toEqual(rows.map(row => row.node)); expect(lensLayout(rows, 70, 90)).toEqual(points);
    let previousRadius = 0; const list = [...points.values()];
    for (let i = 0; i < list.length; i++) {
      const p = list[i]!, radius = Math.hypot(p.x, p.y); expect(radius).toBeGreaterThanOrEqual(previousRadius - .001); previousRadius = radius;
      for (let j = 0; j < i; j++) expect(Math.hypot(p.x - list[j]!.x, p.y - list[j]!.y)).toBeGreaterThanOrEqual(69.999);
    }
    if (count === 400) expect(previousRadius).toBeGreaterThan(90 + 70);
  }
  for (const spacing of [0, -1, NaN, Infinity]) expect(() => lensLayout([], spacing)).toThrow('LENS_NONFINITE_SIZE');
});
test('lens interpolation is monotone, reversible without a jump and instant with reduced motion', () => {
  expect(lensAmount(0, 1, -10)).toBe(0); expect(lensAmount(0, 1, 110)).toBe(.5); expect(lensAmount(0, 1, 999)).toBe(1);
  expect(lensAmount(.5, 0, 0)).toBe(.5); expect(lensAmount(.5, 0, 110)).toBe(.25); expect(lensAmount(.5, 0, 999)).toBe(0);
  expect(lensAmount(0, 1, 0, 220, true)).toBe(1); expect(lensAmount(1, 0, 0, 220, true)).toBe(0);
  for (let time = 1; time <= 220; time++) expect(lensAmount(0, 1, time)).toBeGreaterThanOrEqual(lensAmount(0, 1, time - 1));
});
test('lens position equation agrees with the shader and keeps ring distances constant across zoom', () => {
  const source = readFileSync(new URL('../src/webgl-renderer.ts', import.meta.url), 'utf8');
  expect(source).toContain('base += (texelFetch(positions, cell(lensAnchor), 0).xy + lens.xy / scale - base) * lensBlend');
  for (const scale of [.001, .1, 1, 100]) {
    for (const amount of [0, .25, .5, 1]) expect(lensCoordinate(-300, 20, 90, scale, amount)).toBeCloseTo(-300 + (20 + 90 / scale + 300) * amount, 8);
    expect((lensCoordinate(-300, 20, 90, scale, 1) - 20) * scale).toBeCloseTo(90, 8);
  }
});
test('lens picking uses moved positions during entry/exit and excludes ghost hits in the old grid', () => {
  const positions = new Float32Array([0, 0, 100, 0, 1, 1, -30, -30]), copy = positions.slice(), visible = new Uint8Array([1, 1, 1, 0]);
  const grid = new PickGrid(positions, visible), points = new Map([[1, { x: 0, y: 20 }]]);
  const pick = (x: number, y: number, amount: number, eligible = (n: number) => !!visible[n]) => pickLens(grid, points, x, y, 2, n => ({ x: lensCoordinate(positions[n * 2]!, 0, points.get(n)?.x ?? positions[n * 2]!, 1, points.has(n) ? amount : 0), y: lensCoordinate(positions[n * 2 + 1]!, 0, points.get(n)?.y ?? positions[n * 2 + 1]!, 1, points.has(n) ? amount : 0) }), () => 2, eligible);
  expect(pick(0, 20, 1)).toBe(1); expect(pick(100, 0, 1)).toBe(-1); expect(pick(50, 10, .5)).toBe(1);
  expect(pick(100, 0, 0)).toBe(1); expect(pick(0, 0, 1)).toBe(0); expect(pick(-30, -30, 1)).toBe(-1);
  expect(pick(0, 20, 1, n => n !== 1 && !!visible[n])).toBe(-1); expect(positions).toEqual(copy);
});
test('lens picking has deterministic ties and works outside the original grid bounds', () => {
  const grid = new PickGrid(new Float32Array([0, 0, 10, 0, 20, 0]), new Uint8Array([1, 1, 1]));
  const points = new Map([[2, { x: -1000, y: -1000 }], [1, { x: -1000, y: -1000 }]]);
  expect(pickLens(grid, points, -1000, -1000, 3, n => points.get(n) ?? { x: 0, y: 0 }, () => 3, () => true)).toBe(1);
});

test('lens Appearance control exposes temporary pressed/disabled state and calls the host without saving', async () => {
  const { ExplorePanel } = await import('../src/explore-panel');
  const { defaults } = await import('../src/settings');
  const { ControlElement } = await import('./support/controls-dom');
  const panel: any = Object.create(ExplorePanel.prototype), root = new ControlElement(), settings = defaults('links'), saved = JSON.stringify(settings);
  const state = { active: false, available: false }; let toggles = 0;
  panel.host = { settings: () => settings, lens: () => state, toggleLens: () => { toggles++; state.active = !state.active; }, carriers: () => 0, fit() {} };
  // Other Appearance sections have their own tests; run the actual lens control construction.
  for (const name of ['suggested', 'nodes', 'slider', 'flag', 'guard', 'note']) panel[name] = () => {};
  panel.display(root); const button = root.querySelectorAll('button').find(b => b.getAttribute('aria-label') === 'Connection lens')!;
  expect(button).toBeDefined(); expect(button.disabled).toBe(true); button.click(); expect(toggles).toBe(0);
  state.available = true; panel.updateLensControl(); expect(button.getAttribute('aria-pressed')).toBe('false');
  button.click(); expect(toggles).toBe(1); expect(button.getAttribute('aria-pressed')).toBe('true');
  state.active = false; panel.updateLensControl(); expect(button.getAttribute('aria-pressed')).toBe('false');
  expect(JSON.stringify(settings)).toBe(saved);
  expect(readFileSync(new URL('../styles.css', import.meta.url), 'utf8')).toContain('.graph-ng-lens-toggle { min-height: 32px; min-width: 32px; }');
});
