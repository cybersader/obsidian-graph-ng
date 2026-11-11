import { defaults } from '../src/settings';
import { DetailRenderer, GroupRenderer, gpuStatus } from '../src/renderer';
import { WorkerPipeline, LAYOUT_PRODUCER, type DetailResult, type LayoutResult, type ProjectResult } from '../src/pipeline';
import { packRows } from '../src/core/columns';
import { BinaryLayoutStore, type BinaryGeneration, type BinaryAdapter } from '../src/core/binary-layout';
import { yieldTask } from '../src/core/scheduler';
import type { GroupProjection } from '../src/core/group-projection';
declare const __WORKER_SOURCE__: string;
const state = window as unknown as { result?: unknown; failure?: string; groupReady?: boolean; fixtureMetadata?: unknown };
class MemoryDisk implements BinaryAdapter {
  private files = new Map<string, Uint8Array>(); private dirs = new Set<string>();
  async exists(p: string) { return this.files.has(p) || this.dirs.has(p); }
  async mkdir(p: string) { this.dirs.add(p); }
  async stat(p: string) { const b = this.files.get(p); return b ? { size: b.length } : null; }
  async read(p: string) { return new TextDecoder().decode(this.files.get(p)!); }
  async write(p: string, s: string) { this.files.set(p, new TextEncoder().encode(s)); }
  async readBinary(p: string) { return this.files.get(p)!.slice().buffer; }
  async writeBinary(p: string, b: ArrayBuffer) { this.files.set(p, new Uint8Array(b).slice()); }
  async rename(from: string, to: string) { for (const [p, b] of [...this.files]) if (p === from || p.startsWith(from + '/')) { this.files.set(to + p.slice(from.length), b); this.files.delete(p); } }
  async rmdir(p: string) { for (const k of this.files.keys()) if (k.startsWith(p + '/')) this.files.delete(k); }
}
const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
const summarize = (values: number[]) => { const sorted = values.slice().sort((a, b) => a - b); return { count: values.length, p95Ms: sorted[Math.floor(sorted.length * .95)] ?? 0, maxMs: sorted.at(-1) ?? 0, durations: values }; };
async function main() {
  // This is the host's metadata-ready origin, not network/JSON fixture ingestion.
  const input = await (await fetch('/fixture.json')).json(); state.fixtureMetadata = input;
  const settings = defaults('synthetic@1'); settings.declaration = input.declaration;
  const tasks: PerformanceEntry[] = [];
  const observer = new PerformanceObserver(list => tasks.push(...list.getEntries())); observer.observe({ type: 'longtask', buffered: false });
  const url = URL.createObjectURL(new Blob([__WORKER_SOURCE__], { type: 'text/javascript' }));
  let pipeline = new WorkerPipeline(new Worker(url), () => settings.workerTimeoutMs);
  const disk = new MemoryDisk(), store = new BinaryLayoutStore(disk, { ...settings.cache, directory: 'cache/local', cachedDeclarations: 1 }, yieldTask);
  const container = document.getElementById('graph')!, config = { declaration: settings.declaration, layout: settings.layout, source: 'synthetic@1/local', groupLevel: 0, streamEveryIterations: settings.streamEveryIterations };
  let group: GroupRenderer | undefined, firstGroupMs = 0, streamed = 0;
  const start = performance.now();
  pipeline.onGroups = event => { group?.dispose(); container.replaceChildren(); group = new GroupRenderer(container, event.projection, settings, () => {}, () => {}); firstGroupMs = performance.now() - start; state.groupReady = true; };
  pipeline.onPositions = event => { streamed++; pipeline.recycle(event.positions.buffer as ArrayBuffer); };
  await pipeline.request(1, { kind: 'configure', config });
  for (let i = 0; i < input.rows.length; i += settings.ingest.chunkRows) {
    await pipeline.request(1, { kind: 'rows', columns: packRows(input.rows.slice(i, i + settings.ingest.chunkRows), settings.declaration), reset: i === 0 }); await yieldTask();
  }
  const built = await pipeline.request<ProjectResult>(1, { kind: 'project' });
  let detail = await pipeline.request<DetailResult>(1, { kind: 'detail' });
  const answer = await pipeline.request<LayoutResult>(1, { kind: 'layout' });
  await frame(); const coldReady = performance.now();
  const generation = await pipeline.request<BinaryGeneration>(1, { kind: 'encode' }); await store.write(generation);
  const cacheWriteEnd = performance.now(); await frame();
  group?.dispose(); container.replaceChildren();
  let renderer = await DetailRenderer.create(container, detail.projection, answer.positions, detail.visible, settings, () => {}, () => {}, detail.colors);
  renderer.refresh(); await frame(); const firstViewMs = performance.now() - start, detailEnd = performance.now();
  // A new worker exercises binary decoding, cold fact ingestion and live verification,
  // not merely an in-memory position hit. Disk I/O is simulated, and named in the receipt.
  const coldRendererTimings = { ...renderer.timings }, disposeStart = performance.now();
  renderer.dispose(); const disposeMs = performance.now() - disposeStart; container.replaceChildren(); pipeline.dispose(); pipeline = new WorkerPipeline(new Worker(url), () => settings.workerTimeoutMs);
  const warmStart = performance.now();
  const hashes = await pipeline.request<{ declarationHash: string }>(2, { kind: 'configure', config });
  const loaded = await store.latest(hashes.declarationHash);
  const cached = await pipeline.request<{ groups?: GroupProjection }>(2, { kind: 'load', generation: loaded! });
  if (cached.groups) { group = new GroupRenderer(container, cached.groups, settings, () => {}, () => {}); container.dataset.status = `cached · verifying 0 of ${input.rows.length}`; }
  await frame(); const warmGroupMs = performance.now() - warmStart;
  for (let i = 0; i < input.rows.length; i += settings.ingest.chunkRows) { await pipeline.request(2, { kind: 'rows', columns: packRows(input.rows.slice(i, i + settings.ingest.chunkRows), settings.declaration), reset: i === 0 }); await yieldTask(); }
  await pipeline.request(2, { kind: 'project' }); detail = await pipeline.request<DetailResult>(2, { kind: 'detail' });
  const warm = await pipeline.request<LayoutResult>(2, { kind: 'layout' });
  group?.dispose(); container.replaceChildren(); container.dataset.status = 'verified';
  renderer = await DetailRenderer.create(container, detail.projection, warm.positions, detail.visible, settings, () => {}, () => {}, detail.colors);
  renderer.refresh(); await frame(); const warmEnd = performance.now(), warmOpenMs = warmEnd - warmStart;
  const intervals: number[] = [], frameStart = performance.now(); let previous = frameStart, i = 0;
  await new Promise<void>(resolve => {
    function sample(now: number) {
      intervals.push(now - previous); previous = now; i++;
      renderer.setCamera(.5 + Math.sin(i / 35) * .12, .5 + Math.cos(i / 41) * .12, .9 + Math.sin(i / 49) * .1);
      if (now - frameStart < 3000) requestAnimationFrame(sample); else resolve();
    }
    requestAnimationFrame(sample);
  });
  (window as any).graphRenderer = renderer;
  // Second-view regression seam: dispose this view and open a fresh renderer in the same page.
  (window as any).reopenGraph = async () => {
    const previous = renderer; previous.dispose(); container.replaceChildren();
    renderer = await DetailRenderer.create(container, detail.projection, warm.positions, detail.visible, settings, () => {}, () => {}, detail.colors);
    renderer.refresh(); await frame(); (window as any).graphRenderer = renderer; return previous;
  };
  await yieldTask(); tasks.push(...observer.takeRecords()); observer.disconnect(); pipeline.dispose(); URL.revokeObjectURL(url);
  const between = (a: number, b: number) => summarize(tasks.filter(t => t.startTime >= a && t.startTime < b).map(t => t.duration));
  const frames = intervals.slice(5).sort((a, b) => a - b), open = between(start, coldReady), warmTasks = between(warmStart, warmEnd);
  state.result = { nodes: built.nodes, edges: built.edges, notes: input.rows.length, iterations: settings.layout.iterations, streamEveryIterations: settings.streamEveryIterations, streamed,
    layoutMs: answer.milliseconds, firstGroupMs, coldReadyMs: coldReady - start, firstViewMs, warmGroupMs, warmOpenMs, warmCacheHit: warm.cached,
    longTasks: open.count, p95LongTaskMs: open.p95Ms, openTasks: open, cacheWriteTasks: between(coldReady, cacheWriteEnd), detailTasks: between(cacheWriteEnd, detailEnd), warmTasks,
    samples: frames.length, fps: 1000 / (frames.reduce((a, b) => a + b, 0) / frames.length), p95FrameMs: frames[Math.floor(frames.length * .95)], gpu: gpuStatus(), labels: true,
    coldRendererTimings, disposeMs, rendererTimings: renderer.timings, origin: 'after synthetic host metadata JSON decode', warmMethod: 'new worker + binary memory-disk decode + full live verification + first instanced node frame; not app restart or physical disk' };
}
main().catch(e => { state.failure = String(e); });
