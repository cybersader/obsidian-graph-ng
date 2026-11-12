import type { GraphDeclaration } from '../src/core/declaration';
import type { FactRow } from '../src/core/projection';
import { random } from '../src/core/layout';
export const exampleDeclaration: GraphDeclaration = {
  carrierResolvers: [{ kind: 'note-path', key: '$path' }],
  version: 2, identity: [{ key: 'id' }],
  edges: [{ name: 'mapping', kind: 'reified', sourceProperty: 'subject_id', targetProperty: 'object_id', typeProperty: 'predicate' }],
  groups: [{ from: 'key', key: 'family' }, { from: 'folder', depth: 1 }],
  display: { reifiedAsNodes: false }, columns: ['family'],
  colors: ['#56b4e9', '#e69f00', '#009e73', '#cc79a7', '#d5c85d', '#9caac2'].map((color, i) => ({ name: `Family ${i + 1}`, color, predicate: { kind: 'eq' as const, key: 'family', value: `Family ${i + 1}` } })),
};
export function fixture(concepts = 16000, mappings = 44600, seed = 17): FactRow[] {
  const rows: FactRow[] = [], rng = random(seed);
  for (let i = 0; i < concepts; i++) rows.push({ path: `Concepts/Family-${i % 6 + 1}/Concept-${String(i).padStart(6, '0')}.md`, properties: { id: `concept:${i}`, family: `Family ${i % 6 + 1}` } });
  for (let i = 0; i < mappings; i++) rows.push({ path: `Mappings/Mapping-${String(i).padStart(6, '0')}.md`, properties: { id: `mapping:${i}`, subject_id: `concept:${Math.floor(rng() * concepts)}`, object_id: `concept:${Math.floor(rng() * concepts)}`, predicate: i % 2 ? 'related' : 'aligns' } });
  return rows;
}
/**
 * Seeded synthetic corpus with community structure, shaped like a framework/mapping
 * crosswalk: six families split into uneven sections (communities). Most mappings stay
 * inside a section and concentrate on a few hub controls; a small share bridges sections,
 * mostly within the same family. Purely synthetic and deterministic for a seed.
 */
export function clusteredFixture(concepts = 16000, mappings = 44600, seed = 17, communities = 48, bridgeShare = .06): FactRow[] {
  const rows: FactRow[] = [], rng = random(seed);
  const weights = Array.from({ length: communities }, (_, i) => 1 / (1 + i) ** .8), total = weights.reduce((a, b) => a + b, 0);
  const starts: number[] = [], sizes: number[] = []; let at = 0;
  for (let c = 0; c < communities; c++) { const size = c === communities - 1 ? concepts - at : Math.max(12, Math.round(weights[c]! / total * concepts)); starts.push(at); sizes.push(size); at += size; }
  const family = (c: number) => c % 6 + 1, of = new Int32Array(concepts);
  for (let c = 0; c < communities; c++) of.fill(c, starts[c]!, starts[c]! + sizes[c]!);
  for (let i = 0; i < concepts; i++) { const c = of[i]!; rows.push({ path: `Concepts/Family-${family(c)}/Concept-${String(i).padStart(6, '0')}.md`, properties: { id: `concept:${i}`, family: `Family ${family(c)}`, section: `Section ${String(c).padStart(2, '0')}` } }); }
  // A squared draw concentrates links on each section's first members: a few hub controls.
  const member = (c: number) => starts[c]! + Math.floor(sizes[c]! * rng() ** 2);
  const peers = Array.from({ length: communities }, (_, c) => [Array.from({ length: communities }, (_, k) => k).filter(k => k !== c && family(k) === family(c)), Array.from({ length: communities }, (_, k) => k).filter(k => k !== c)] as const);
  for (let i = 0; i < mappings; i++) {
    const s = Math.floor(rng() * concepts), c = of[s]!;
    let t = s;
    if (rng() >= bridgeShare) t = member(c);
    else { const pool = peers[c]![rng() < .7 && peers[c]![0].length ? 0 : 1]; t = member(pool[Math.floor(rng() * pool.length)]!); }
    if (t === s) t = starts[c]! + (s - starts[c]! + 1) % sizes[c]!;
    rows.push({ path: `Mappings/Mapping-${String(i).padStart(6, '0')}.md`, properties: { id: `mapping:${i}`, subject_id: `concept:${s}`, object_id: `concept:${t}`, predicate: i % 2 ? 'related' : 'aligns' } });
  }
  return rows;
}
/** GRAPH_FIXTURE=clustered selects community structure; the default stays the historical uniform benchmark. */
export const fixtureShape = (env = process.env.GRAPH_FIXTURE) => env === 'clustered' ? 'clustered' as const : 'uniform' as const;
export const chooseFixture = (shape: 'clustered' | 'uniform') => shape === 'clustered' ? clusteredFixture : fixture;

/** Neutral expression-only fixture; historical benchmark fixtures remain unchanged. */
export function expressionFixture(concepts = 16000, mappings = 44600) {
  const rows = fixture(concepts, mappings).map(row => {
    const { family, ...properties } = row.properties;
    return { ...row, path: row.path.replace('Family-', 'Category-'), properties: family === undefined ? properties : { ...properties, category: String(family).replace('Family ', 'Category ') } };
  });
  const declaration: GraphDeclaration = { ...exampleDeclaration, columns: ['category'], groups: [{ from: 'key', key: 'category' }, { from: 'folder', depth: 1 }], colors: exampleDeclaration.colors.map((c, i) => ({ ...c, name: `Category ${i + 1}`, predicate: { kind: 'eq', key: 'category', value: `Category ${i + 1}` } })) };
  return { rows, declaration };
}
