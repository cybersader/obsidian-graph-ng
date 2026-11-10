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
