import { mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { fixture, exampleDeclaration } from './fixture';
import { buildProjection } from '../src/core/projection';
import { DEFAULT_LAYOUT, runLayout } from '../src/core/layout';
import { oracleLayout, layoutQuality, qualityDifference } from '../tests/support/layout-oracle';
const options = { ...DEFAULT_LAYOUT, iterations: 50 }, rows = fixture(), results = [];
for (const literal of [false, true]) {
  const p = buildProjection(rows, { ...exampleDeclaration, display: { reifiedAsNodes: literal } });
  const input = { count: p.paths.length, source: p.source, target: p.target, offsets: p.offsets, targets: p.targets, seed: 17 };
  const start = performance.now(), own = runLayout(input, options), ownMs = performance.now() - start;
  const oracleStart = performance.now(), oracle = oracleLayout(input, options), oracleMs = performance.now() - oracleStart;
  const quality = layoutQuality(input, own), oracleQuality = layoutQuality(input, oracle), difference = qualityDifference(quality, oracleQuality);
  const baselineMs = literal ? 18400 : 3700;
  const result = { literal, nodes: input.count, edges: input.source.length, iterations: options.iterations, seed: input.seed, ownMs, oracleMs, baselineMs, baselineSpeedup: baselineMs / ownMs, currentOracleSpeedup: oracleMs / ownMs, quality, oracleQuality, difference, qualityPass: difference.stressAbsolute < .08 && difference.maxQuantileRelative < .25 && Math.abs(difference.medianScaleRatio - 1) < .15, historicalTimePass: ownMs <= baselineMs / 2, hash: createHash('sha256').update(new Uint8Array(own.buffer)).digest('hex') };
  results.push(result); console.log(JSON.stringify(result));
}
await mkdir('.workspace/evidence', { recursive: true });
await writeFile('.workspace/evidence/layout-benchmark.json', JSON.stringify({ command: 'bun run bench:layout', cpu: os.cpus()[0]?.model, ram: os.totalmem(), runtime: Bun.version, repetitions: 1, method: 'Same seed, input, initial Float32 positions and 50 continuous iterations. Includes solver initialization and graphology object construction; excludes fixture/projection build. Standard BH cell-width/distance theta 1.2; oracle uses twice cell width. Unit-edge optimally rescaled stress; RMS-normalized edge q10/q50/q90 tolerance 25%, stress absolute delta <0.08, unnormalized median scale ratio within 15%. Historical baseline supplied as 3.7s/18.4s, not rerun source.', results }, null, 2) + '\n');
if (results.some(r => !r.qualityPass || !r.historicalTimePass)) throw new Error('LAYOUT_BENCHMARK_TARGET_MISSED');
