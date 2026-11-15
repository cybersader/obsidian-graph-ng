import { test, expect, afterAll } from 'bun:test';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { focusTiers, incidentEdges } from '../src/render-data';
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
  expect(r.tiers).toEqual([D, D, C, 0, 0]); expect(r.edge).toEqual([D, C, 0, 0]); expect(r.partial).toBe(false);
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
  for (const r of [run(g, -1), run(g, 1, { vis: new Uint8Array([1, 0, 1]) })]) { expect(r.nodes).toEqual([]); expect(r.edges).toEqual([]); expect(r.partial).toBe(false); expect(r.tiers).toEqual([0, 0, 0]); }
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
  expect(r.partial).toBe(true); expect(r.tiers.slice(1, hub + 1).every(v => v === D)).toBe(true);
  const context = r.tiers.filter(v => v === C).length; expect(context).toBeGreaterThan(0); expect(context).toBeLessThanOrEqual(65536);
  expect(r.edges.length).toBeLessThanOrEqual(hub + 65536); expect(run(g, 0)).toEqual(r);
  const exact = run(g, 0, { max: hub * (leaves + 1) }); expect(exact.partial).toBe(false); expect(exact.tiers.filter(v => v === C).length).toBe(hub * leaves);
  expect(run(graph(3, [[0, 1], [1, 2]]), 0, { max: 1 }).partial).toBe(true);
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
test('graduated emphasis ordering from actual node, edge and label shader expressions', () => {
  for (const dim of [0, .12, .5]) for (const focus of [.25, 1]) for (const alpha of [.00001, .05, .4, 1]) {
    const scope = { mix, min, dim, focus, alpha, k: 1, c: { a: 1 } };
    const node = (g: number, hot = false) => nodeAlpha({ ...scope, hot, st: { g } }), edge = (tier: number) => edgeFocus({ ...scope, tier }), label = (g: number) => labelFocus({ ...scope, st: { g }, id: 9, focusNode: 1 });
    expect(node(1, true)).toBeGreaterThanOrEqual(node(1)); expect(node(1)).toBeGreaterThan(node(C / 255) - 1e-12); expect(node(C / 255)).toBeGreaterThanOrEqual(node(0));
    expect(edge(D)).toBeGreaterThanOrEqual(edge(C)); expect(edge(C)).toBeGreaterThanOrEqual(edge(0)); expect(edge(D)).toBeLessThanOrEqual(1);
    expect(label(1)).toBeGreaterThanOrEqual(label(C / 255)); expect(label(C / 255)).toBeGreaterThanOrEqual(label(0));
    if (dim < 1 && alpha < 1) { expect(edge(D)).toBeGreaterThan(edge(C)); expect(node(1)).toBeGreaterThan(node(0)); }
    // Direct and rest edges keep the reviewed one-hop equations exactly.
    expect(edge(D)).toBeCloseTo(oldEdge({ ...scope, s: 1, t: 2, focusNode: 1 }), 12); expect(edge(0)).toBeCloseTo(oldEdge({ ...scope, s: 1, t: 2, focusNode: 3 }), 12);
    expect(node(0)).toBeCloseTo(mix(1, dim, focus), 12); expect(node(1)).toBe(1);
  }
  // At zero requested edge alpha every tier stays exactly zero: no hidden floor.
  for (const tier of [0, C, D]) expect(edgeFocus({ mix, min, dim: .12, focus: 1, alpha: 0, tier })).toBe(0);
  // No focus means no change at all.
  for (const g of [0, C / 255, 1]) expect(nodeAlpha({ mix, min, dim: .12, focus: 0, k: 1, c: { a: .7 }, hot: false, st: { g } })).toBeCloseTo(.7, 12);
});
