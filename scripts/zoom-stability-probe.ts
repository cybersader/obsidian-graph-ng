// AUTHORING ONLY until a separately permitted local browser/GPU verification slot.
// Reuses existing browser-benchmark Playwright/esbuild/GLSL tooling; no new dependency.
import { chromium } from 'playwright';
import { build } from 'esbuild';
import { glsl } from './glsl.mjs';
import { classifyContext, backendAccepted, probeOutcome } from './zoom-stability-support';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const sha = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
if (!process.env.CHROME_BIN) throw new Error('Select an existing permitted browser with CHROME_BIN; no browser download');
const directory = `.workspace/evidence/zoom-stability-${Date.now()}`, sourceSha = sha(await readFile('src/webgl-renderer.ts'));
await mkdir(directory, { recursive: true });
const bundle = await build({ entryPoints: ['scripts/zoom-stability-entry.ts'], plugins: [glsl], bundle: true, format: 'iife', platform: 'browser', write: false, define: { __ZOOM_SOURCE_SHA__: JSON.stringify(sourceSha) } });
const js = bundle.outputFiles[0]!.text, receipt: any = { sourceSha, harnessBundleSha: sha(js), scope: 'actual source renderer in local synthetic browser harness, not installed main.js or live-tab proof', captures: [], errors: [], executed: false, launchPolicy: { chromiumSandbox: true, attempts: 1, args: ['--use-gl=angle'] }, classificationScope: 'observed API identity; unknown/unmasked-unavailable identity is not hardware proof' };
const server = createServer((req, res) => { res.setHeader('content-type', req.url === '/app.js' ? 'text/javascript' : 'text/html'); res.end(req.url === '/app.js' ? js : '<!doctype html><meta charset="utf-8"><title>Zoom fixture</title><style>body{margin:0}#graph{position:relative;width:800px;height:600px}.graph-ng-overlay{position:absolute;inset:0;pointer-events:none}</style><div id="graph"></div><script src="/app.js"></script>'); });
await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
try {
  browser = await chromium.launch({ executablePath: process.env.CHROME_BIN, headless: true, chromiumSandbox: true, args: ['--use-gl=angle'] }); receipt.browser = browser.version();
  // Exactly one browser launch, two sequential pages, 16 screenshots maximum.
  for (const backend of ['webgl', 'canvas']) {
    const page = await browser.newPage({ viewport: { width: 1024, height: 768 }, deviceScaleFactor: 1 }); page.setDefaultTimeout(30000);
    await page.addInitScript(() => { const w = window as any, NativeWorker = Worker; w.workersCreated = 0; w.Worker = new Proxy(NativeWorker, { construct(target, args) { w.workersCreated++; return Reflect.construct(target, args); } }); });
    page.on('pageerror', error => receipt.errors.push(String(error)));
    const cdp = await page.context().newCDPSession(page);
    try {
      await page.goto(`http://127.0.0.1:${(server.address() as any).port}/?renderer=${backend}`); await page.waitForFunction(() => (window as any).zoomReady || (window as any).zoomFailure);
      const failure = await page.evaluate(() => (window as any).zoomFailure); if (failure) throw new Error(failure);
      for (const dpr of [1, 2]) {
        // Same CSS box, same live renderer; changing only device scale must not rely on ResizeObserver.
        await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1024, height: 768, deviceScaleFactor: dpr, mobile: false });
        for (const [name, ratio] of [['far', 1.6], ['far-step', 1.6 / 1.02], ['mid', 1], ['near', .15]] as const) {
          const beforePixels = await page.evaluate(() => ({ devicePixelRatio: window.devicePixelRatio, viewport: [innerWidth, innerHeight] }), 'zoom-probe-dpr');
          const result: any = await page.evaluate(ratio => (window as any).zoomCapture(ratio), ratio); result.backend = backend; result.name = name; result.intendedDpr = dpr; result.beforePixels = beforePixels;
          receipt.captures.push(result); const image = `${directory}/${backend}-dpr${dpr}-${name}.png`;
          result.beforeScreenshot = await page.evaluate(() => ({ devicePixelRatio: window.devicePixelRatio, viewport: [innerWidth, innerHeight] }), 'zoom-probe-dpr');
          await page.screenshot({ path: image }); result.screenshot = image;
          result.afterScreenshot = await page.evaluate(() => ({ devicePixelRatio: window.devicePixelRatio, viewport: [innerWidth, innerHeight] }), 'zoom-probe-dpr');
          // Preserve evidence even for the baseline's expected DPR failure; inspect all comparisons.
          result.resolutionMatches = result.devicePixelRatio === dpr && result.backing.every((v: number, i: number) => v === Math.round(result.css[i] * dpr)) && (!result.drawingBuffer || result.drawingBuffer.every((v: number, i: number) => v === result.backing[i]));
          result.contextClassification = classifyContext(result); result.backendAccepted = backendAccepted(backend, result);
          // Usable nonhardware evidence completes the bounded matrix; final acceptance still refuses it.
          if (result.sourceSha !== sourceSha || result.workersCreated !== 0 || result.glError) throw new Error('SOURCE_OR_RENDERER_PATH_MISMATCH');
        }
      }
    } finally { await page.evaluate(() => (window as any).zoomDispose?.()).catch(() => {}); await cdp.detach(); await page.close(); }
  }
  receipt.executed = true;
  receipt.outcome = probeOutcome(receipt);
  if (receipt.outcome.status !== 'accepted') { receipt.failure = receipt.outcome.status === 'acceptance-rejected' ? 'RESOLUTION_OR_HARDWARE_UNPROVEN: inspect structured outcome and retained captures' : 'HARNESS_MATRIX_INVALID: inspect structured outcome and capture boundaries'; process.exitCode = 1; }
} catch (error) { receipt.failure = String(error); receipt.outcome = { schema: 'zoom-probe-outcome.v1', status: 'infrastructure-failure', matrixValid: false, reasons: ['RUNTIME_EXCEPTION'] }; process.exitCode = 1; }
finally { await writeFile(`${directory}/receipt.json`, JSON.stringify(receipt, null, 2)); await browser?.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
