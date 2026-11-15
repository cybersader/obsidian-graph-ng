import { test, expect } from 'bun:test';
import { discloseTiers, overlapsBox } from '../src/hub-disclosure';
import { focusTiers, incidentEdges } from '../src/render-data';

// Synthetic graph (ported from the tournament's entry C). Node 9 is a relationship-note dot owned by
// row 8 that joins focus 0 to note 10. Sections are plain node sets: the card's declared groups.
const rows = [[0, 1], [0, 2], [3, 0], [0, 4], [0, 1], [1, 5], [5, 6], [2, 1], [0, 9], [9, 10], [7, 7], [4, 8]], n = 11;
const p = { nodeCount: n, source: Uint32Array.from(rows, r => r[0]!), target: Uint32Array.from(rows, r => r[1]!), type: new Uint32Array(rows.length), types: ['cites'], carrier: Uint32Array.from(rows, (_, i) => i === 8 || i === 9 ? 8 : 0xffffffff), carrierNodes: new Uint32Array(n) };
p.carrierNodes[9] = 9;
const inc = incidentEdges(p), all = new Uint8Array(n).fill(1), on = new Uint8Array(rows.length).fill(1);
const show = (direct: number[], second: number[] = []) => {
  const state = new Uint8Array(n * 4), tiers = new Uint8Array(rows.length), near: number[] = [], edges: number[] = [];
  focusTiers(0, inc, p, on, all, state, tiers, near, edges);
  discloseTiers(0, new Set(direct), new Set(second), p, inc, state, tiers, near, edges);
  return { lit: near.filter(i => state[i * 4 + 1]).sort((a, b) => a - b), state, tiers };
};

test('an open section lights only its notes; an owned carrier joins the focus to them', () => {
  // Carrier 9 joins focus 0 to note 10; it is not a counted connection.
  expect(show([1, 10]).lit).toEqual([0, 1, 9, 10]);
  expect(show([2]).lit).toEqual([0, 2]);
  // Every other connection and its edges go dark; the focus edge to an open note stays direct.
  const one = show([2]); expect(one.state[1 * 4 + 1]).toBe(0); expect(one.tiers[0]).toBe(0); expect(one.tiers[1]).toBeGreaterThan(200);
  // Two open sections light their union.
  expect(show([2, 3, 4]).lit).toEqual([0, 2, 3, 4]);
});
test('neighbours of neighbours are explicit and scoped to the sections that ask for them', () => {
  const second = show([1, 10], [1, 10]); expect(second.lit).toEqual([0, 1, 2, 5, 9, 10]);
  // Note 2 is reached from 1 only as context (128); note 8 hangs off a closed section and stays dark.
  expect(second.state[2 * 4 + 1]).toBe(128); expect(second.tiers[1]).toBe(128); expect(second.state[8 * 4 + 1]).toBe(0);
  expect(show([3, 4], [3, 4]).lit).toEqual([0, 3, 4, 8]);
  // Only the sections in `second` grow: 4 asks, 1 does not.
  expect(show([1, 4], [4]).lit).toEqual([0, 1, 4, 8]);
  // A second-hop request outside the open sections is ignored.
  expect(show([2], [1]).lit).toEqual([0, 2]);
});
test('label collision reserves full text bounds, even when the anchor lies outside an overlay', () => {
  const box = [8, 8, 200, 80];
  expect(overlapsBox(1, 40, 100, 20, box)).toBe(true);
  expect(overlapsBox(100, 1, 80, 20, box)).toBe(true);
  expect(overlapsBox(210, 40, 80, 20, box)).toBe(false);
  expect(overlapsBox(1, 1, 2, 2, box)).toBe(false);
  expect(overlapsBox(1, 1, 50, 50, [0, 0, 0, 0])).toBe(false);
});
