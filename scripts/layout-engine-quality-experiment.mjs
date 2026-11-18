// Usage: node scripts/layout-engine-quality-experiment.mjs RECEIPTS MAX_ITERATIONS COUNT [COUNT ...]
import { scoreLayoutQuality } from './layout-engine-quality.mjs';

const [directory, cap, ...sizes] = process.argv.slice(2), maxIterations = Number(cap), counts = sizes.map(Number);
if (!directory || !Number.isSafeInteger(maxIterations) || maxIterations < 3 || maxIterations > 100000 ||
    !counts.length || counts.some(count => !Number.isSafeInteger(count) || count < 2 || count > 49000) || new Set(counts).size !== counts.length) {
  throw Error('Expected receipt directory, iteration cap (3..100000), and one or more distinct sizes (2..49000)');
}
const { seeds, tolerance, buckets } = scoreLayoutQuality(directory, counts, maxIterations);
console.log(JSON.stringify({ experimental: true, maxIterations, seeds, tolerance, buckets: buckets.map(({ admitted, ...bucket }) => ({
  ...bucket, wouldPassQualityAdmission: admitted,
})) }, null, 2));
