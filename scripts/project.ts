import { readFile, writeFile } from 'node:fs/promises';
import { buildProjection, filterNodes } from '../src/core/projection';
import { contractGroups } from '../src/core/group-projection';
import { digest, validateDeclaration } from '../src/core/declaration';
import { runLayout, DEFAULT_LAYOUT } from '../src/core/layout';
const [factsPath, declarationPath, destination] = process.argv.slice(2);
if (!factsPath || !declarationPath || !destination) throw new Error('Usage: bun scripts/project.ts facts.json declaration.json output.json');
const facts = JSON.parse(await readFile(factsPath, 'utf8')), declaration: unknown = JSON.parse(await readFile(declarationPath, 'utf8'));
validateDeclaration(declaration);
if (!Array.isArray(facts) || facts.some(r => !r || typeof r.path !== 'string' || !r.properties || typeof r.properties !== 'object')) throw new Error('Expected FactRow[] JSON');
const p = buildProjection(facts, declaration), hash = await digest({ facts: [...facts].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0), declaration, params: DEFAULT_LAYOUT });
const positions = runLayout({ count: p.paths.length, source: p.source, target: p.target, seed: Number.parseInt(hash.slice(0, 8), 16) }, DEFAULT_LAYOUT);
const { projection: groups } = contractGroups(p, filterNodes(p));
await writeFile(destination, JSON.stringify({ schema: 'graph-ng.local-projection.v1', digest: hash, producer: 'graphology-fa2@0.10.1', declaration, paths: p.paths, identities: p.identities,
  edges: { source: [...p.source], target: [...p.target], type: [...p.type], types: p.types, carrier: [...p.carrier], carrierPaths: p.carrierPaths },
  csr: { offsets: [...p.offsets], targets: [...p.targets] }, positions: [...positions], groups }));
console.log(JSON.stringify({ nodes: p.paths.length, edges: p.source.length, destination }));
