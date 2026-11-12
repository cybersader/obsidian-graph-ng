import { chromium, type Page } from 'playwright';
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { chooseFixture, fixtureShape, exampleDeclaration } from './fixture';
import os from 'node:os';
import { glsl } from './glsl.mjs';
// Each mode runs in its own Bun process. Bun 1.3.x breaks the Playwright
// --remote-debugging-pipe transport on a SECOND browser launch in one process once
// CDP replies reach a few MB (full-page PNG screenshots): the screenshot never
// returns, Chrome exits on a broken pipe and evaluate/close appear to hang. Node
// runs the same sequence cleanly; one launch per process avoids the runtime fault.
const MODES = ['semantic', 'literal'] as const;
const mode = process.env.GRAPH_BENCH_MODE as typeof MODES[number] | undefined, shape = fixtureShape();
await mkdir('.workspace/evidence', { recursive: true }); await mkdir('test-screenshots', { recursive: true });
if (!mode) {
  const results: unknown[] = [];
  for (const m of MODES) {
    const out = `.workspace/evidence/browser-benchmark-${m}.part.json`; await rm(out, { force: true });
    const code = await new Promise<number | null>(resolve => {
      const child = spawn(process.execPath, [process.argv[1]!], { stdio: 'inherit', env: { ...process.env, GRAPH_BENCH_MODE: m } });
      const timer = setTimeout(() => child.kill('SIGKILL'), Number(process.env.GRAPH_BENCH_TIMEOUT_MS ?? 600000));
      child.on('exit', c => { clearTimeout(timer); resolve(c); });
    });
    if (code !== 0) throw new Error(`BENCH_MODE_FAILED: ${m} exited ${code}`);
    results.push(JSON.parse(await readFile(out, 'utf8'))); await rm(out, { force: true });
  }
  await writeFile('.workspace/evidence/browser-benchmark.json', JSON.stringify({ command: 'bun scripts/browser-benchmark.ts', process: 'one Bun process and one browser launch per mode', fixture: shape, cpu: os.cpus()[0]?.model, ram: os.totalmem(), viewport: '1280x800 DPR1', repetitions: 1, results }, null, 2));
  process.exit(0);
}
const literal = mode === 'literal', tag = `browser-${shape === 'clustered' ? 'clustered-' : ''}${mode}`;
const worker = await build({ entryPoints: ['src/layout-worker.ts'], bundle: true, format: 'iife', write: false, platform: 'browser' });
const entry = await build({ plugins: [glsl], entryPoints: ['scripts/browser-entry.ts'], bundle: true, format: 'iife', write: false, platform: 'browser', define: { __WORKER_SOURCE__: JSON.stringify(worker.outputFiles[0]!.text) } });
const rows = chooseFixture(shape)();
const server = createServer((req, res) => {
  if (req.url === '/fixture.json') { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ rows, declaration: { ...exampleDeclaration, display: { reifiedAsNodes: literal } } })); }
  else if (req.url === '/app.js') { res.setHeader('content-type', 'text/javascript'); res.end(entry.outputFiles[0]!.text); }
  else { res.setHeader('content-type', 'text/html'); res.end('<!doctype html><meta charset="utf-8"><title>Graph benchmark</title><style>body{margin:0;background:#141b26}#graph{width:1280px;height:800px}</style><div id="graph"></div><script src="/app.js"></script>'); }
});
await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
const address = server.address(); if (!address || typeof address === 'string') throw new Error('No server address');
/** Hover, select, then lose and restore the context of whichever view is current. */
async function interact(page: Page, suffix: string) {
  for (const theme of ['light', 'dark']) {
    const point = await page.evaluate(async theme => {
      const r = (window as any).graphRenderer, c = r.canvas.parentElement;
      c.style.setProperty('--graph-ng-bg', theme === 'light' ? '#f4f5f8' : '#141b26');
      c.style.setProperty('--graph-ng-text', theme === 'light' ? '#18212e' : '#edf4ff');
      c.style.setProperty('--graph-ng-edge', theme === 'light' ? '#a4b0c2' : '#43566e'); r.refreshTheme(); await new Promise(requestAnimationFrame);
      for (let i = 0; i < r.visible.length; i++) if (r.visible[i]) { const p = r.screenPoint(i); if (p.x > 50 && p.x < 1230 && p.y > 50 && p.y < 750 && r.pick(p.x, p.y) === i) return { ...p, id: i }; }
      throw new Error('NO_PICKABLE_NODE');
    }, theme);
    await page.mouse.move(point.x, point.y); await page.waitForFunction(id => (window as any).graphRenderer.hovered === id, point.id);
    await page.screenshot({ path: `test-screenshots/${tag}${suffix}-${theme}-hover.png` });
    await page.mouse.click(point.x, point.y); await page.waitForFunction(id => (window as any).graphRenderer.selected === id, point.id);
    await page.screenshot({ path: `test-screenshots/${tag}${suffix}-${theme}-selected.png` });
  }
  await page.evaluate(() => { const r = (window as any).graphRenderer, ext = r.gl.getExtension('WEBGL_lose_context'); if (!ext) throw new Error('NO_CONTEXT_LOSS_EXTENSION'); ext.loseContext(); (window as any).restoreGraph = () => ext.restoreContext(); });
  await page.waitForFunction(() => (window as any).graphRenderer.canvas.dataset.context === 'lost');
  await page.evaluate(() => (window as any).restoreGraph());
  await page.waitForFunction(() => (window as any).graphRenderer.canvas.dataset.context === 'restored');
  await page.screenshot({ path: `test-screenshots/${tag}${suffix}-restored.png` });
}
let closing = false;
const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN || undefined, headless: true, args: ['--use-gl=angle', '--enable-precise-memory-info'] });
// A dead transport must fail the run, never wait on a timer forever.
browser.on('disconnected', () => { if (!closing) { console.error('BROWSER_DISCONNECTED'); process.exit(3); } });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  page.setDefaultTimeout(120000);
  const errors: string[] = []; page.on('pageerror', e => errors.push(String(e)));
  const trace = process.env.GRAPH_TRACE ? await page.context().newCDPSession(page) : undefined;
  if (trace) await trace.send('Tracing.start', { categories: 'devtools.timeline,toplevel,v8,v8.execute,blink.user_timing', transferMode: 'ReturnAsStream' });
  await page.goto(`http://127.0.0.1:${address.port}/`);
  await page.waitForFunction(() => (window as any).groupReady || (window as any).failure, {}, { timeout: 180000 });
  await page.screenshot({ path: `test-screenshots/${tag}-groups.png` });
  await page.waitForFunction(() => (window as any).result || (window as any).failure, {}, { timeout: 180000 });
  const value = await page.evaluate(() => ({ result: (window as any).result, failure: (window as any).failure }));
  if (value.failure) throw new Error(value.failure);
  if (trace) {
    const done = new Promise<any>(resolve => trace.once('Tracing.tracingComplete', resolve)); await trace.send('Tracing.end');
    const { stream } = await done; let data = '';
    for (;;) { const chunk = await trace.send('IO.read', { handle: stream }); data += chunk.data; if (chunk.eof) break; }
    await trace.send('IO.close', { handle: stream }); await trace.detach(); await writeFile(`.workspace/evidence/trace-${mode}.json`, data);
  }
  const cdp = await page.context().newCDPSession(page); await cdp.send('HeapProfiler.collectGarbage'); const heap = await cdp.send('Runtime.getHeapUsage');
  await page.screenshot({ path: `test-screenshots/${tag}.png` });
  const rendererChecks = await page.evaluate(async () => {
    const r = (window as any).graphRenderer, buffers = r.buffers, positions = r.positions;
    let messages = 0; const original = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (...args: any[]) { messages++; return original.apply(this, args as any); };
    const before = r.paletteUploads;
    try { r.canvas.parentElement.style.setProperty('--graph-ng-bg', '#f4f5f8'); r.refreshTheme(); await new Promise(requestAnimationFrame); }
    finally { Worker.prototype.postMessage = original; }
    if (messages || r.buffers !== buffers || r.positions !== positions || r.paletteUploads !== before + 1) throw new Error('THEME_REBUILT_GRAPH');
    r.setCamera(.5, .5, .2); await new Promise(requestAnimationFrame);
    return { themeWorkerMessages: messages, paletteUploadDelta: r.paletteUploads - before, stableBuffers: r.buffers === buffers, glError: r.gl.getError(), labelGlyphs: r.atlas.levels.map((l: Float32Array) => l.length / 10) };
  });
  if (rendererChecks.glError) throw new Error(`GL_ERROR: ${rendererChecks.glError}`);
  await interact(page, '');
  // Regression: a second view in the same page after hover/select/context loss must
  // run hover/select/context loss again, and the first view must leave nothing scheduled.
  const secondView = await page.evaluate(async () => {
    const old = await (window as any).reopenGraph(), r = (window as any).graphRenderer;
    // Late callbacks into the disposed view (theme change, a queued refresh) must schedule nothing.
    old.refresh(); old.refreshTheme(); await new Promise(requestAnimationFrame); await new Promise(resolve => setTimeout(resolve, 100));
    const oldFrames = (old.frameId ? 1 : 0) + (old.frameTimer !== undefined ? 1 : 0);
    return { oldDetached: !old.canvas.isConnected, oldScheduled: oldFrames, newConnected: r.canvas.isConnected, distinct: old !== r };
  });
  if (!secondView.oldDetached || secondView.oldScheduled || !secondView.newConnected || !secondView.distinct) throw new Error(`SECOND_VIEW_LEAK: ${JSON.stringify(secondView)}`);
  await interact(page, '-second');
  const result = { literal, fixture: shape, ...value.result, rendererChecks: { ...rendererChecks, contextRestored: true, secondView: { ...secondView, hoverSelectRestored: true } }, mainHeapMiB: heap.usedSize / 1048576, backingStorageMiB: (heap.backingStorageSize ?? 0) / 1048576, browser: browser.version(), errors };
  console.log(JSON.stringify(result));
  await writeFile(`.workspace/evidence/browser-benchmark-${mode}.part.json`, JSON.stringify(result));
} finally {
  closing = true; await browser.close();
  server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
}
process.exit(0);
