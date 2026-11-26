import { test, expect } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { WorkerPipeline, LAYOUT_PRODUCER, type Transport, type ProjectResult, type LayoutResult } from '../src/pipeline';
import { BinaryLayoutStore, type BinaryGeneration } from '../src/core/binary-layout';
import { packRows } from '../src/core/columns';
import { defaults } from '../src/settings';
import type { FactRow } from '../src/core/projection';
import type { GraphDeclaration } from '../src/core/declaration';
import { performanceFixture } from './support/performance-fixture';
import { MemoryAdapter } from './support/memory-adapter';

/** Mirrors GraphView.refreshOnce's worker/store sequence without Obsidian or a renderer:
 * configure, saved-generation read unless the worker already holds it, ingest, project,
 * detail, layout, then encode + write on a computed complete layout. "Stable" is the
 * final layout result, i.e. the positions the first settled frame would draw. */
async function open(p: WorkerPipeline, store: BinaryLayoutStore, rows: FactRow[], declaration: GraphDeclaration, revision: number, o: { reset: boolean; complete?: boolean; groupLevel?: number }) {
  const settings = defaults('links'), start = performance.now(); let streamed = 0;
  p.onPositions = () => { streamed++; };
  const config = { declaration, layout: settings.layout, source: 'links/local', groupLevel: o.groupLevel ?? 0, streamEveryIterations: settings.streamEveryIterations };
  const hashes = await p.request<{ declarationHash: string; layoutHash: string; held?: boolean }>(revision, { kind: 'configure', config });
  let read = 0;
  if (!hashes.held) {
    const readStart = performance.now(), saved = await store.latest(hashes.declarationHash, { source: config.source, layoutHash: hashes.layoutHash, producer: LAYOUT_PRODUCER });
    if (saved) await p.request(revision, { kind: 'load', generation: saved });
    read = performance.now() - readStart;
  }
  for (let i = 0; i < rows.length || (o.reset && i === 0); i += 2000) await p.request(revision, { kind: 'rows', reset: o.reset && i === 0, columns: packRows(rows.slice(i, i + 2000), declaration) });
  const result = await p.request<ProjectResult>(revision, { kind: 'project', complete: o.complete !== false });
  if (result.invalidSaved) await store.quarantine(result.invalidSaved);
  await p.request(revision, { kind: 'detail' });
  const layout = await p.request<LayoutResult>(revision, { kind: 'layout' }), stable = performance.now() - start;
  let write = 0;
  if (!layout.cached && o.complete !== false) { const w = performance.now(); await store.write(await p.request<BinaryGeneration>(revision, { kind: 'encode' })); write = performance.now() - w; }
  return { stableMs: stable, workerLayoutMs: layout.milliseconds, cacheReadMs: read, writeMs: write, cached: layout.cached, reused: layout.reused ?? 'none', streamedSnapshots: streamed, positions: layout.positions };
}
const worker = () => new WorkerPipeline(new Worker(new URL('../src/layout-worker.ts', import.meta.url).href) as unknown as Transport, () => 600000);
const round = (v: Record<string, unknown>) => Object.fromEntries(Object.entries(v).filter(([k]) => k !== 'positions').map(([k, x]) => [k, typeof x === 'number' ? Math.round(x) : x]));

test.skipIf(!process.env.PERF_BENCH)('layout cache: cold, exact, provisional reload, warm edit and settings change at 16k/46k and 61k/100k', async () => {
  const results: any[] = [];
  for (const literal of [false, true]) {
    const { rows, declaration } = performanceFixture(literal, true), disk = new MemoryAdapter();
    const store = () => new BinaryLayoutStore(disk, { ...defaults('links').cache, directory: 'plugin/cache/local', cachedDeclarations: 1 });
    const runs: Record<string, unknown> = {};
    // 1. Cold: empty cache, new worker.
    let p = worker();
    try {
      runs.cold = round(await open(p, store(), rows, declaration, 1, { reset: true }));
      // 2. Same session, view reopened: worker already holds the layout.
      runs.reopen = round(await open(p, store(), [], declaration, 2, { reset: false }));
      // 3. Single note edit adding one link: warm start.
      const edited = { ...rows[1234]!, links: { links: [...(rows[1234]!.links?.links ?? []), rows[4321]!.path] } };
      runs.edit = round(await open(p, store(), [edited], declaration, 3, { reset: false }));
      rows[1234] = edited;
      // 4. Settings change that leaves layout identity alone except grouping (group level).
      runs.groupChange = round(await open(p, store(), [], { ...declaration, groups: [...declaration.groups, { from: 'folder', depth: 1 }] }, 4, { reset: false, groupLevel: 1 }));
      await open(p, store(), [], declaration, 5, { reset: false });
    } finally { p.dispose(); }
    // 5. Obsidian reload, metadata complete at first build: new worker, generation from disk.
    p = worker();
    try { runs.reloadExact = round(await open(p, store(), rows, declaration, 1, { reset: true })); } finally { p.dispose(); }
    // 6. Obsidian reload while links are still resolving (provisional), then the complete build.
    p = worker();
    try {
      const partial = rows.map((r, i) => i % 3 ? r : { ...r, links: { links: [] } });
      runs.reloadProvisional = round(await open(p, store(), partial, declaration, 1, { reset: true, complete: false }));
      runs.reloadVerified = round(await open(p, store(), rows, declaration, 2, { reset: true }));
    } finally { p.dispose(); }
    expect((runs.reloadExact as any).cached).toBe(true);
    results.push({ nodes: literal ? 61000 : 16000, edges: literal ? 100000 : 46400, runs });
    console.log(JSON.stringify(results.at(-1)));
  }
  const receipt = { runtime: Bun.version, hardware: 'Linux desktop CPU', command: './scripts/run.sh bench:cache', caveats: 'Real layout worker and BinaryLayoutStore over an in-memory adapter. No Obsidian metadata IO, physical disk, renderer upload or paint. stableMs runs from configure to the final layout result.', results };
  mkdirSync('.workspace/evidence', { recursive: true }); writeFileSync('.workspace/evidence/performance-cache.json', JSON.stringify(receipt, null, 2) + '\n');
}, 600000);
