import { test, expect } from 'bun:test';
import { findPath, alternatePath, hopRows, pathNotes, OUTCOME, MAX_HOPS, type Hop } from '../src/path-finder';
import { actions, type RendererControls } from '../src/interaction';
import { incidentEdges } from '../src/render-data';

const NONE = 0xffffffff;
/** Synthetic columns: rows are [source, target, type, carrier row or NONE]; `dots` lists relationship-note dots and their row. */
function graph(n: number, rows: [number, number, number?, number?][], dots: [number, number][] = []) {
  const p = { nodeCount: n, source: Uint32Array.from(rows, r => r[0]), target: Uint32Array.from(rows, r => r[1]), type: Uint32Array.from(rows, r => r[2] ?? 0), types: ['cites', 'part of'], carrier: Uint32Array.from(rows, r => r[3] ?? NONE), carrierNodes: new Uint32Array(n) };
  for (const [node, row] of dots) p.carrierNodes[node] = row + 1;
  return { p, inc: incidentEdges(p), on: new Uint8Array(rows.length).fill(1), vis: new Uint8Array(n).fill(1) };
}
const chain = (n: number) => graph(n, Array.from({ length: n - 1 }, (_, i) => [i, i + 1] as [number, number]));
const hopsOf = (r: ReturnType<typeof findPath>) => { if (!('hops' in r)) throw new Error('no path: ' + r.reason); return r.hops; };
/** Every hop's rows really join its notes, consecutive hops chain, and no note repeats. */
function valid(hops: Hop[], g: ReturnType<typeof graph>, from: number, to: number) {
  expect(hops[0]!.from).toBe(from); expect(hops.at(-1)!.to).toBe(to);
  hops.forEach((h, i) => {
    if (i) expect(h.from).toBe(hops[i - 1]!.to);
    const ends = h.edges.flatMap(e => [g.p.source[e]!, g.p.target[e]!]);
    expect(ends).toContain(h.from); expect(ends).toContain(h.to);
    for (const e of h.edges) expect(g.on[e]).toBe(1);
  });
  const notes = pathNotes(hops); expect(new Set(notes).size).toBe(notes.length);
}

test('shortest path: picks the shorter of two routes, either row direction, from both ends', () => {
  // 0-1-2-3-4 (4 steps) and 0-5-4 via a reversed row (2 steps).
  const g = graph(6, [[0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [4, 5]]);
  const hops = hopsOf(findPath(0, 4, g.inc, g.p, g.on, g.vis));
  expect(pathNotes(hops)).toEqual([0, 5, 4]); valid(hops, g, 0, 4);
  expect(pathNotes(hopsOf(findPath(4, 0, g.inc, g.p, g.on, g.vis)))).toEqual([4, 5, 0]);
  // Same note, or a hidden endpoint, has no path.
  expect(findPath(2, 2, g.inc, g.p, g.on, g.vis)).toEqual({ reason: 'none' });
});

test('bidirectional search matches a plain BFS distance on random graphs', () => {
  let seed = 7; const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let trial = 0; trial < 40; trial++) {
    const n = 30, rows: [number, number][] = [];
    for (let i = 0; i < 40; i++) rows.push([Math.floor(rand() * n), Math.floor(rand() * n)]);
    const g = graph(n, rows), from = Math.floor(rand() * n), to = Math.floor(rand() * n);
    const dist = new Map([[from, 0]]), queue = [from];
    for (const u of queue) for (let j = g.inc.offsets[u]!; j < g.inc.offsets[u + 1]!; j++) { const e = g.inc.edges[j]!, v = g.p.source[e] === u ? g.p.target[e]! : g.p.source[e]!; if (!dist.has(v)) { dist.set(v, dist.get(u)! + 1); queue.push(v); } }
    const r = findPath(from, to, g.inc, g.p, g.on, g.vis), d = dist.get(to);
    if (from === to || d === undefined || d > MAX_HOPS) expect(r).toEqual({ reason: 'none' });
    else { const hops = hopsOf(r); expect(hops.length).toBe(d); valid(hops, g, from, to); }
  }
});

test('limits: at most six steps, and a spent scan budget reports the limit instead of a partial answer', () => {
  expect(hopsOf(findPath(0, 6, chain(7).inc, chain(7).p, chain(7).on, chain(7).vis)).length).toBe(6);
  const long = chain(8);
  expect(findPath(0, 7, long.inc, long.p, long.on, long.vis)).toEqual({ reason: 'none' });
  expect(findPath(0, 3, long.inc, long.p, long.on, long.vis, { hops: 2 })).toEqual({ reason: 'none' });
  // A hub with many leaves exhausts a small budget before reaching the far side.
  const star = graph(52, [...Array.from({ length: 50 }, (_, i) => [0, i + 1] as [number, number]), [50, 51]]);
  expect(findPath(0, 51, star.inc, star.p, star.on, star.vis, { scan: 20 })).toEqual({ reason: 'limit' });
  expect(hopsOf(findPath(0, 51, star.inc, star.p, star.on, star.vis)).length).toBe(2);
  expect(OUTCOME).toEqual({ none: 'No path within 6 steps', limit: 'Search limit reached' });
});

test('filtered-out notes and hidden relationship types are never crossed', () => {
  const g = graph(6, [[0, 1], [1, 2], [0, 3, 1], [3, 4, 1], [4, 2, 1], [0, 5], [5, 2]]);
  expect(pathNotes(hopsOf(findPath(0, 2, g.inc, g.p, g.on, g.vis))).length).toBe(3);
  g.vis[1] = 0; g.vis[5] = 0;
  expect(pathNotes(hopsOf(findPath(0, 2, g.inc, g.p, g.on, g.vis)))).toEqual([0, 3, 4, 2]);
  g.on.forEach((_, e) => { if (g.p.type[e] === 1) g.on[e] = 0; });
  expect(findPath(0, 2, g.inc, g.p, g.on, g.vis)).toEqual({ reason: 'none' });
  // A filtered endpoint has no path.
  g.vis[0] = 0; expect(findPath(0, 2, g.inc, g.p, g.on, g.vis)).toEqual({ reason: 'none' });
});

test('relationship-note dots are transparent: one step through the dot, never a step of their own', () => {
  // 0 -> dot 3 -> 1 is one reified relationship (rows 0 and 1); row 2 links the dot to 2 as an ordinary link.
  const g = graph(4, [[0, 3, 1, 0], [3, 1, 1, 0], [3, 2]], [[3, 0]]);
  const hops = hopsOf(findPath(0, 1, g.inc, g.p, g.on, g.vis));
  expect(hops).toEqual([{ from: 0, to: 1, edges: [0, 1], carrier: 3 }]);
  expect(pathNotes(hops)).toEqual([0, 1]);
  // Walked backwards the rows reverse and the type reads "(reverse)" in the card.
  const back = hopsOf(findPath(1, 0, g.inc, g.p, g.on, g.vis));
  expect(back).toEqual([{ from: 1, to: 0, edges: [1, 0], carrier: 3 }]);
  expect(hopRows(back, g.p)).toEqual([{ step: 1, from: 1, to: 0, type: 'part of', reverse: true, carrier: 3 }]);
  // The dot is not a stepping stone for unrelated links.
  expect(findPath(0, 2, g.inc, g.p, g.on, g.vis)).toEqual({ reason: 'none' });
  // A hidden dot hides its relationship.
  g.vis[3] = 0; expect(findPath(0, 1, g.inc, g.p, g.on, g.vis)).toEqual({ reason: 'none' });
});

test('another path: up to three node-disjoint alternates, then none', () => {
  // Routes 0 -> 9: via 1, via 7, via 2-3, via 4-5-6, and 0-2-1-9, which shares note 1.
  const g = graph(10, [[0, 1], [1, 9], [0, 2], [2, 3], [3, 9], [0, 4], [4, 5], [5, 6], [6, 9], [0, 7], [7, 9], [2, 1]]);
  const found: Hop[][] = [hopsOf(findPath(0, 9, g.inc, g.p, g.on, g.vis))];
  for (let i = 0; i < 3; i++) { const r = alternatePath(0, 9, g.inc, g.p, g.on, g.vis, found); found.push(hopsOf(r)); }
  expect(found.map(h => h.length)).toEqual([2, 2, 3, 4]);
  const inner = found.flatMap(h => pathNotes(h).slice(1, -1)); expect(new Set(inner).size).toBe(inner.length);
  for (const h of found) valid(h, g, 0, 9);
  expect(alternatePath(0, 9, g.inc, g.p, g.on, g.vis, found)).toEqual({ reason: 'none' });
  // A direct relationship has no inner notes; its row is used, so a parallel row of another type is the alternate.
  const d = graph(2, [[0, 1, 0], [1, 0, 1]]), first = hopsOf(findPath(0, 1, d.inc, d.p, d.on, d.vis));
  expect(hopRows(hopsOf(alternatePath(0, 1, d.inc, d.p, d.on, d.vis, [first])), d.p)).toEqual([{ step: 1, from: 0, to: 1, type: 'part of', reverse: true, carrier: -1 }]);
});

test('hop list model: note, relationship type, next note, numbered from 1', () => {
  const g = graph(4, [[0, 1, 0], [2, 1, 1], [2, 3, 0]]), hops = hopsOf(findPath(0, 3, g.inc, g.p, g.on, g.vis));
  expect(hopRows(hops, g.p)).toEqual([
    { step: 1, from: 0, to: 1, type: 'cites', reverse: false, carrier: -1 },
    { step: 2, from: 1, to: 2, type: 'part of', reverse: true, carrier: -1 },
    { step: 3, from: 2, to: 3, type: 'cites', reverse: false, carrier: -1 },
  ]);
  expect(pathNotes(hops)).toEqual([0, 1, 2, 3]); expect(pathNotes([])).toEqual([]);
});

test('"Find path to…" is a menu action from the selection to the clicked note', () => {
  const calls: number[][] = [], host = { selected: 2, findPath: (a: number, b: number) => calls.push([a, b]) } as unknown as RendererControls;
  const action = actions.menu({ host, node: 5 }).find(a => a.id === 'find-path')!;
  expect(action.label).toBe('Find path to…'); action.run({ host, node: 5 }); expect(calls).toEqual([[2, 5]]);
  expect(actions.menu({ host, node: 2 }).some(a => a.id === 'find-path')).toBe(false);
  expect(actions.menu({ host: { ...host, selected: -1 } as RendererControls, node: 5 }).some(a => a.id === 'find-path')).toBe(false);
});
