import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { defaultDeclaration } from '../src/core/declaration';
import { buildProjection, type FactRow } from '../src/core/projection';
import { DEFAULT_LAYOUT, random, runLayout } from '../src/core/layout';
import { recommendedPhysics } from '../src/recommend';

/** Synthetic families of 50 notes, one local and two cross-family links per note.
 * Parent references are not link edges. The declared key is deliberately arbitrary. */
export function familyFixture(count: number) {
  const rng = random(17), groups = Math.ceil(count / 50);
  const declaration = { ...defaultDeclaration('synthetic@1'), identity: [{ key: 'uid' }], hierarchy: { parentProperty: 'branchRef' } };
  const rows: FactRow[] = Array.from({ length: count }, (_, i) => {
    const group = Math.floor(i / 50), start = group * 50, size = Math.min(50, count - start);
    const at = (n: number) => `Family ${String(Math.floor(n / 50) + 1).padStart(3, '0')}/Note ${String(n).padStart(5, '0')}.md`;
    const links = [start + (i - start + 1) % size, Math.floor(rng() * count), Math.floor(rng() * count)].filter(n => n !== i);
    return { path: at(i), properties: { uid: `n${i}`, ...(i === start ? {} : { branchRef: `n${start}` }) }, links: { 'synthetic@1': links.map(at) } };
  });
  return { declaration, rows, groups };
}
export function familyMetrics(p: ReturnType<typeof buildProjection>, positions: Float32Array) {
  const n = p.paths.length, up = p.up!, sumX = new Float64Array(n), sumY = new Float64Array(n), counts = new Uint32Array(n);
  let distance = 0, variance = 0, radius = 0, cx = 0, cy = 0;
  for (let i = 0; i < n; i++) { cx += positions[2 * i]! / n; cy += positions[2 * i + 1]! / n; }
  for (let i = 0; i < n; i++) {
    const x = positions[2 * i]!, y = positions[2 * i + 1]!; radius += (x - cx) ** 2 + (y - cy) ** 2;
    for (let e = up.offsets[i]!; e < up.offsets[i + 1]!; e++) {
      const parent = up.targets[e]!; distance += Math.hypot(x - positions[2 * parent]!, y - positions[2 * parent + 1]!);
      sumX[parent]! += x; sumY[parent]! += y; counts[parent]!++;
    }
  }
  for (let i = 0; i < n; i++) for (let e = up.offsets[i]!; e < up.offsets[i + 1]!; e++) {
    const parent = up.targets[e]!;
    variance += (positions[2 * i]! - sumX[parent]! / counts[parent]!) ** 2 + (positions[2 * i + 1]! - sumY[parent]! / counts[parent]!) ** 2;
  }
  const parentDistance = distance / up.targets.length, siblingSpread = Math.sqrt(variance / up.targets.length), graphRadius = Math.sqrt(radius / n);
  return { parentDistance, siblingSpread, graphRadius, parentNormalized: parentDistance / graphRadius, siblingsNormalized: siblingSpread / graphRadius };
}
if (import.meta.main) {
  const results = [];
  for (const count of [5000, 16000]) {
    const { rows, declaration } = familyFixture(count), p = buildProjection(rows, declaration);
    const { iterations, ...force } = recommendedPhysics(count, p.source.length);
    const input = { count, source: p.source, target: p.target, offsets: p.offsets, targets: p.targets, up: p.up, seed: 17 };
    for (const familyPull of [0, 2, 5]) {
      const options = { ...DEFAULT_LAYOUT, iterations, force: { ...DEFAULT_LAYOUT.force, ...force, familyPull } };
      const times = []; let positions: Float32Array = new Float32Array(), hash = '';
      for (let repeat = 0; repeat < 3; repeat++) {
        const start = performance.now(); positions = runLayout(input, options); times.push(performance.now() - start);
        const next = createHash('sha256').update(new Uint8Array(positions.buffer)).digest('hex');
        if (hash && hash !== next) throw Error('Nondeterministic family layout'); hash = next;
      }
      const result = { count, edges: p.source.length, parents: p.up!.targets.length, familyPull, iterations, milliseconds: times.sort((a, b) => a - b)[1], ...familyMetrics(p, positions), hash };
      results.push(result); console.log(JSON.stringify(result));
    }
  }
  await mkdir('.workspace/evidence', { recursive: true });
  await writeFile('.workspace/evidence/family-pull.json', JSON.stringify({ seed: 17, repetitions: 3, timing: 'Median wall time, solver only. Shared host; not native frame time.', results }, null, 2) + '\n');
}
