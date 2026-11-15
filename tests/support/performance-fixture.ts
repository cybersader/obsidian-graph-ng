import { defaultDeclaration } from '../../src/core/declaration';
import { random } from '../../src/core/layout';
import type { FactRow } from '../../src/core/projection';

/** Synthetic heavy-tail workload, not a copy of a vault. Hub 0 has exactly 591 distinct
 * neighbours; 13% of ordinary notes are isolated. Relationship endpoints cross 93 groups.
 * Target quantiles are approximate; the receipt reports the actual generated degrees. */
export function performanceFixture(literal: boolean, compact = false) {
  const ordinary = literal ? 16448 : compact ? 16309 : 16000, relationships = 44552, edgeCount = literal ? 100000 : compact ? 46400 : 55000;
  const pairs = edgeCount - (literal ? relationships : 0), active = Math.round(ordinary * .87), rng = random(73);
  const name = (i: number) => `Notes/Note-${String(i).padStart(5, '0')}.md`;
  const groups = new Uint32Array(ordinary);
  // Largest group 1468; 47 groups of 97; remaining groups absorb the remainder.
  let cursor = 0;
  for (let g = 0; g < 93; g++) {
    const size = g === 0 ? 1468 : g <= 47 ? 97 : Math.ceil((ordinary - cursor) / (93 - g));
    groups.fill(g, cursor, cursor + size); cursor += size;
  }
  // Shuffle membership without changing its size distribution.
  for (let i = ordinary - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)), a = groups[i]!; groups[i] = groups[j]!; groups[j] = a; }
  const rows: FactRow[] = Array.from({ length: ordinary }, (_, i) => ({ path: name(i), properties: { group: `Group-${groups[i]}`, score: i % 101, parent: i > 3 && i % 4 ? name(i % 4) : undefined }, links: { links: [] } }));
  const degree = new Uint32Array(ordinary), edges: [number, number][] = [], seen = new Set<number>();
  const add = (a: number, b: number) => {
    const key = Math.min(a, b) * ordinary + Math.max(a, b);
    if (a === b || groups[a] === groups[b] || seen.has(key)) return false;
    seen.add(key); edges.push([a, b]); degree[a]!++; degree[b]!++; return true;
  };
  for (let i = 1; degree[0]! < 591; i++) add(0, i);
  // One edge for every non-isolate, with remaining mass concentrated on higher-degree notes.
  for (let i = 1; i < active; i++) if (!degree[i]) { let b: number; do { b = 1 + Math.floor(rng() * Math.min(83, i || 1)); } while (degree[b]! >= 590 || !add(i, b)); }
  const pool: number[] = [];
  for (let i = 1; i < Math.floor(ordinary * .37); i++) {
    const weight = i < 84 ? 90 : i < ordinary * .01 ? 45 : i < ordinary * .1 ? 8 : 1;
    for (let k = 0; k < weight; k++) pool.push(i);
  }
  let attempts = 0;
  while (edges.length < pairs) {
    if (++attempts > pairs * 100) throw new Error('Synthetic edge budget exhausted');
    const a = pool[Math.floor(rng() * pool.length)]!, b = pool[Math.floor(rng() * pool.length)]!;
    const cap = (i: number) => i < 84 ? 590 : 69;
    if (degree[a]! < cap(a) && degree[b]! < cap(b)) add(a, b);
  }
  edges.forEach(([a, b], i) => {
    if (i < relationships) rows.push({ path: `Relations/Relation-${String(i).padStart(5, '0')}.md`, properties: { from: name(a), to: name(b), group: `Group-${groups[a]}`, score: i % 101 } });
    else rows[a]!.links!.links!.push(name(b));
  });
  const declaration = defaultDeclaration('links');
  declaration.edges = [{ kind: 'reified', name: 'relation', sourceProperty: 'from', targetProperty: 'to' }, { kind: 'producer', name: 'links', producer: 'links', type: 'link' }];
  declaration.groups = [{ from: 'key', key: 'group' }]; declaration.columns = ['group', 'score'];
  declaration.hierarchy = { parentProperty: 'parent' }; declaration.interest = { property: 'score' };
  declaration.display.reifiedAsNodes = literal;
  const sorted = Array.from(degree).sort((a, b) => a - b);
  return { rows, declaration, shape: { ordinary, relationships, groups: 93, largestGroup: 1468, medianGroup: 97, maxDegree: sorted.at(-1), p50: sorted[Math.floor(ordinary * .5)], p90: sorted[Math.floor(ordinary * .9)], p99: sorted[Math.floor(ordinary * .99)], above100: sorted.filter(d => d > 100).length, isolated: sorted.filter(d => !d).length, distinctSemanticEdges: edges.length } };
}
