import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { checkpointTiming } from '../scripts/layout-engine-bench-metrics.mjs';

const final = { edgeStress: 0, graphStress: 0, near: [[0, 1, 2, 3, 4, 5, 6, 7, 8, 9]], finite: true };
test('checkpoint timing distinguishes the first crossing from sustained agreement', () => {
  const checkpoints = [
    { ...final, near: [[10, 11, 12, 13, 14, 15, 16, 17, 18, 19]] },
    { ...final, graphStress: 0.15 },
    { ...final, edgeStress: 0.25 },
    { ...final, near: [[0, 1, 2, 3, 4, 5, 6, 7, 8, 10]] },
    final,
  ].map((quality, iteration) => ({ quality, iteration, ms: iteration * 1000 }));
  const actual = checkpointTiming(checkpoints, final, true, 1000);
  assert.equal(actual.reference, 'first-settled');
  assert.deepEqual(actual.thresholds, [
    { fraction: 0.8, firstMs: 1000, sustainedMs: 3000 },
    { fraction: 0.9, firstMs: 3000, sustainedMs: 3000 },
    { fraction: 0.95, firstMs: 4000, sustainedMs: 4000 },
  ]);
  assert.equal(checkpointTiming(checkpoints, final, false, 1000).reference, 'step-cap');
});

test('stress timing measures closure of both seed-to-final stress gaps independent of neighbours', () => {
  const earlier = { ...final, near: [[10, 11, 12, 13, 14, 15, 16, 17, 18, 19]] };
  const measurements = [[0.2, 0.5], [0.01, 0.075], [0.017, 0.02], [0, 0]];
  const checkpoints = measurements.map(([edgeStress, graphStress], iteration) => ({
    quality: { ...(iteration === 3 ? final : earlier), edgeStress, graphStress }, iteration, ms: iteration * 1000,
  }));
  const actual = checkpointTiming(checkpoints, final, true, 1000);
  assert.deepEqual(actual.stressThresholds.map(row => row.sustainedMs), [1000, 2000, 3000]);
  assert.deepEqual(actual.thresholds.map(row => row.sustainedMs), [3000, 3000, 3000]);
});

test('experimental receipts cannot pass the fixed-cap CLI and still require all layouts and shapes', t => {
  const directory = mkdtempSync(join(tmpdir(), 'layout-bench-test-'));
  t.after(() => rmSync(directory, { force: true, recursive: true }));
  const count = 20000, maxIterations = 60000, seeds = [17, 18, 29];
  const layouts = seeds.flatMap(seed => ['cpu', 'gpu'].map(engine => ({ engine: engine + seed, iterations: 30000, ms: 1000, settled: true, quality: { finite: true } })));
  const pairs = seeds.map((seed, i) => ({ seed, baselineSeed: seeds[(i + 1) % 3], cpu: { edge: 0.25, graph: 0.25, overlap: 0.75 }, gpu: { edge: 0.3125, graph: 0.3125, overlap: 0.6875 } }));
  const save = (shape, run = {}) => writeFileSync(join(directory, `quality-${count}-${shape}.json`), JSON.stringify({
    count, shape, kind: 'quality', runs: [{ count, maxIterations, layouts, pairs, ...run }],
  }));
  const run = (script, ...args) => JSON.parse(execFileSync(process.execPath, [`scripts/layout-engine-quality${script}.mjs`, directory, ...args], { encoding: 'utf8' }));
  const experiment = () => run('-experiment', String(maxIterations), String(count)).buckets[0];
  save('community');
  save('scale-free');
  assert.equal(experiment().wouldPassQualityAdmission, false);
  save('grid');
  assert.equal(experiment().wouldPassQualityAdmission, true);
  const fixed = run('').buckets.find(bucket => bucket.count === count);
  assert.equal(fixed.admitted, false);
  assert.ok(fixed.results.every(shape => shape.status === 'incomplete'));
  save('grid', { layouts: layouts.map((row, i) => i ? row : { ...row, settled: false }) });
  assert.equal(experiment().results.find(shape => shape.shape === 'grid').status, 'unsettled');
  save('grid', { pairs: pairs.map((pair, i) => i ? pair : { ...pair, gpu: { ...pair.gpu, edge: 0.32 } }) });
  assert.deepEqual(experiment().results.find(shape => shape.shape === 'grid').exceeded, ['edge']);
});
