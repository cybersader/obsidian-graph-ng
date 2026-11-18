import { LayoutSolver, DEFAULT_LAYOUT, initialPositions, random, visualStop, VISUAL_STRIDE } from "../src/core/layout";
import { LayoutEngineSession } from "../src/layout-engine";
import { requestComputeAdapter, WebGpuLayout } from "../src/webgpu-layout";
import { yieldTask } from "../src/core/scheduler";
import { checkpointTiming, compare } from './layout-engine-bench-metrics.mjs';
function fixture(n, shape) {
  const source = [], target = [], rng = random(17);
  if (shape === 'scale-free') {
    // Preferential attachment: uniformly sample existing edge endpoints by degree.
    source.push(0); target.push(1);
    for (let i = 2; i < n; i++) {
      const edges = source.length, links = new Set();
      while (links.size < Math.min(3, i)) links.add((rng() < .5 ? source : target)[Math.floor(rng() * edges)]);
      for (const j of links) { source.push(i); target.push(j); }
    }
  } else if (shape === 'grid') {
    const width = Math.ceil(Math.sqrt(n));
    for (let i = 0; i < n; i++) {
      if (i + 1 < n && (i + 1) % width) { source.push(i); target.push(i + 1); }
      if (i + width < n) { source.push(i); target.push(i + width); }
    }
  } else for (let i = 0; i < n; i++) {
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
  const rng = random(719);
  for (let a = 0; a < 32; a++) {
    const i = Math.floor(rng() * n), nearest = [];
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
        const j = Math.floor(rng() * n);
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
const options = (iterations = 100, adjust = true) => ({ ...DEFAULT_LAYOUT, iterations, force: { ...DEFAULT_LAYOUT.force, adjustSizes: adjust } });
async function benchmark(job) {
  const input = fixture(job.count, job.shape), o = options(job.iterations ?? 100, job.adjust ?? true);
  if (job.kind === 'probe') {
    const small = {count: 4, source: Uint32Array.of(0), target: Uint32Array.of(2), initial: Float32Array.of(0,0,.6,0,1,0,1e6,0), movable: Uint8Array.of(0,1,0,0), seed: 17};
    const opts = {...DEFAULT_LAYOUT, force: {...DEFAULT_LAYOUT.force, gravity: 0, hubGravity: 0, barnesHutTheta: .01}};
    const cpu = new LayoutSolver(small,opts); cpu.step();
    async function one(i) {
      const gpu = await WebGpuLayout.create(await requestComputeAdapter(),i,opts,new AbortController().signal);
      try { return (await gpu.batch(1)).positions; } finally { gpu.destroy(); }
    }
    const gpuX = (await one(small))[2], cpuX = cpu.positions[2];
    if (!(gpuX < 0 && Math.abs(gpuX-cpuX)<.001)) throw Error(`Morton collision: ${gpuX} vs ${cpuX}`);
    const p = await one({...small, source: new Uint32Array(), target: new Uint32Array()});
    if (!p.every(Number.isFinite)) throw Error('Nonfinite edgeless layout');
    return {cpuX, gpuX, zeroEdgeCoordinates: [...p]};
  }
  if (job.kind === 'quality') {
    o.finishFully = true; // Observe the baseline endpoint even after the candidate rule fires.
    o.iterations = job.maxIterations;
    o.force.strongGravityMode = true;
    o.force.gravity = 0.1;
    o.force.scalingRatio = 10;
    const { checkpointMs, seeds } = job;
    const kinds = job.engine === 'both' ? ['cpu', 'gpu'] : [job.engine];
    const result = { count: input.count, criterion: '3 consecutive steps: slowdown/damping-compensated RMS movement <= .002 RMS position', maxIterations: o.iterations, layouts: [] };
    for (const seed of seeds) for (const kind of kinds) {
      const engine = kind + seed; input.seed = seed;
      const checkpoints = [], trace = [], check = visualStop({ ...o, finishFully: false }, kind === 'gpu');
      let visualFire = null, atFire;
      const observe = (iteration, movement, extent, positions) => {
        if (!checkpointMs || iteration % VISUAL_STRIDE) return;
        const ms = elapsed(performance.now());
        trace.push([iteration, ms, movement * o.force.slowDown / (o.force.adjustSizes ? .3 : 1) / Math.max(extent, 1e-30)]);
        if (!visualFire && check?.(iteration, movement, extent, positions)) { visualFire = { iteration, ms }; if (job.verifyFire) atFire = positions.slice(); }
      };
      if (checkpointMs) checkpoints.push({ iteration: 0, ms: 0, quality: quality(input, initialPositions(input.count, seed ^ o.seed, o.initialRadius)) });
      let scoringMs = 0, nextCheckpoint = checkpointMs;
      const start = performance.now();
      const elapsed = now => now - start - scoringMs;
      const sample = (p, iteration) => {
        const now = performance.now(), ms = elapsed(now);
        if (ms < nextCheckpoint && iteration !== visualFire?.iteration) return;
        checkpoints.push({ iteration, ms, quality: quality(input, p) });
        scoringMs += performance.now() - now;
        nextCheckpoint = (Math.floor(ms / checkpointMs) + 1) * checkpointMs;
      };
      let p, iterations = 0, settled = false, movement = 0;
      if (kind === 'cpu') {
        const solver = new LayoutSolver(input, o);
        while (!solver.done) {
          solver.step();
          observe(solver.iteration, solver.movement, solver.extent, solver.positions);
          if (solver.settled) break;
          if (checkpointMs && !solver.done) sample(solver.positions, solver.iteration);
          if (solver.iteration % 10 === 0) await yieldTask(true);
        }
        p = solver.positions;
        iterations = solver.iteration;
        settled = solver.settled;
        movement = solver.movement;
      } else {
        const adapter = await requestComputeAdapter(); if (!adapter) throw Error('GPU unavailable');
        const gpu = await WebGpuLayout.create(adapter, input, o, new AbortController().signal);
        try {
          while (iterations < o.iterations) {
            const step = await gpu.batch(1);
            p = step.positions;
            movement = step.movement;
            iterations++;
            observe(iterations, movement, step.extent, p);
            if (step.quiet >= o.convergenceIterations) {
              settled = true;
              break;
            }
            if (checkpointMs && iterations < o.iterations) sample(p, iterations);
          }
        } finally {
          gpu.destroy();
        }
      }
      const ms = elapsed(performance.now());
      const q = quality(input, p);
      const row = { engine, iterations, settled, movement, ms, quality: q };
      if (checkpointMs) {
        checkpoints.push({ iteration: iterations, ms, quality: q });
        row.trace = trace; row.visualFire = visualFire;
        row.timing = checkpointTiming(checkpoints, q, settled, checkpointMs);
        row.checkpointScoringMs = scoringMs;
      }
      if (atFire) {
        const preference = kind === 'gpu' ? 'graphics' : 'processor';
        const actual = await new LayoutEngineSession().run(input, { ...o, finishFully: false }, {
          preference, stopped: () => false, every: 13, yieldNow: () => yieldTask(true), emit() {}, wantsFrame: () => false,
        });
        if (!actual.looksDone || actual.settled || actual.engineStatus.engine !== preference || !actual.positions.every((v, i) => v === atFire[i])) throw Error('Production pass did not return the observed visual stop');
        row.verifiedFire = true;
      }
      result.layouts.push(row);
      // Keep the synthetic neighbour samples in stderr until all cyclic pairs can
      // be scored. A partial journal alone never admits a class.
      self.postMessage({ progress: row });
    }
    if (job.engine === 'both' && seeds.join(',') === '17,18,29') result.pairs = seeds.map((seed, i) => {
      const q = result.layouts[i * 2].quality;
      return {seed, baselineSeed: seeds[(i + 1) % seeds.length], cpu: compare(q, result.layouts[2 * ((i + 1) % seeds.length)].quality), gpu: compare(q, result.layouts[2*i+1].quality)};
    });
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
  const start = performance.now();
  const result = await session.run(input, o, { preference: job.preference, every: 5,
    stopped: () => stop, yieldNow: () => yieldTask(true),
    emit: () => { if (job.kind === 'stop') self.postMessage({ frame: true }); }
  });
  const milliseconds = performance.now() - start;
  const probedByLayout = available !== undefined;
  // A quality-excluded Auto run never asks for an adapter. Observe capability
  // afterwards, outside the clock, so the default-flags measurement stays cold.
  const adapterAvailable = available ?? !!(await requestComputeAdapter());
  return { milliseconds, probedByLayout, adapterAvailable, engineStatus: result.engineStatus, finite: result.positions.every(Number.isFinite),
    settled: result.settled, hash: Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', result.positions)), b => b.toString(16).padStart(2, '0')).join('') };
}
self.onmessage = async ({ data }) => {
  try { self.postMessage(await benchmark(data)); } catch (error) { self.postMessage({ error: String(error) }); }
};
