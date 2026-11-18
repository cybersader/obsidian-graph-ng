import { LayoutSolver, DEFAULT_LAYOUT, random } from "../src/core/layout";
import { LayoutEngineSession } from "../src/layout-engine";
import { requestComputeAdapter, WebGpuLayout } from "../src/webgpu-layout";
import { yieldTask } from "../src/core/scheduler";
function fixture(n) {
  const source = [], target = [], rng = random(17);
  for (let i = 0; i < n; i++) {
    const base = Math.floor(i / 128) * 128, end = Math.min(n, base + 128);
    for (const j of [base + (i - base + 1) % (end - base), base + Math.floor(rng() * (end - base)), base]) if (i !== j) {
      source.push(i);
      target.push(j);
    }
    if (i % 32 === 0) {
      source.push(i);
      target.push((i + 128) % n);
    }
  }
  const offsets = new Uint32Array(n + 1);
  for (let e = 0; e < source.length; e++) {
    offsets[source[e] + 1]++;
    offsets[target[e] + 1]++;
  }
  for (let i = 1; i <= n; i++) offsets[i] += offsets[i - 1];
  const at = offsets.slice(), targets = new Uint32Array(source.length * 2);
  for (let e = 0; e < source.length; e++) {
    targets[at[source[e]]++] = target[e];
    targets[at[target[e]]++] = source[e];
  }
  return { count: n, source: Uint32Array.from(source), target: Uint32Array.from(target), offsets, targets, seed: 17 };
}
function quality(input, p) {
  let sum = 0, sq = 0;
  const { source, target, count: n, offsets, targets } = input;
  for (let e = 0; e < source.length; e++) {
    const a = source[e], b = target[e], d = Math.hypot(p[2 * a] - p[2 * b], p[2 * a + 1] - p[2 * b + 1]);
    sum += d;
    sq += d * d;
  }
  const mean = sum / source.length, cv = Math.sqrt(Math.max(0, sq / source.length - mean * mean)) / mean;
  const near = [];
  let ratios = 0, ratioSq = 0, pairs = 0, topologicalHits = 0;
  for (let a = 0; a < 32; a++) {
    const i = Math.floor(a * n / 32), nearest = [];
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const d = (p[2 * i] - p[2 * j]) ** 2 + (p[2 * i + 1] - p[2 * j + 1]) ** 2;
      if (nearest.length < 10 || d < nearest[9].d) {
        nearest.push({ d, j });
        nearest.sort((a2, b) => a2.d - b.d);
        if (nearest.length > 10) nearest.pop();
      }
    }
    near.push(nearest.map((x) => x.j));
    const twoHop = /* @__PURE__ */ new Set();
    for (let k = offsets[i]; k < offsets[i + 1]; k++) {
      const v = targets[k];
      twoHop.add(v);
      for (let z = offsets[v]; z < offsets[v + 1]; z++) twoHop.add(targets[z]);
    }
    topologicalHits += nearest.filter((x) => twoHop.has(x.j)).length;
    if (a < 8) {
      const distance = new Int32Array(n).fill(-1), queue = new Uint32Array(n);
      let r = 0, w = 1;
      queue[0] = i;
      distance[i] = 0;
      while (r < w) {
        const u = queue[r++];
        for (let k = offsets[u]; k < offsets[u + 1]; k++) {
          const v = targets[k];
          if (distance[v] < 0) {
            distance[v] = distance[u] + 1;
            queue[w++] = v;
          }
        }
      }
      for (let q = 0; q < 512; q++) {
        const j = Math.floor(q * n / 512);
        if (distance[j] > 0) {
          const ratio = Math.hypot(p[2 * i] - p[2 * j], p[2 * i + 1] - p[2 * j + 1]) / distance[j];
          ratios += ratio;
          ratioSq += ratio * ratio;
          pairs++;
        }
      }
    }
  }
  return { edgeStress: 1 - sum * sum / (source.length * sq), graphStress: 1 - ratios * ratios / (pairs * ratioSq), edgeLengthCV: cv, topologicalNeighborPrecision: topologicalHits / 320, near, finite: p.every(Number.isFinite) };
}
function compare(a, b) {
  const rel = (x, y) => Math.abs(y - x) / Math.max(Math.abs(x), 1e-6);
  const nearestOverlap = a.near.reduce((sum, ids, i) => sum + ids.filter((id) => b.near[i].includes(id)).length, 0) / (a.near.length * 10);
  const edgeStressRelative = rel(a.edgeStress, b.edgeStress), graphStressRelative = rel(a.graphStress, b.graphStress), cvRelative = rel(a.edgeLengthCV, b.edgeLengthCV);
  return { edgeStressRelative, graphStressRelative, cvRelative, nearestOverlap, topologicalPrecisionDelta: b.topologicalNeighborPrecision - a.topologicalNeighborPrecision, proposedGate: edgeStressRelative <= 0.03 && graphStressRelative <= 0.03 && cvRelative <= 0.03 && nearestOverlap >= 0.95 && b.finite };
}
const options = (iterations = 100, adjust = true) => ({ ...DEFAULT_LAYOUT, iterations, force: { ...DEFAULT_LAYOUT.force, adjustSizes: adjust } });
async function benchmark(job) {
  const input = fixture(job.count), o = options(job.iterations ?? 100, job.adjust ?? true);
  if (job.kind === "quality") {
    const adapter = await requestComputeAdapter();
    o.iterations = 2e4;
    o.force.strongGravityMode = true;
    o.force.gravity = 0.1;
    o.force.scalingRatio = 10;
    const result = { count: input.count, available: !!adapter, criterion: "3 consecutive steps: slowdown/damping-compensated RMS movement <= .002 RMS position", maxIterations: o.iterations, layouts: [] };
    for (const engine of ["cpu17", "cpu18", "gpu17"]) {
      const start = performance.now();
      let p, iterations = 0, settled = false, movement = 0;
      if (engine.startsWith("cpu")) {
        const solver = new LayoutSolver({ ...input, seed: engine === "cpu18" ? 18 : 17 }, o);
        while (!solver.done) {
          solver.step();
          if (solver.settled) break;
          if (solver.iteration % 10 === 0) await yieldTask(true);
        }
        p = solver.positions;
        iterations = solver.iteration;
        settled = solver.settled;
        movement = solver.movement;
      } else {
        if (!adapter) break;
        const gpu = await WebGpuLayout.create(adapter, input, o, new AbortController().signal);
        try {
          while (iterations < o.iterations) {
            const step = await gpu.batch(1);
            p = step.positions;
            movement = step.movement;
            iterations++;
            if (step.quiet >= o.convergenceIterations) {
              settled = true;
              break;
            }
          }
        } finally {
          gpu.destroy();
        }
      }
      const ms = performance.now() - start;
      const q = quality(input, p);
      result.layouts.push({ engine, iterations, settled, movement, ms, quality: q });
      console.log(JSON.stringify({ count: input.count, engine, iterations, settled, ms, stress: q.edgeStress }));
    }
    if (result.layouts.length === 3) {
      result.seedBaseline = compare(result.layouts[0].quality, result.layouts[1].quality);
      result.graphicsDifference = compare(result.layouts[0].quality, result.layouts[2].quality);
    }
    for (const row of result.layouts) delete row.quality.near;
    return result;
  }

  if (job.kind === 'absent') Object.defineProperty(navigator, 'gpu', { value: undefined });
  let available, stop = false;
  const session = new LayoutEngineSession({
    adapter: async () => { const adapter = await requestComputeAdapter(); available = !!adapter; return adapter; },
    graphics: async (...args) => {
      // Inject setup latency, not a fabricated clock or fabricated solver output.
      if (job.kind === 'slow') await new Promise(resolve => setTimeout(resolve, 400));
      return WebGpuLayout.create(...args);
    }
  });
  self.onmessage = ({ data }) => { if (data === 'stop') { stop = true; session.stop(); } };
  const result = await session.run(input, o, { preference: job.preference, every: 5,
    stopped: () => stop, yieldNow: () => yieldTask(true),
    emit: () => { if (job.kind === 'stop') self.postMessage({ frame: true }); }
  });
  return { available, engineStatus: result.engineStatus, finite: result.positions.every(Number.isFinite),
    settled: result.settled, hash: Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', result.positions)), b => b.toString(16).padStart(2, '0')).join('') };
}
self.onmessage = async ({ data }) => {
  try { self.postMessage(await benchmark(data)); } catch (error) { self.postMessage({ error: String(error) }); }
};
