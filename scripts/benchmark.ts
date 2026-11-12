import { writeFile, mkdir } from 'node:fs/promises';
import os from 'node:os';
import { fixture, exampleDeclaration } from './fixture';
import { buildProjection, filterNodes, colorGroups, storageBytes } from '../src/core/projection';
import { contractGroups } from '../src/core/group-projection';
import { digest } from '../src/core/declaration';
import { runLayout, DEFAULT_LAYOUT } from '../src/core/layout';
const rows = fixture(), results = [];
for (const literal of [false, true]) {
  const d = { ...exampleDeclaration, display: { reifiedAsNodes: literal } }, t = performance.now(), p = buildProjection(rows, d), buildMs = performance.now() - t;
  const samples: number[] = [];
  for (let i = 0; i < 20; i++) { const t = performance.now(); filterNodes(p, { kind: 'eq', key: 'family', value: 'Family 1' }); colorGroups(p, d); samples.push(performance.now() - t); }
  const t2 = performance.now(), groups = contractGroups(p, filterNodes(p)), groupsMs = performance.now() - t2;
  const hash = await digest({ rows, d, layout: DEFAULT_LAYOUT }), seed = Number.parseInt(hash.slice(0, 8), 16);
  const input = { count: p.paths.length, source: p.source, target: p.target, seed }, t3 = performance.now();
  const pos = runLayout(input, DEFAULT_LAYOUT), layoutMs = performance.now() - t3;
  const positionsHash = await digest([...pos]);
  const result = { literal, nodes: p.paths.length, edges: p.source.length, notes: rows.length, buildMs, groupsMs, groups: groups.projection.groups.length, pairs: groups.projection.groupEdges.length,
    filterAndColorP95Ms: samples.sort((a, b) => a - b)[18], filterRepetitions: 20, columnBytes: storageBytes(p), positionBytes: pos.byteLength,
    iterations: DEFAULT_LAYOUT.iterations, theta: DEFAULT_LAYOUT.force.barnesHutTheta, layoutMs, positionsHash, processMemory: process.memoryUsage() };
  results.push(result); console.log(JSON.stringify(result));
}
await mkdir('.workspace/evidence', { recursive: true });
await writeFile('.workspace/evidence/core-benchmark.json', JSON.stringify({ command: 'bun scripts/benchmark.ts', cpu: os.cpus()[0]?.model, ram: os.totalmem(), runtime: Bun.version, results }, null, 2));
