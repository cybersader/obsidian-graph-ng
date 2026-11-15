import { test, expect, afterAll } from 'bun:test';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { focusTiers, incidentEdges, tierNode, tierEdge, tierLabel } from '../src/render-data';
import { focusLabels } from '../src/render-labels';
import before from './support/compositing-before.json';

// Pure presentation helper and the actual shader scalar expressions. No GPU raster, native
// visual quality, FPS or touch-device claim is made by these deterministic tests.
const NONE = 0xffffffff, D = 255, C = 128;
type Pair = [number, number, number?];
function graph(n: number, pairs: Pair[], carrierNodes: number[] = []) {
  const source = Uint32Array.from(pairs, x => x[0]), target = Uint32Array.from(pairs, x => x[1]);
  const p = { source, target, carrier: Uint32Array.from(pairs, x => x[2] ?? NONE), carrierNodes: Uint32Array.from({ length: n }, (_, i) => carrierNodes[i] ?? 0) };
  return { n, m: pairs.length, p, inc: incidentEdges({ nodeCount: n, source, target }) };
}
type G = ReturnType<typeof graph>;
function run(g: G, f: number, o: { on?: Uint8Array; vis?: Uint8Array; max?: number; state?: Uint8Array; edge?: Uint8Array } = {}) {
  const state = o.state ?? new Uint8Array(g.n * 4), edge = o.edge ?? new Uint8Array(g.m), nodes: number[] = [], edges: number[] = [];
  const partial = focusTiers(f, g.inc, g.p, o.on ?? new Uint8Array(g.m).fill(1), o.vis ?? new Uint8Array(g.n).fill(1), state, edge, nodes, edges, o.max);
  return { partial, tiers: Array.from({ length: g.n }, (_, i) => state[i * 4 + 1]!), edge: [...edge], nodes, edges, state };
}
const measurements: Record<string, unknown>[] = [];
afterAll(() => { const dir = new URL('../.workspace/evidence/', import.meta.url); mkdirSync(dir, { recursive: true }); writeFileSync(new URL('graduated-focus.json', dir), JSON.stringify({ kind: 'CPU-only helper measurement under bun test; not GPU/native frame time', measurements }, null, 2)); });

test('graduated tiers: focus and direct, then neighbours of neighbours, rest untouched', () => {
  const g = graph(5, [[0, 1], [1, 2], [2, 3], [3, 4]]), r = run(g, 0);
  expect(r.tiers).toEqual([D, D, C, 0, 0]); expect(r.edge).toEqual([D, C, 0, 0]); expect(r.partial).toBe(0);
  expect(r.nodes).toEqual([0, 1, 2]); expect(r.edges).toEqual([0, 1]);
  // Only the G byte is written; R/B/A state bytes stay untouched.
  r.state.forEach((v, i) => { if (i % 4 !== 1) expect(v).toBe(0); });
  // Direction is preserved but not used as a semantic: incoming and outgoing hops are equal.
  expect(run(graph(3, [[1, 0], [2, 1]]), 0).tiers).toEqual([D, D, C]);
});
test('graduated direct crosswalk precedence: edge-note hops are transparent; minimum hop wins', () => {
  // Literal display: A -> note -> B as two half-edges of carrier row 5; B -> D an ordinary link.
  const literal = graph(4, [[0, 1, 5], [1, 2, 5], [2, 3]], [0, 6]);
  for (const focus of [0, 2]) { const r = run(literal, focus); expect(r.tiers).toEqual(focus === 0 ? [D, D, D, C] : [D, D, D, D]); expect(r.edge.slice(0, 2)).toEqual([D, D]); }
  expect(run(literal, 1).tiers).toEqual([D, D, D, C]);
  // Aggregated display: the same mapping is a single tier-1 edge.
  expect(run(graph(3, [[0, 1, 5], [1, 2]]), 0).tiers).toEqual([D, D, C]);
  // An edge note reached at hop 2 keeps both of its own relationship rows lit as context.
  const far = run(graph(4, [[3, 0], [0, 1, 5], [1, 2, 5]], [0, 6]), 3); expect(far.tiers).toEqual([D, C, C, D]); expect(far.edge).toEqual([D, C, C]);
  // An edge note is transparent however it is reached; only its own relationship rows pass through.
  const other = graph(5, [[0, 1, 5], [1, 2, 5], [3, 1], [1, 4]], [0, 6]); expect(run(other, 3).tiers).toEqual([D, D, D, D, C]);
  expect(run(other, 3).edge).toEqual([D, D, D, C]);
  // Triangle: reachable directly and via two hops stays direct; the lateral is a context edge.
  const t = run(graph(3, [[0, 1], [1, 2], [0, 2]]), 0); expect(t.tiers).toEqual([D, D, D]); expect(t.edge).toEqual([D, C, D]);
});
test('graduated absent metadata: isolated, unset, hidden focus and empty graphs make an empty cloud without throwing', () => {
  const g = graph(3, [[1, 2]]);
  expect(run(g, 0).tiers).toEqual([D, 0, 0]); expect(run(g, 0).edges).toEqual([]);
  for (const r of [run(g, -1), run(g, 1, { vis: new Uint8Array([1, 0, 1]) })]) { expect(r.nodes).toEqual([]); expect(r.edges).toEqual([]); expect(r.partial).toBe(0); expect(r.tiers).toEqual([0, 0, 0]); }
  expect(run(graph(1, []), 0).tiers).toEqual([D]);
  // Single type, no carrier rows at all: still purely topological.
  const plain = { ...graph(2, [[0, 1]]) }; plain.p = { ...plain.p, carrier: new Uint32Array(1).fill(NONE) }; expect(run(plain, 1).tiers).toEqual([D, D]);
});
test('graduated cycles, multiple parents, self-loops and parallel edges resolve deterministically once', () => {
  const cycle = run(graph(4, [[0, 1], [1, 2], [2, 3], [3, 0]]), 0); expect(cycle.tiers).toEqual([D, D, C, D]); expect(cycle.edge).toEqual([D, C, C, D]);
  const parents = run(graph(4, [[0, 1], [0, 2], [1, 3], [2, 3]]), 0); expect(parents.tiers).toEqual([D, D, D, C]); expect(parents.nodes).toEqual([0, 1, 2, 3]);
  const loops = run(graph(3, [[0, 0], [0, 1], [0, 1], [1, 1], [1, 2]]), 0); expect(loops.tiers).toEqual([D, D, C]); expect(loops.edge).toEqual([D, D, D, C, C]);
  for (const r of [cycle, parents, loops]) { expect(new Set(r.nodes).size).toBe(r.nodes.length); expect(new Set(r.edges).size).toBe(r.edges.length); }
  expect(run(graph(4, [[0, 1], [1, 2], [2, 3], [3, 0]]), 0)).toEqual(cycle);
});
test('graduated masks: hidden types and filter-hidden nodes gate traversal', () => {
  const g = graph(4, [[0, 1], [1, 2], [0, 3]]);
  expect(run(g, 0, { on: new Uint8Array([1, 1, 0]) }).tiers).toEqual([D, D, C, 0]);
  expect(run(g, 0, { vis: new Uint8Array([1, 0, 1, 1]) }).tiers).toEqual([D, 0, 0, D]);
});
test('graduated rapid focus changes clear by touched lists and leave no stale bytes', () => {
  const g = graph(6, [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 0]]), state = new Uint8Array(24), edge = new Uint8Array(6);
  let last = { nodes: [] as number[], edges: [] as number[] };
  for (const f of [0, 3, 0, -1, 4, 4, 1]) {
    for (const i of last.nodes) state[i * 4 + 1] = 0; for (const e of last.edges) edge[e] = 0;
    const r = run(g, f, { state, edge }), fresh = run(g, f);
    expect([...state]).toEqual([...fresh.state]); expect([...edge]).toEqual(fresh.edge); expect(r.nodes.length).toBeLessThanOrEqual(5); last = r;
  }
});
test('graduated dense hub: hop 1 complete, hop 2 bounded by scanned entries, deterministic and reported', () => {
  const pairs: Pair[] = [], hub = 400, leaves = 300; let id = hub + 1;
  for (let i = 1; i <= hub; i++) { pairs.push([0, i]); for (let k = 0; k < leaves; k++) pairs.push([i, id++]); }
  const g = graph(id, pairs), started = performance.now(), r = run(g, 0), ms = performance.now() - started;
  expect(r.partial).toBe(1); expect(r.tiers.slice(1, hub + 1).every(v => v === D)).toBe(true);
  const context = r.tiers.filter(v => v === C).length; expect(context).toBeGreaterThan(0); expect(context).toBeLessThanOrEqual(65536);
  expect(r.edges.length).toBeLessThanOrEqual(hub + 65536); expect(run(g, 0)).toEqual(r);
  const exact = run(g, 0, { max: hub * (leaves + 1) }); expect(exact.partial).toBe(0); expect(exact.tiers.filter(v => v === C).length).toBe(hub * leaves);
  expect(run(graph(3, [[0, 1], [1, 2]]), 0, { max: 1 }).partial).toBe(1);
  measurements.push({ case: 'hub 400 x 300 leaves', entries: g.inc.edges.length, contextNodes: context, touchedEdges: r.edges.length, milliseconds: ms });
});

// Shader equations from the production source, evaluated as scalar expressions.
const source = readFileSync(new URL('../src/webgl-renderer.ts', import.meta.url), 'utf8');
const shader = (name: string) => source.match(new RegExp('const ' + name + ' = (?:common \\+ )?glsl`([\\s\\S]*?)`;'))![1]!;
const mix = (a: number, b: number, t: number) => a * (1 - t) + b * t, min = Math.min;
const expr = (text: string) => new Function('s', `with (s) { return (${text.replace(/(\d)u\b/g, '$1')}); }`) as (s: any) => number;
const nodeAlpha = expr(shader('nodeVertex').match(/tint = vec4\(c\.rgb, (.*)\);/)![1]!);
const edgeFocus = expr(shader('edgeVertex').match(/if \(focus > 0\.\) alpha = ([^;]+);/)![1]!);
const labelFocus = expr(shader('labelVertex').match(/\s(?:if \(focus > 0\.\) )?alpha = ((?:mix|st)[^;]+);/)![1]!);
const oldEdge = expr(before.edge.match(/if \(focus > 0\.\) alpha = ([^;]+);/)![1]!);
const grow = expr(shader('nodeVertex').match(/radius \*= ([^;]+);/)![1]!);
const ring = expr(shader('nodeVertex').match(/ring = ([^;]+);/)![1]!);
const edgeWide = expr(shader('edgeVertex').match(/float wide = ([^;]+);/)![1]!);
test('graduated emphasis ordering from actual node, edge and label shader expressions', () => {
  for (const dim of [0, .12, .5]) for (const focus of [.25, 1]) for (const alpha of [.00001, .05, .4, 1]) {
    const scope = { mix, min, max: Math.max, dim, focus, alpha, k: 1, c: { a: 1 } };
    const node = (g: number, hot = false) => nodeAlpha({ ...scope, hot, st: { g } }), edge = (tier: number) => edgeFocus({ ...scope, tier }), label = (g: number) => labelFocus({ ...scope, st: { g }, id: 9, focusNode: 1 });
    const size = (g: number, ego = false) => grow({ ...scope, ego, st: { g } }), width = (tier: number) => edgeWide({ ...scope, edgeSize: 1, tier });
    // Progressive tiers: focus > direct > 2-hop > context in size, alpha and stroke.
    expect(size(1, true)).toBeGreaterThan(size(1)); expect(size(1)).toBeGreaterThan(size(C / 255)); expect(size(C / 255)).toBe(size(0)); expect(size(0)).toBe(1);
    expect(node(1, true)).toBeGreaterThanOrEqual(node(1)); expect(node(1)).toBeGreaterThan(node(C / 255) - 1e-12); expect(node(C / 255)).toBeGreaterThanOrEqual(node(0));
    if (dim < 1) expect(node(C / 255)).toBeGreaterThan(node(0));
    expect(edge(D)).toBeGreaterThanOrEqual(edge(C)); expect(edge(C)).toBeGreaterThanOrEqual(edge(0)); expect(edge(D)).toBeLessThanOrEqual(1);
    expect(width(D)).toBeCloseTo(1 + .6 * focus, 12); expect(width(C)).toBe(1); expect(width(0)).toBe(1);
    // Tiered atlas labels hand over to the graduated DOM labels; context labels go very faint.
    expect(label(1)).toBeCloseTo(alpha * (1 - focus), 12); expect(label(C / 255)).toBeCloseTo(alpha * (1 - focus), 12); expect(label(0)).toBeCloseTo(mix(alpha, alpha * dim * .5, focus), 12);
    if (dim < 1 && alpha < 1) { expect(edge(D)).toBeGreaterThan(edge(C)); expect(node(1)).toBeGreaterThan(node(0)); }
    // Direct and rest edges keep the reviewed one-hop equations exactly.
    expect(edge(D)).toBeCloseTo(oldEdge({ ...scope, s: 1, t: 2, focusNode: 1 }), 12); expect(edge(0)).toBeCloseTo(oldEdge({ ...scope, s: 1, t: 2, focusNode: 3 }), 12);
    expect(node(0)).toBeCloseTo(mix(1, dim, focus), 12); expect(node(1)).toBe(1);
    // Canvas uses the shared helpers; they equal the shader expressions term for term.
    for (const g of [0, C / 255, 1]) for (const ego of [false, true]) {
      const [a, z, r] = tierNode(g, ego, ego, focus, dim);
      expect(a).toBeCloseTo(node(g, ego), 12); expect(z).toBeCloseTo(size(g, ego), 12); expect(r).toBe(ring({ ego, focus }));
      expect(tierLabel(g, alpha, focus, dim)).toBeCloseTo(label(g), 12);
    }
    for (const tier of [0, C, D]) { const [a, w] = tierEdge(tier, alpha, focus, dim); expect(a).toBeCloseTo(edge(tier), 12); expect(w).toBeCloseTo(width(tier), 12); }
  }
  // At zero requested edge alpha every tier stays exactly zero: no hidden floor.
  for (const tier of [0, C, D]) { expect(edgeFocus({ mix, min, dim: .12, focus: 1, alpha: 0, tier })).toBe(0); expect(tierEdge(tier, 0, 1, .12)[0]).toBe(0); }
  // No focus means no change at all: alpha, size, ring, stroke width and labels are untouched.
  for (const g of [0, C / 255, 1]) {
    expect(nodeAlpha({ mix, min, dim: .12, focus: 0, k: 1, c: { a: .7 }, hot: false, st: { g } })).toBeCloseTo(.7, 12);
    expect(tierNode(g, false, true, 0, .12)).toEqual([1, 1, 0]); expect(tierLabel(g, .7, 0, .12)).toBe(.7); expect(tierEdge(g * 255, .3, 0, .12)).toEqual([.3, 1]);
  }
});

// Graduated labels: priority, budget and collision through the production placement.
const labelBox = (pos: Record<number, number>) => (node: number, rank: number) => ({ node, x: pos[node] ?? node * 100, y: 0, w: rank ? 40 : 60, h: 10 });
test('graduated labels rank focus > direct > 2-hop, then degree, under budget and collision', () => {
  // 0 focus; 1, 2 direct; 3, 4 2-hop. Node 2 has the higher degree.
  const g = graph(5, [[0, 1], [0, 2], [2, 3], [1, 4], [2, 4]]), r = run(g, 0), vis = new Uint8Array(5).fill(1);
  const place = (budget: number, pos: Record<number, number> = {}, cap = 99, v: ArrayLike<number> = vis) => focusLabels(0, r.nodes, r.state, v, g.inc.offsets, labelBox(pos), 50, budget, cap);
  expect(place(10)).toEqual([[0, 0], [2, 1], [1, 1], [4, 3], [3, 3]]);
  // Budget keeps the highest tiers first.
  expect(place(1)).toEqual([[0, 0]]); expect(place(3)).toEqual([[0, 0], [2, 1], [1, 1]]);
  // Collision: a 2-hop label overlapping the focus loses; a direct label overlapping a 2-hop one wins.
  expect(place(10, { 3: 10 })).toEqual([[0, 0], [2, 1], [1, 1], [4, 3]]);
  expect(place(10, { 1: 400, 4: 410 })).toEqual([[0, 0], [2, 1], [1, 1], [3, 3]]);
  // Candidate cap and filter visibility bound the work; no focus or no cloud places nothing.
  expect(place(10, {}, 2)).toEqual([[0, 0], [2, 1]]);
  expect(place(10, {}, 99, new Uint8Array([1, 0, 1, 1, 1]))).toEqual([[0, 0], [2, 1], [4, 3], [3, 3]]);
  expect(focusLabels(-1, [], r.state, vis, g.inc.offsets, labelBox({}), 50, 10, 99)).toEqual([]);
  // Deterministic and pure: same inputs, same placement, no tier byte written.
  const bytes = [...r.state]; expect(place(10)).toEqual(place(10)); expect([...r.state]).toEqual(bytes);
});
test('graduated tiers in Nodes display: relationship-note dots from a real projection are transparent hops', async () => {
  const { buildProjection } = await import('../src/core/projection');
  const { defaultDeclaration } = await import('../src/core/declaration');
  const d = defaultDeclaration('links'); d.edges = [{ kind: 'reified', name: 'crosswalk', sourceProperty: 'from', targetProperty: 'to' }];
  const rows = [{ path: 'a.md', properties: {} }, { path: 'b.md', properties: {} }, { path: 'c.md', properties: {} }, { path: 'x.md', properties: { from: 'a.md', to: 'b.md' } }, { path: 'y.md', properties: { from: 'b.md', to: 'c.md' } }];
  for (const reifiedAsNodes of [false, true]) {
    const p = buildProjection(rows, { ...d, display: { reifiedAsNodes } }), n = p.paths.length, m = p.source.length;
    const g = { n, m, p, inc: incidentEdges({ nodeCount: n, source: p.source, target: p.target }) }, at = (path: string) => p.paths.indexOf(path);
    const r = run(g as unknown as G, at('a.md'));
    expect(n).toBe(reifiedAsNodes ? 5 : 3);
    // a to b is direct in both displays (the dot x is transparent); c is two hops away.
    expect([r.tiers[at('a.md')], r.tiers[at('b.md')], r.tiers[at('c.md')]]).toEqual([D, D, C]);
    if (reifiedAsNodes) expect(r.tiers[at('x.md')]).toBe(D);
  }
});
