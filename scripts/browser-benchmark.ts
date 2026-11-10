import { chromium } from 'playwright';
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import { fixture, exampleDeclaration } from './fixture';
import os from 'node:os';
await mkdir('.workspace/evidence', { recursive: true }); await mkdir('test-screenshots', { recursive: true });
const worker = await build({ entryPoints: ['src/layout-worker.ts'], bundle: true, format: 'iife', write: false, platform: 'browser' });
const entry = await build({ entryPoints: ['scripts/browser-entry.ts'], bundle: true, format: 'iife', write: false, platform: 'browser', define: { __WORKER_SOURCE__: JSON.stringify(worker.outputFiles[0]!.text) } });
const results = [], rows = fixture(); let literal = false;
const server = createServer((req, res) => {
  if (req.url === '/fixture.json') { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ rows, declaration: { ...exampleDeclaration, display: { reifiedAsNodes: literal } } })); }
  else if (req.url === '/app.js') { res.setHeader('content-type', 'text/javascript'); res.end(entry.outputFiles[0]!.text); }
  else { res.setHeader('content-type', 'text/html'); res.end('<!doctype html><meta charset="utf-8"><title>Graph benchmark</title><style>body{margin:0;background:#141b26}#graph{width:1280px;height:800px}</style><div id="graph"></div><script src="/app.js"></script>'); }
});
await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
const address = server.address(); if (!address || typeof address === 'string') throw new Error('No server address');
try {
  for (literal of [false, true]) {
    const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN || undefined, headless: true, args: ['--use-gl=angle', '--enable-precise-memory-info'] });
    try {
      const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
      const errors: string[] = []; page.on('pageerror', e => errors.push(String(e)));
      await page.goto(`http://127.0.0.1:${address.port}/`);
      await page.waitForFunction(() => (window as any).result || (window as any).failure, {}, { timeout: 180000 });
      const value = await page.evaluate(() => ({ result: (window as any).result, failure: (window as any).failure }));
      if (value.failure) throw new Error(value.failure);
      const cdp = await page.context().newCDPSession(page); await cdp.send('HeapProfiler.collectGarbage'); const heap = await cdp.send('Runtime.getHeapUsage');
      await page.screenshot({ path: `test-screenshots/browser-${literal ? 'literal' : 'semantic'}.png` });
      results.push({ literal, ...value.result, mainHeapMiB: heap.usedSize / 1048576, browser: browser.version(), errors });
      console.log(JSON.stringify(results.at(-1)));
    } finally { await browser.close(); }
  }
} finally { await new Promise<void>(resolve => server.close(() => resolve())); }
await writeFile('.workspace/evidence/browser-benchmark.json', JSON.stringify({ command: 'bun scripts/browser-benchmark.ts', cpu: os.cpus()[0]?.model, ram: os.totalmem(), viewport: '1280x800 DPR1', repetitions: 1, results }, null, 2));
