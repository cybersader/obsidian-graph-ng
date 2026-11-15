import { test, expect } from 'bun:test';
import { writeFileSync, mkdirSync } from 'node:fs';
import { performanceFixture } from './support/performance-fixture';
import { performanceRenderer } from './support/performance-renderer';
import { buildProjection } from '../src/core/projection';
import { packRows, unpackRows } from '../src/core/columns';
import { warmLayout } from '../src/core/incremental';
import { DEFAULT_LAYOUT } from '../src/core/layout';
import { defaults } from '../src/settings';
import { renderProjection } from '../src/render-projection';

async function streamed(input: unknown): Promise<any> {
  const worker = new Worker(new URL('./support/startup-worker.ts', import.meta.url).href), start = performance.now(), snapshots: any[] = [];
  try { return await new Promise((resolve, reject) => {
    const deadline = setTimeout(() => { worker.terminate(); reject(new Error('Startup deadline')); }, 120000);
    worker.onerror = e => { clearTimeout(deadline); reject(new Error(e.message)); };
    worker.onmessage = e => {
      const { positions, ...message } = e.data;
      if (message.error) { clearTimeout(deadline); reject(new Error(message.error)); }
      else if (message.done) { clearTimeout(deadline); resolve({ ...message, roundTripMs: performance.now() - start, positions, snapshots }); }
      else snapshots.push({ iteration: message.iteration, workerMs: message.milliseconds, receivedMs: performance.now() - start });
    };
    worker.postMessage(input);
  }); } finally { worker.terminate(); }
}

test.skipIf(!process.env.PERF_BENCH)('startup CPU lower bounds: real stream cadence and valid cached-position reuse', async () => {
  const results: any[] = [];
  for (const literal of [false, true]) {
    const { rows, declaration, shape } = performanceFixture(literal, true), samples: any[] = [];
    for (let repetition = 0; repetition < 3; repetition++) {
      const start = performance.now(), decoded = unpackRows(packRows(rows, declaration)), ingested = performance.now(), p = buildProjection(decoded, declaration), projected = performance.now();
      expect(p.paths.length).toBe(literal ? 61000 : 16309); expect(p.source.length).toBe(literal ? 100000 : 46400);
      const layout = await streamed({ count: p.paths.length, source: p.source, target: p.target, offsets: p.offsets, targets: p.targets, seed: 17 });
      const positions = layout.positions; delete layout.positions;
      expect(layout.snapshots.length).toBe(20); expect(layout.snapshots[0].iteration).toBe(0); expect(layout.snapshots[1].iteration).toBe(5);
      const harness = performanceRenderer(true); let renderer: any; const renderStart = performance.now();
      try { renderer = await harness.Renderer.create(harness.stage, renderProjection(p), positions, new Uint8Array(p.paths.length).fill(1), defaults('links'), () => {}, () => {}, new Uint32Array(p.paths.length), () => true, false); harness.draw(renderer); }
      finally { harness.dispose(renderer); }
      const renderMs = performance.now() - renderStart;
      // The production exact-cache path already validates source/declaration/layout/generation and
      // decoded identities. Isolate identity comparison + returned coordinate copy, NOT disk IO/hash/decode.
      const saved = { identities: p.identities.slice(), positions }, exactStart = performance.now();
      expect(saved.identities.every((id, i) => id === p.identities[i])).toBe(true); const copied = saved.positions.slice();
      const exactIdentityAndCopyMs = performance.now() - exactStart, warmStart = performance.now(), warm = warmLayout(saved, p, 17, DEFAULT_LAYOUT), unchangedWarmPreparationMs = performance.now() - warmStart;
      expect(warm.movable!.some(Boolean)).toBe(false); expect(warm.initial).toEqual(copied);
      samples.push({ ingestMs: ingested - start, projectionMs: projected - ingested, layout, renderSubmissionMs: renderMs,
        coldCpuPathMs: projected - start + layout.roundTripMs + renderMs, exactIdentityAndCopyMs, unchangedWarmPreparationMs });
    }
    results.push({ nodes: literal ? 61000 : 16309, edges: literal ? 100000 : 46400, shape, samples });
  }
  const receipt = { runtime: Bun.version, hardware: 'Linux desktop CPU; synthetic command-submission driver', command: './scripts/run.sh bench:startup', caveats: 'Not user-visible/native timing. No host metadata IO, cache IO, source hashing, CSS layout, shader compilation or rasterization. Cold path includes synchronous pack/decode/projection, real worker startup/stream delivery and compiled renderer setup. Stable means frozen at 100 iterations, NOT mathematical convergence. Cache timing assumes all existing generation and identity checks pass.', results };
  mkdirSync('.workspace/evidence', { recursive: true }); writeFileSync('.workspace/evidence/performance-startup.json', JSON.stringify(receipt, null, 2) + '\n');
  console.log(JSON.stringify(receipt));
}, 300000);
