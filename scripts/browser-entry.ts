import { buildProjection, filterNodes } from '../src/core/projection';
import { digest } from '../src/core/declaration';
import { defaults } from '../src/settings';
import { DetailRenderer, gpuStatus } from '../src/renderer';
declare const __WORKER_SOURCE__: string;
const state = window as unknown as { result?: unknown; failure?: string };
async function main() {
  const start = performance.now(), tasks: number[] = [];
  new PerformanceObserver(list => { for (const t of list.getEntries()) tasks.push(t.duration); }).observe({ entryTypes: ['longtask'] });
  const input = await (await fetch('/fixture.json')).json();
  const settings = defaults('synthetic@1'); settings.declaration = input.declaration;
  const p = buildProjection(input.rows, settings.declaration), snapshot = await digest({ rows: input.rows, declaration: settings.declaration, layout: settings.layout });
  const url = URL.createObjectURL(new Blob([__WORKER_SOURCE__], { type: 'text/javascript' }));
  const worker = new Worker(url), workerStart = performance.now();
  const answer = await new Promise<{ positions: Float32Array; milliseconds: number }>((resolve, reject) => {
    worker.onerror = e => reject(new Error(e.message)); worker.onmessage = e => e.data.error ? reject(new Error(e.data.error)) : resolve(e.data);
    worker.postMessage({ input: { count: p.paths.length, source: p.source, target: p.target, seed: Number.parseInt(snapshot.slice(0, 8), 16) }, options: settings.layout });
  });
  worker.terminate(); URL.revokeObjectURL(url);
  const workerWallMs = performance.now() - workerStart, renderer = new DetailRenderer(document.getElementById('graph')!, p, answer.positions, filterNodes(p), settings, () => {}, () => {});
  renderer.sigma.refresh();
  const firstViewMs = performance.now() - start, intervals: number[] = [], camera = renderer.sigma.getCamera(), frameStart = performance.now();
  let previous = frameStart, i = 0;
  await new Promise<void>(resolve => {
    function frame(now: number) {
      intervals.push(now - previous); previous = now; i++;
      camera.setState({ x: 0.5 + Math.sin(i / 35) * 0.12, y: 0.5 + Math.cos(i / 41) * 0.12, ratio: 0.9 + Math.sin(i / 49) * 0.1 }); renderer.sigma.refresh({ partialGraph: {}, skipIndexation: true });
      if (now - frameStart < 3000) requestAnimationFrame(frame); else resolve();
    }
    requestAnimationFrame(frame);
  });
  for (const canvas of document.querySelectorAll('canvas')) { const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl'); gl?.finish(); }
  const frames = intervals.slice(5).sort((a, b) => a - b);
  const lt = tasks.sort((a, b) => a - b);
  state.result = { nodes: p.paths.length, edges: p.source.length, notes: input.rows.length, iterations: settings.layout.iterations, layoutMs: answer.milliseconds, workerWallMs, firstViewMs,
    samples: frames.length, fps: 1000 / (frames.reduce((a, b) => a + b, 0) / frames.length), p95FrameMs: frames[Math.floor(frames.length * 0.95)],
    longTasks: tasks.length, p95LongTaskMs: lt[Math.floor(lt.length * 0.95)] ?? 0, gpu: gpuStatus(), labels: true };
}
main().catch(e => { state.failure = String(e); });
