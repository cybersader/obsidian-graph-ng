import { readFile, writeFile } from 'node:fs/promises';
import { buildProjection, filterNodes } from '../src/core/projection';
import { contractGroups } from '../src/core/group-projection';
import { migrateDeclaration } from '../src/core/declaration';
import { generationKey } from '../src/core/generation';
import { runLayout, DEFAULT_LAYOUT } from '../src/core/layout';
const [factsPath, declarationPath, destination] = process.argv.slice(2);
if (!factsPath || !declarationPath || !destination) throw new Error('Usage: bun scripts/project.ts facts.json declaration.json output.json');
const facts = JSON.parse(await readFile(factsPath, 'utf8')), declaration = migrateDeclaration(JSON.parse(await readFile(declarationPath, 'utf8')));
if (!Array.isArray(facts) || facts.some(r => !r || typeof r.path !== 'string' || !r.properties || typeof r.properties !== 'object')) throw new Error('Expected FactRow[] JSON');
const p = buildProjection(facts, declaration), hash = await generationKey(facts, declaration, DEFAULT_LAYOUT, 'graph-ng-fa2@1');
const positions = runLayout({ count: p.paths.length, source: p.source, target: p.target, seed: Number.parseInt(hash.slice(0, 8), 16) }, DEFAULT_LAYOUT);
const { projection: groups } = contractGroups(p, filterNodes(p));
await writeFile(destination, JSON.stringify({ schema: 'graph-ng.local-projection.v1', provenance: { label: 'your view', source: 'local', inputScope: 'one-view fact export supplied by caller' }, digest: hash, producer: 'graph-ng-fa2@1', declaration, quarantined: p.quarantined, paths: p.paths, identities: p.identities,
  edges: { source: [...p.source], target: [...p.target], type: [...p.type], types: p.types, carrier: [...p.carrier], carrierPaths: p.carrierPaths },
  csr: { offsets: [...p.offsets], targets: [...p.targets] }, positions: [...positions], groups }));
console.log(JSON.stringify({ nodes: p.paths.length, edges: p.source.length, destination }));
