import { test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { focusTiers, incidentEdges, tintedEdge, edgeBucket } from '../src/render-data';
import { focusLabels } from '../src/render-labels';
import { defaultDeclaration, digest, layoutDeclaration, migrateDeclaration, type GraphDeclaration } from '../src/core/declaration';
import { declaredKeys } from '../src/core/columns';
import { buildProjection, type FactRow } from '../src/core/projection';

// Optional declaration-driven semantic tiers. Deterministic CPU tests only; no GPU raster claim.
const NONE = 0xffffffff, D = 255, A = 192, C = 128, G = 64;
function graph(n: number, pairs: [number, number][], parents: number[][] = [], tint?: number[]) {
  const source = Uint32Array.from(pairs, x => x[0]), target = Uint32Array.from(pairs, x => x[1]), offsets = new Uint32Array(n + 1);
  for (let i = 0; i < n; i++) offsets[i + 1] = offsets[i]! + (parents[i]?.length ?? 0);
  const p = { source, target, carrier: new Uint32Array(pairs.length).fill(NONE), carrierNodes: new Uint32Array(n), up: parents.length ? { offsets, targets: Uint32Array.from(parents.flatMap(x => x ?? [])) } : undefined, tint: tint && Uint8Array.from(tint) };
  return { n, m: pairs.length, p, inc: incidentEdges({ nodeCount: n, source, target }) };
}
function run(g: ReturnType<typeof graph>, f: number, o: { codes?: number[]; vis?: number[]; max?: number } = {}) {
  const state = new Uint8Array(g.n * 4), edge = new Uint8Array(g.m), nodes: number[] = [], edges: number[] = [];
  const cut = focusTiers(f, g.inc, g.p, new Uint8Array(g.m).fill(1), o.vis ? Uint8Array.from(o.vis) : new Uint8Array(g.n).fill(1), state, edge, nodes, edges, o.max, o.codes);
  return { cut, tiers: Array.from({ length: g.n }, (_, i) => state[i * 4 + 1]!), edge: [...edge], nodes, edges, state };
}

test('semantic ancestors: chain beyond two hops is a soft tier; direct and 2-hop precedence hold', () => {
  // Chain 0 -> 1 -> 2 -> 3 -> 4 by parent property and by edges; 5 is a 2-hop link via 1.
  const g = graph(6, [[0, 1], [1, 2], [2, 3], [3, 4], [1, 5]], [[1], [2], [3], [4], []]), r = run(g, 0);
  expect(r.tiers).toEqual([D, D, A, A, A, C]); expect(r.cut).toBe(0);
  // Parent edge direct (255); ancestor chain edges lit 128; the 2-hop lateral 128.
  expect(r.edge).toEqual([D, C, C, C, C]);
  // Without the binding the same graph is the plain hop cloud.
  expect(run(graph(6, [[0, 1], [1, 2], [2, 3], [3, 4], [1, 5]]), 0).tiers).toEqual([D, D, C, 0, 0, C]);
  // Ancestor without any edge is still lit; a direct neighbour that is also an ancestor stays direct.
  expect(run(graph(3, [[0, 1]], [[2, 1], [], []]), 0).tiers).toEqual([D, D, A]);
  // Descendants are not ancestors: focusing the root leaves the deep child context.
  expect(run(g, 4).tiers).toEqual([0, 0, C, D, D, 0]);
});
test('semantic ancestors: cycles, self, multiple parents, missing and hidden parents, depth and fan bounds', () => {
  const cyc = run(graph(4, [], [[1], [2], [0], [3]]), 0); expect(cyc.tiers).toEqual([D, A, A, 0]); expect(new Set(cyc.nodes).size).toBe(cyc.nodes.length);
  expect(run(graph(1, [], [[0]]), 0).tiers).toEqual([D]);
  expect(run(graph(5, [], [[1, 2], [3], [3], [], []]), 0).tiers).toEqual([D, A, A, A, 0]);
  // Hidden parent is passed through, not lit; its parent still is.
  expect(run(graph(3, [[1, 2]], [[1], [2], []]), 0, { vis: [1, 0, 1] }).tiers).toEqual([D, 0, A]);
  const deep = run(graph(12, [], [...Array.from({ length: 11 }, (_, i) => [i + 1]), []]), 0); expect(deep.tiers.filter(v => v === A).length).toBe(8);
  const fan = graph(401, [], [Array.from({ length: 400 }, (_, i) => i + 1)]); expect(run(fan, 0).tiers.filter(v => v === A).length).toBe(255);
});
test('semantic same group: faint tier above context, below everything else, capped and reported', () => {
  const g = graph(6, [[0, 1], [1, 2]], [[3], [], [], [], [], []]), codes = [7, 7, 7, 7, 7, 2];
  const r = run(g, 0, { codes }); expect(r.tiers).toEqual([D, D, C, A, G, 0]); expect(r.cut).toBe(0);
  expect(run(g, 0, { codes, vis: [1, 1, 1, 1, 0, 1] }).tiers[4]).toBe(0);
  const big = graph(5000, []), many = run(big, 0, { codes: new Array(5000).fill(1) });
  expect(many.cut).toBe(2); expect(many.tiers.filter(v => v === G).length).toBe(4096);
  expect(run(big, 0, { codes: new Array(5000).fill(1), max: 100 }).cut).toBe(2);
  expect(run(graph(4, []), 0, { codes: [1, 1, 1, 1] }).cut).toBe(0);
});
test('semantic tinted layer keeps tier weight: a direct mapping stays direct', () => {
  const g = graph(4, [[0, 1], [1, 2], [0, 3]], [], [1, 1, 0]), r = run(g, 0);
  expect(r.tiers).toEqual([D, D, C, D]); expect(r.edge).toEqual([254, 127, D]);
  expect(r.edge.map(edgeBucket)).toEqual([D, C, D]); expect(r.edge.map(tintedEdge)).toEqual([true, true, false]);
  // Shader: tinted edges keep the tier test and mix the accent by focus / 2.
  const src = readFileSync(new URL('../src/webgl-renderer.ts', import.meta.url), 'utf8');
  expect(src).toContain('if (tier == 254u || tier == 127u) rgb = mix(rgb, color(4).rgb, focus * .5);');
});
test('semantic labels rank focus > direct > ancestor > 2-hop > same group', () => {
  const g = graph(6, [[0, 1], [1, 2]], [[3], [], [], [], [], []]), r = run(g, 0, { codes: [7, 7, 7, 7, 7, 2] });
  const ranked = focusLabels(0, r.nodes, r.state, new Uint8Array(6).fill(1), g.inc.offsets, (node, rank) => ({ node, x: node * 100, y: 0, w: rank ? 40 : 60, h: 10 }), 10, 10, 10);
  expect(ranked).toEqual([[0, 0], [1, 1], [3, 2], [2, 3], [4, 4]]);
});
test('declaration: hierarchy, groupContext and tint validate, migrate and stay out of layout identity', async () => {
  const base = defaultDeclaration('p@1'), bound: GraphDeclaration = { ...base, hierarchy: { parentProperty: 'parent_id' }, groupContext: true, edges: [...base.edges, { name: 'map', kind: 'reified', sourceProperty: 's', targetProperty: 't', highlight: 'tint' }] };
  expect(migrateDeclaration(bound)).toEqual(bound);
  for (const bad of [{ hierarchy: {} }, { hierarchy: { parentProperty: '' } }, { hierarchy: { parentProperty: 'p', depth: 3 } }, { groupContext: 'yes' }, { edges: [{ name: 'm', kind: 'reified', sourceProperty: 's', targetProperty: 't', highlight: 'dash' }] }])
    expect(() => migrateDeclaration({ ...base, ...bad })).toThrow();
  expect(declaredKeys(bound)).toContain('parent_id'); expect(declaredKeys(base)).not.toContain('parent_id');
  const plain = { ...bound, edges: [...base.edges, { name: 'map', kind: 'reified' as const, sourceProperty: 's', targetProperty: 't' }] }; delete (plain as Partial<GraphDeclaration>).hierarchy; delete (plain as Partial<GraphDeclaration>).groupContext;
  expect(await digest(layoutDeclaration(bound))).toBe(await digest(layoutDeclaration(plain)));
  // Absent fields keep historical digest bytes.
  expect(await digest(layoutDeclaration(base))).toBe(await digest({ ...base, colors: [] }));
});
test('projection: parents resolve by identity or path; unresolved, self and duplicates drop; tint marks rule edges only', () => {
  const rows: FactRow[] = [
    { path: 'a.md', properties: { id: 'X:1', parent: ['X', 'X', 'missing', 'X:1'] } },
    { path: 'b.md', properties: { id: 'X' } },
    { path: 'c.md', properties: { id: 'Y:1', parent: 'b.md', up: 'Y:1' } },
    { path: 'm.md', properties: { s: 'X:1', t: 'Y:1' } },
  ];
  const d: GraphDeclaration = { ...defaultDeclaration('p@1'), identity: [{ key: 'id' }], hierarchy: { parentProperty: 'parent' }, edges: [{ name: 'map', kind: 'reified', sourceProperty: 's', targetProperty: 't', highlight: 'tint' }, { name: 'up', kind: 'inline', key: 'up', type: 'up' }] };
  const p = buildProjection(rows, d);
  expect(p.paths).toEqual(['a.md', 'b.md', 'c.md']); expect([...p.up!.offsets]).toEqual([0, 1, 1, 2]); expect([...p.up!.targets]).toEqual([1, 1]);
  expect([...p.tint!]).toEqual([0, 1]);
  const none = buildProjection(rows, { ...d, hierarchy: undefined, edges: d.edges.map(e => ({ ...e, highlight: undefined })) as GraphDeclaration['edges'] });
  expect(none.up).toBeUndefined(); expect(none.tint).toBeUndefined();
});
