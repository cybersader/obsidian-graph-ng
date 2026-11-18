// Usage: node scripts/layout-engine-quality.mjs <directory of quality-COUNT-SHAPE.json receipts>
// Missing triplets are not passes. Do not infer eligibility for unmeasured sizes.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const seeds = [17, 18, 29], shapes = ['community', 'scale-free', 'grid'];
const directory = process.argv[2];
if (!directory) throw Error('Expected quality receipt directory');
function score(count, shape) {
  const file = `quality-${count}-${shape}.json`;
  const incomplete = reason => ({ shape, file, status: 'incomplete', reason });
  let text;
  try { text = readFileSync(join(directory, file), 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return incomplete('missing receipt'); throw error; }
  if (!text.trim()) return incomplete('empty receipt');
  let doc;
  try { doc = JSON.parse(text); } catch { return incomplete('invalid receipt'); }
  const run = doc?.runs?.[0];
  if (doc?.kind !== 'quality' || doc.count !== count || doc.shape !== shape || run?.count !== count || run.maxIterations !== 20000 ||
      !Array.isArray(run.layouts) || run.layouts.length !== 6 || !Array.isArray(run.pairs) || run.pairs.length !== 3) return incomplete('missing triplet');
  const max = { cpu: { edge: 0, graph: 0, disagreement: 0 }, gpu: { edge: 0, graph: 0, disagreement: 0 } };
  const unsettled = [], seconds = { cpu: [], gpu: [] };
  for (const [i, seed] of seeds.entries()) {
    const pair = run.pairs[i];
    if (pair?.seed !== seed || pair.baselineSeed !== seeds[(i + 1) % 3]) return incomplete('incorrect seed pairs');
    for (const [j, engine] of ['cpu', 'gpu'].entries()) {
      const row = run.layouts[2 * i + j], metric = pair[engine];
      if (row?.engine !== engine + seed || row.quality?.finite !== true || !Number.isInteger(row.iterations) || row.iterations < 1 || row.iterations > run.maxIterations ||
          !Number.isFinite(row.ms) || row.ms <= 0 || typeof row.settled !== 'boolean' ||
          ![metric?.edge, metric?.graph, metric?.overlap].every(x => Number.isFinite(x) && x >= 0 && x <= 1)) return incomplete('invalid measurement');
      if (!row.settled) unsettled.push(row.engine);
      seconds[engine].push(row.ms / 1000);
      const m = max[engine];
      m.edge = Math.max(m.edge, metric.edge); m.graph = Math.max(m.graph, metric.graph);
      m.disagreement = Math.max(m.disagreement, 1 - metric.overlap);
    }
  }
  const exceeded = Object.keys(max.cpu).filter(key => max.gpu[key] > 1.25 * max.cpu[key]);
  const status = unsettled.length ? 'unsettled' : exceeded.length ? 'failed' : 'passed';
  const median = values => [...values].sort((a,b) => a-b)[1];
  return { shape, file, status, pairs: 3, unsettled, exceeded, max,
    medianSettledSeconds: unsettled.length ? null : { cpu: median(seconds.cpu), gpu: median(seconds.gpu) } };
}
const buckets = [2000, 20000, 49000].map(count => {
  const results = shapes.map(shape => score(count, shape));
  const qualityPassed = results.every(r => r.status === 'passed');
  return { count, qualityPassed, admitted: count >= 5000 && qualityPassed, results };
});
console.log(JSON.stringify({ seeds, tolerance: 1.25, buckets }, null, 2));
