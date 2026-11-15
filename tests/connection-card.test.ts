import { test, expect } from 'bun:test';
import { connectionGroups, reach, NavHistory, dockCard, SHEET_WIDTH } from '../src/connection-card';
import { incidentEdges } from '../src/render-data';

// Synthetic graph. Types: 0 'cites', 1 'part of'. Node 9 is a relationship-note dot owned by row 0
// (carrierNodes[9] = 1 = carrier row 0 + 1); its far endpoint 10 is a direct connection of 0.
const NONE = 0xffffffff;
const rows: [number, number, number, number][] = [
  [0, 1, 0, NONE], [0, 2, 0, NONE], [3, 0, 1, NONE], [0, 4, 1, NONE], [0, 1, 1, NONE], [1, 5, 0, NONE], [5, 6, 0, NONE], [2, 1, 0, NONE],
  [0, 9, 0, 0], [9, 10, 0, 0], [7, 7, 0, NONE], [4, 8, 0, NONE],
];
const n = 11;
function graph() {
  const p = { nodeCount: n, source: Uint32Array.from(rows, r => r[0]), target: Uint32Array.from(rows, r => r[1]), type: Uint32Array.from(rows, r => r[2]), types: ['cites', 'part of'], carrier: Uint32Array.from(rows, r => r[3]), carrierNodes: new Uint32Array(n) };
  p.carrierNodes[9] = 1;
  const inc = incidentEdges(p), degree = (i: number) => inc.offsets[i + 1]! - inc.offsets[i]!;
  return { p, inc, degree, order: (a: number, b: number) => degree(b) - degree(a) || a - b, all: new Uint8Array(n).fill(1), on: () => true };
}

test('connections group by type and direction; groups largest first, then type, outgoing first; rows by degree then name', () => {
  const g = graph(), { groups, direct } = connectionGroups(0, g.inc, g.p, g.on, g.all, g.order);
  expect(groups.map(x => [x.type, x.out, x.nodes])).toEqual([
    // 1 has degree 4 and 2 degree 2; the dot 9 is transparent, listing its far endpoint 10.
    ['cites', true, [1, 2, 10]],
    ['part of', true, [1, 4]],
    ['part of', false, [3]],
  ]);
  // Distinct notes: 1 appears in two groups but counts once; the dot itself is not a row.
  expect(direct).toBe(5);
  // Hidden types and filtered notes leave the list; a hidden or missing focus has none.
  const typed = connectionGroups(0, g.inc, g.p, e => g.p.type[e] === 0, g.all, g.order);
  expect(typed.groups.map(x => x.type)).toEqual(['cites']);
  const vis = g.all.slice(); vis[1] = 0; vis[10] = 0;
  const filtered = connectionGroups(0, g.inc, g.p, g.on, vis, g.order);
  expect(filtered.groups.map(x => [x.type, x.out, x.nodes])).toEqual([['cites', true, [2]], ['part of', true, [4]], ['part of', false, [3]]]); expect(filtered.direct).toBe(3);
  expect(connectionGroups(-1, g.inc, g.p, g.on, g.all, g.order)).toEqual({ groups: [], direct: 0 });
  vis[0] = 0; expect(connectionGroups(0, g.inc, g.p, g.on, vis, g.order).direct).toBe(0);
  // Self-loops never list the focus.
  expect(connectionGroups(7, g.inc, g.p, g.on, g.all, g.order)).toEqual({ groups: [], direct: 0 });
  // Ties sort by the supplied comparator (here: names), deterministically.
  const names = ['z', 'b', 'a', 'c', 'd', '', '', '', '', '', 'e'], byName = (a: number, b: number) => names[a]!.localeCompare(names[b]!);
  expect(connectionGroups(0, g.inc, g.p, g.on, g.all, byName).groups[0]!.nodes).toEqual([2, 1, 10]);
});

test('show only connections: focus plus direct connections, 2-hop adds neighbours of neighbours, dots kept', () => {
  const g = graph(), one = reach(0, g.inc, g.p, g.on, g.all, 1), two = reach(0, g.inc, g.p, g.on, g.all, 2);
  expect([...one.nodes].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 9, 10]);
  expect([one.direct, one.second, one.truncated]).toEqual([5, 0, false]);
  expect([...two.nodes].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 8, 9, 10]);
  expect([two.direct, two.second, two.truncated]).toEqual([5, 2, false]);
  // The host filter bounds the set; the 2-hop scan reports truncation instead of silently stopping.
  const vis = g.all.slice(); vis[4] = 0;
  expect([...reach(0, g.inc, g.p, g.on, vis, 2).nodes]).not.toContain(4);
  expect([...reach(0, g.inc, g.p, g.on, vis, 2).nodes]).not.toContain(8);
  expect(reach(0, g.inc, g.p, g.on, g.all, 2, 0).truncated).toBe(true);
  expect(reach(0, g.inc, g.p, g.on, new Uint8Array(n), 2).nodes.size).toBe(0);
});

test('navigation history: back, forward, a new visit drops the forward branch, repeats collapse, bounded', () => {
  const h = new NavHistory(4);
  for (const v of [1, 2, 3]) h.visit(v);
  expect(h.go(-1)).toBe(2); expect(h.go(-1)).toBe(1); expect(h.go(-1)).toBeUndefined(); expect(h.at).toBe(0);
  expect(h.go(1)).toBe(2); h.visit(7); expect(h.items).toEqual([1, 2, 7]); expect(h.go(1)).toBeUndefined();
  h.visit(7); expect(h.items).toEqual([1, 2, 7]);
  for (const v of [8, 9, 10]) h.visit(v);
  expect(h.items).toEqual([7, 8, 9, 10]); expect(h.at).toBe(3);
  h.clear(); expect(h.go(-1)).toBeUndefined(); expect(h.items).toEqual([]);
});

test('the card docks to the top-right edge (no note position involved); narrow views get a bottom sheet', () => {
  expect(dockCard(800, 600, 320, 200)).toEqual([472, 8, 320, 200]);
  // Wider than the view: pinned to the left margin, never off screen.
  expect(dockCard(600, 400, 700, 200)).toEqual([8, 8, 700, 200]);
  expect(dockCard(SHEET_WIDTH - 1, 600, 300, 240)).toEqual([0, 360, SHEET_WIDTH - 1, 240]);
});

test('history pruning preserves the current stop and both branches while dropping unavailable indices', () => {
  const h = new NavHistory(); for (const n of [0, 1, 2, 3, 4]) h.visit(n);
  h.go(-2); h.retain(n => n !== 1 && n !== 3);
  expect(h.items).toEqual([0, 2, 4]); expect(h.at).toBe(1); expect(h.go(-1)).toBe(0); expect(h.go(2)).toBe(4);
  h.retain(() => false); expect(h.items).toEqual([]); expect(h.at).toBe(-1);
});
