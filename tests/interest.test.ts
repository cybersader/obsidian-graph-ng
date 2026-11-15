import { test, expect } from 'bun:test';
import { interestScorer, byInterest, apriori, WEIGHTS } from '../src/interest';
import { rankFocus } from '../src/render-labels';
import { lensConnections } from '../src/lens-layout';
import { connectionGroups } from '../src/connection-card';
import { incidentEdges } from '../src/render-data';
import { encodeStrings, declaredKeys } from '../src/core/columns';
import { defaultDeclaration, digest, layoutDeclaration, migrateDeclaration, type GraphDeclaration } from '../src/core/declaration';
import { buildProjection, interestColumn, type FactRow } from '../src/core/projection';
import type { RenderProjection } from '../src/render-projection';

// Degree of interest. Deterministic CPU tests on synthetic graphs only.
// CSR offsets from a degree list.
const csr = (degrees: number[]) => { const o = new Uint32Array(degrees.length + 1); degrees.forEach((d, i) => { o[i + 1] = o[i]! + d; }); return o; };
const order = (nodes: number[], score: ReturnType<typeof interestScorer>, tie?: (a: number, b: number) => number) => [...nodes].sort(byInterest(score, tie));

test('scoring: rare beats hub, visited notes rise, declared interest counts, hop distance dominates', () => {
  // Focus 0; 1 is a hub (degree 500), 2 rare (degree 1), 3 medium (degree 20).
  const offsets = csr([3, 500, 1, 20, 1]);
  expect(apriori(0)).toBe(1); expect(apriori(1)).toBeGreaterThan(apriori(500));
  const plain = interestScorer(0, { offsets });
  expect(order([1, 2, 3], plain)).toEqual([2, 3, 1]);
  // The most recent visit gets the full boost; the hub, just visited, overtakes the rare note.
  const visited = interestScorer(0, { offsets, trail: [3, 1, 0] });
  expect(order([1, 2, 3], visited)).toEqual([1, 3, 2]);
  expect(visited(1) - plain(1)).toBeCloseTo(WEIGHTS.user * 2 / 3, 6);
  expect(visited(0, 0)).toBe(plain(0, 0)); // the focus itself gets no visit bonus
  // Declared interest (already rank-normalised to 0..1); NaN and out-of-range values are ignored.
  const declared = interestScorer(0, { offsets, declared: Float32Array.from([NaN, 1, NaN, .5, 7]) });
  expect(order([1, 2, 3], declared)).toEqual([1, 3, 2]);
  expect(declared(4)).toBe(plain(4));
  // Every other term together never lifts a 2-hop note above a direct one.
  const max = interestScorer(0, { offsets, trail: [4], declared: Float32Array.from([0, 0, 0, 0, 1]), groups: [0, 0, 0, 0, 1], bridges: true });
  expect(max(4, 2)).toBeLessThan(max(1, 1));
});

test('bridges first: on by setting, up-weights other groups, needs a grouping, off restores the plain order', () => {
  // Focus 0 in group 7. 1 and 2 share the group; 3 is in group 9 with a higher degree.
  const offsets = csr([3, 4, 4, 30]), groups = Uint32Array.from([7, 7, 7, 9]);
  expect(order([1, 2, 3], interestScorer(0, { offsets, groups, bridges: true }))).toEqual([3, 1, 2]);
  expect(order([1, 2, 3], interestScorer(0, { offsets, groups, bridges: false }))).toEqual([1, 2, 3]);
  expect(order([1, 2, 3], interestScorer(0, { offsets, bridges: true }))).toEqual([1, 2, 3]);
  const on = interestScorer(0, { offsets, groups, bridges: true }), off = interestScorer(0, { offsets, groups });
  expect(on(3) - off(3)).toBe(WEIGHTS.bridge); expect(on(1)).toBe(off(1));
});

test('ordering is stable: the same set sorts the same whatever the input order; ties fall to the tie-break, then id', () => {
  const offsets = csr(Array.from({ length: 40 }, (_, i) => i % 5)), groups = Array.from({ length: 40 }, (_, i) => i % 3);
  const score = interestScorer(0, { offsets, groups, bridges: true, trail: [7, 11] }), nodes = Array.from({ length: 39 }, (_, i) => i + 1);
  const want = order(nodes, score);
  for (let seed = 1; seed < 6; seed++) {
    const shuffled = [...nodes].sort((a, b) => ((a * 7919 * seed) % 101) - ((b * 7919 * seed) % 101));
    expect(order(shuffled, score)).toEqual(want);
  }
  // Equal scores: name tie-break first, then the lower id.
  const flat = interestScorer(0, { offsets: csr([2, 1, 1, 1]) }), names = ['f', 'b', 'a', 'b'];
  expect(order([3, 1, 2], flat, (a, b) => names[a]!.localeCompare(names[b]!))).toEqual([2, 1, 3]);
  // Memoised: repeated calls return identical numbers.
  expect(score(5)).toBe(score(5));
});

test('wiring: label slots, card rows within a group and lens rings within a type follow the score', () => {
  // Focus 0 with direct connections 1..3 (state 255) and a 2-hop note 4 (state 128).
  const state = new Uint8Array(5 * 4); [1, 2, 3].forEach(n => { state[n * 4 + 1] = 255; }); state[4 * 4 + 1] = 128;
  const offsets = csr([3, 9, 2, 5, 1]), vis = new Uint8Array(5).fill(1), score = interestScorer(0, { offsets });
  expect(rankFocus(0, [4, 3, 2, 1, 0], state, vis, offsets, 10).list.map(x => x[0])).toEqual([0, 1, 3, 2, 4]);
  expect(rankFocus(0, [4, 3, 2, 1, 0], state, vis, offsets, 10, undefined, score).list.map(x => x[0])).toEqual([0, 2, 3, 1, 4]);
  // Lens and card: one relationship type, three neighbours; the hub 1 drops to last.
  const pairs = [[0, 1], [0, 2], [0, 3], [1, 4]], names = ['F', 'A', 'B', 'C', 'D'];
  const p: RenderProjection = { nodeCount: 5, paths: encodeStrings(names), offsets, source: Uint32Array.from(pairs, e => e[0]!), target: Uint32Array.from(pairs, e => e[1]!), type: new Uint32Array(4), types: ['maps'], carrier: new Uint32Array(4).fill(0xffffffff), carrierNodes: new Uint32Array(5), groups: [], quarantined: [] };
  const inc = incidentEdges(p), on = new Uint8Array(4).fill(1);
  expect(lensConnections(0, p, inc, on, vis, vis, n => names[n]!).map(c => c.node)).toEqual([1, 2, 3]);
  expect(lensConnections(0, p, inc, on, vis, vis, n => names[n]!, score).map(c => c.node)).toEqual([2, 3, 1]);
  expect(connectionGroups(0, inc, p, () => true, vis, byInterest(score)).groups[0]!.nodes).toEqual([2, 3, 1]);
});

test('declared interest: validated, optional, ingested, rank-normalised and out of layout identity', async () => {
  const base = defaultDeclaration('p@1'), bound: GraphDeclaration = { ...base, interest: { property: 'weight' } };
  expect(migrateDeclaration(bound)).toEqual(bound);
  for (const bad of [{ interest: {} }, { interest: { property: '' } }, { interest: { property: ' ' } }, { interest: 'weight' }, { interest: ['weight'] }, { interest: { property: 'w', scale: 2 } }, { interest: { property: 3 } }])
    expect(() => migrateDeclaration({ ...base, ...bad })).toThrow();
  expect(declaredKeys(bound)).toContain('weight'); expect(declaredKeys(base)).not.toContain('weight');
  // Presentation only: never reseeds or relayouts; absent keeps the historical digest bytes.
  expect(await digest(layoutDeclaration(bound))).toBe(await digest(layoutDeclaration(base)));
  expect(await digest(layoutDeclaration(base))).toBe(await digest({ ...base, colors: [] }));
  // Finite numbers only (exact type, like filters): strings, booleans, lists, NaN and missing are not declared.
  const col = interestColumn([5, 'high', 1, 5, true, null, [1], undefined, Infinity, 100]);
  expect([...col].map(x => Number.isNaN(x) ? 'none' : +x.toFixed(4))).toEqual([.5, 'none', 0, .5, 'none', 'none', 'none', 'none', 'none', 1]);
  expect([...interestColumn([42])]).toEqual([1]); expect([...interestColumn([])]).toEqual([]);
  const rows: FactRow[] = [{ path: 'a.md', properties: { weight: 3 } }, { path: 'b.md', properties: { weight: 'x' } }, { path: 'c.md', properties: { weight: 9 } }];
  const p = buildProjection(rows, bound);
  expect([...p.interest!].map(x => Number.isNaN(x) ? 'none' : x)).toEqual([0, 'none', 1]);
  expect(buildProjection(rows, base).interest).toBeUndefined();
});
