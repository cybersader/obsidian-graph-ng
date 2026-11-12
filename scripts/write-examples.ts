import { mkdir, writeFile } from 'node:fs/promises';
import { exampleDeclaration } from './fixture';
import { defaults } from '../src/settings';
import { validateDeclaration } from '../src/core/declaration';
import { validateGroupProjection } from '../src/core/group-projection';
await mkdir('examples', { recursive: true });
const declaration = { ...exampleDeclaration, carrierResolvers: [...exampleDeclaration.carrierResolvers!, { kind: 'mapping-id', key: 'id' }] };
const facts = [
  { path: 'Concepts/Alpha.md', properties: { id: 'concept:alpha:1', family: 'Family 1' } },
  { path: 'Concepts/Beta.md', properties: { id: 'concept:beta:1', family: 'Family 2' } },
  { path: 'Mappings/Example.md', properties: { id: 'mapping:1', subject_id: 'concept:alpha:1', object_id: 'concept:beta:1', predicate: 'aligns' } },
];
const aggregate = {
  schema: 'graph-projection-v0', producer: { name: 'synthetic', projection: 'example', asOf: '2026-11-10' },
  groups: [{ id: 'a', label: 'Family 1', count: 1, identityPrefix: 'concept:alpha:' }, { id: 'b', label: 'Family 2', count: 1, identityPrefix: 'concept:beta:' }],
  groupEdges: [{ a: 'a', b: 'b', total: 1, typeCounts: { aligns: 1 }, directional: { aToB: { aligns: 1 }, bToA: {} }, carriers: { kind: 'mapping-id', ids: ['mapping:1'] } }],
  coverage: { source: 'synthetic example' },
};
validateDeclaration(declaration); validateGroupProjection(aggregate);
for (const [name, value] of Object.entries({ 'default-declaration': defaults('obsidian-links@1.13.7').declaration, 'default-settings': defaults('obsidian-links@1.13.7'), 'concept-mapping-declaration': declaration, facts, 'graph-projection-v0': aggregate })) {
  await writeFile(`examples/${name}.json`, JSON.stringify(value, null, 2) + '\n');
}
