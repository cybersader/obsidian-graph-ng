import { test, expect } from 'bun:test';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { packRows, unpackRows, transferables } from '../src/core/columns';
import { buildProjection, storageBytes } from '../src/core/projection';
import { relationshipNotes, carrierHiddenBy, searchSteps } from '../src/core/explore';
import { incidentEdges, focusTiers, PickGrid } from '../src/render-data';
import { buildLabels, rankFocus } from '../src/render-labels';
import { renderProjection } from '../src/render-projection';
import { interestScorer, byInterest } from '../src/interest';
import { connectionGroups, neighbourhood } from '../src/connection-card';
import { densityGrid, miniFit } from '../src/minimap';
import { defaults } from '../src/settings';
import { performanceFixture } from './support/performance-fixture';
import { performanceRenderer } from './support/performance-renderer';

const median = (a: number[]) => [...a].sort((a, b) => a - b)[Math.floor(a.length / 2)]!;
function sample(fn: () => unknown, count = 9) {
  fn(); const times: number[] = [];
  for (let i = 0; i < count; i++) { const start = performance.now(); fn(); times.push(performance.now() - start); }
  return { median: median(times), p95: [...times].sort((a, b) => a - b)[Math.ceil(count * .95) - 1], samples: times };
}
function drain<T>(g: Generator<unknown, T>) { let n = g.next(); while (!n.done) n = g.next(); return n.value; }
async function workerLayout(input: unknown): Promise<any> {
  const worker = new Worker(new URL('./support/performance-worker.ts', import.meta.url).href), start = performance.now();
  try { return await new Promise((resolve, reject) => {
    const deadline = setTimeout(() => { worker.terminate(); reject(new Error('Layout benchmark deadline')); }, 120000);
    worker.onerror = e => { clearTimeout(deadline); reject(new Error(e.message)); };
    worker.onmessage = e => { clearTimeout(deadline); e.data.error ? reject(new Error(e.data.error)) : resolve({ ...e.data, roundTripMs: performance.now() - start }); };
    worker.postMessage(input);
  }); } finally { worker.terminate(); }
}

test.skipIf(!process.env.PERF_BENCH)('synthetic performance receipt: 16k/55k and 61k/100k, no browser', async () => {
  const results: any[] = [];
  for (const literal of [false, true]) {
    Bun.gc(true); const initialHeap = process.memoryUsage();
    const { rows, declaration, shape } = performanceFixture(literal), timings: Record<string, unknown> = {};
    timings.ingestPack = sample(() => packRows(rows, declaration), 5);
    const packed = packRows(rows, declaration);
    timings.ingestDecode = sample(() => unpackRows(packed), 5);
    timings.projection = sample(() => buildProjection(rows, declaration), 5);
    const p = buildProjection(rows, declaration), n = p.paths.length, inc = incidentEdges(p), visible = new Uint8Array(n).fill(1), on = new Uint8Array(p.source.length).fill(1);
    expect(n).toBe(literal ? 61000 : 16000); expect(p.source.length).toBe(literal ? 100000 : 55000);
    const hub = p.paths.indexOf('Notes/Note-00000.md'); expect(p.offsets[hub + 1]! - p.offsets[hub]!).toBe(591);
    const worker = await workerLayout({ count: n, source: p.source, target: p.target, offsets: p.offsets, targets: p.targets, seed: 17 });
    const positions: Float32Array = worker.positions; delete worker.positions;
    const state = new Uint8Array(n * 4), edgeState = new Uint8Array(p.source.length), near: number[] = [], lit: number[] = [];
    const tiers = () => { for (const n of near) state[n * 4 + 1] = 0; for (const e of lit) edgeState[e] = 0; near.length = lit.length = 0; return focusTiers(hub, inc, p, on, visible, state, edgeState, near, lit, 65536, p.groups[0]!.codes); };
    timings.hubFocusTiers = sample(tiers);
    const interest = () => { const score = interestScorer(hub, { offsets: p.offsets, groups: p.groups[0]!.codes, declared: p.interest, bridges: true }); return connectionGroups(hub, inc, p, () => true, visible, byInterest(score)); };
    timings.hubGroupsAndInterest = sample(interest); expect(interest().direct).toBe(591);
    timings.hubLabelRanking = sample(() => rankFocus(hub, near, state, visible, p.offsets, 240, p.carrierNodes, interestScorer(hub, { offsets: p.offsets, declared: p.interest })));
    timings.onlyConnectionsReach3 = sample(() => neighbourhood(hub, 3, new Set(), inc, p, () => true, visible));
    const hood = neighbourhood(hub, 3, new Set(), inc, p, () => true, visible);
    timings.relationshipCoverageBuild = sample(() => relationshipNotes(rows, declaration), 5);
    const carriers = relationshipNotes(rows, declaration), filters = [{ kind: 'eq' as const, key: 'group', value: 'Group-0' }, { kind: 'exists' as const, key: 'score' }];
    timings.relationshipCoverageEvaluate = sample(() => carrierHiddenBy(carriers, filters));
    const grid = new PickGrid(positions, visible), fit = miniFit(grid, 160, 120);
    timings.minimapDensityRebuild = sample(() => densityGrid(positions, visible, grid, fit, 160, 120));
    const coldStart = performance.now(); drain(searchSteps(p, 'note-00', visible)); timings.searchCold = performance.now() - coldStart;
    timings.searchWarm = sample(() => drain(searchSteps(p, 'note-00', visible)));
    const rp = renderProjection(p), settings = defaults('links'), harness = performanceRenderer();
    // Preserve the production Canvas node/edge limits. Full projection, degree-591 visible hub.
    const detail = new Uint8Array(n); detail[hub] = 1;
    for (const g of interest().groups) for (const node of g.nodes) detail[node] = 1;
    // Owned carrier dots must remain visible to preserve the semantic hub.
    for (let j = inc.offsets[hub]!; j < inc.offsets[hub + 1]!; j++) { const e = inc.edges[j]!, node = p.source[e] === hub ? p.target[e]! : p.source[e]!; if (p.carrierNodes[node]) detail[node] = 1; }
    let r: any;
    try {
      const first = performance.now();
      r = await harness.Renderer.create(harness.stage, rp, positions, detail, settings, () => {}, () => {}, new Uint32Array(n), () => true, true, () => {}, { groupCodes: p.groups[0]!.codes });
      harness.draw(r); timings.firstFrameCpu = performance.now() - first;
      const k = harness.key;
      timings.hubNavigatorCard = sample(() => { r[k('selectNote')](-1); r[k('selectNote')](hub, true); }, 9);
      r[k('hovered')] = hub;
      timings.hoverFrameCpu = sample(() => harness.draw(r), 60);
      timings.panFrameCpu = sample(() => { r.camera.x += .0001; harness.draw(r); }, 60);
      timings.hoverPick = sample(() => r.pick(640, 400), 60);
      // Full label build uses the production method and full projection without lifting Canvas limits.
      const labels = performance.now(); await r[k('prepareLabels')](() => true); timings.detailLabels = performance.now() - labels;
      Bun.gc(true); await new Promise(resolve => setTimeout(resolve, 0)); Bun.gc(true); const retainedBefore = process.memoryUsage().heapUsed;
      for (let i = 0; i < 200; i++) { r.camera.x += .00001; harness.draw(r); }
      const garbageBeforeGC = process.memoryUsage().heapUsed - retainedBefore; Bun.gc(true); await new Promise(resolve => setTimeout(resolve, 0)); Bun.gc(true);
      timings.interactionMemory = { frames: 200, heapGrowthBeforeGC: garbageBeforeGC, retainedHeapDeltaAfterGC: process.memoryUsage().heapUsed - retainedBefore };
      timings.canvasDrawCalls = harness.calls();
    } finally { harness.dispose(r); }
    // Full-visibility atlas CPU timing uses the same fake text metrics as the compiled seam.
    const previousDocument = globalThis.document;
    (globalThis as any).document = { createElement: () => (harness.stage as any).getContext ? { width: 0, height: 0, getContext: () => (harness.stage as any).getContext('2d') } : null };
    try { const start = performance.now(); await buildLabels(rp, grid, settings, 1280, 800, 'sans-serif', () => true); timings.fullLabels = performance.now() - start; }
    finally { (globalThis as any).document = previousDocument; }
    const gpu = performanceRenderer(true); let full: any;
    try {
      const start = performance.now(); full = await gpu.Renderer.create(gpu.stage, rp, positions, visible, settings, () => {}, () => {}, new Uint32Array(n), () => true, false, () => {}, { groupCodes: p.groups[0]!.codes });
      gpu.draw(full); timings.fullFirstFrameSubmissionCpu = performance.now() - start;
      timings.fullHubSelect = sample(() => { full[gpu.key('selectNote')](-1); full[gpu.key('selectNote')](hub, true); gpu.draw(full); });
      full.hovered = hub; gpu.draw(full); const uploads = gpu.uploads();
      timings.fullHoverSubmissionCpu = sample(() => gpu.draw(full), 60);
      timings.fullPanSubmissionCpu = sample(() => { full.camera.x += .0001; gpu.draw(full); }, 60);
      timings.panHoverUploads = gpu.uploads() - uploads; expect(timings.panHoverUploads).toBe(0);
    } finally { gpu.dispose(full); }
    Bun.gc(true);
    const result = { literal, nodes: n, edges: p.source.length, shape, worker, timings, reach3: { visible: hood.mask.reduce((a, b) => a + b, 0), partial: hood.partial, frontier: hood.frontier.size, scanBudget: 200000 }, memory: { projectionLegacyStorageBytes: storageBytes(p), projectionTypedBytes: transferables(p).reduce((s, b) => s + b.byteLength, 0), packedIngestBytes: transferables(packed).reduce((s, b) => s + b.byteLength, 0), rendererColumnsTypedBytes: transferables(rp).reduce((s, b) => s + b.byteLength, 0), positionsBytes: positions.byteLength, heapDeltaAfterGC: process.memoryUsage().heapUsed - initialHeap.heapUsed }, positionHash: createHash('sha256').update(new Uint8Array(positions.buffer)).digest('hex') };
    results.push(result); console.log(JSON.stringify(result));
  }
  const label = process.env.PERF_LABEL ?? 'current'; if (!/^[a-z0-9-]+$/.test(label)) throw new Error('Invalid receipt label');
  const receipt = { revision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), bundleHash: createHash('sha256').update(readFileSync('main.js')).digest('hex'), runtime: Bun.version, hardware: 'Linux desktop CPU; synthetic DOM/Canvas/WebGL driver, no GPU or browser', caveats: 'Ingest is pack/unpack only, not host IO. Worker default 100 iterations (no convergence threshold). Canvas uses bounded visible detail; full-prefixed timings use full-scene fake-WebGL command submission. Neither measures CSS layout, shader compilation, rasterization, native paints or FPS. Memory is noisy heap observation, not a leak proof.', results };
  mkdirSync('.workspace/evidence', { recursive: true }); writeFileSync(`.workspace/evidence/performance-${label}.json`, JSON.stringify(receipt, null, 2) + '\n');
}, 300000);
