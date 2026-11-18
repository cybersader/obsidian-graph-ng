// Run with flock -w 1800 /tmp/graph-ng-harness.lock. Synthetic worker only.
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { chromium } from 'playwright';
import { build } from 'esbuild';
import { wgsl } from './wgsl.mjs';
const [mode, kind, countArg, shape = 'community'] = process.argv.slice(2), count = Number(countArg);
if (!['community','scale-free','grid'].includes(shape) || !['default', 'enabled'].includes(mode) || !['probe', 'quality', 'auto', 'slow', 'absent', 'repeat', 'stop'].includes(kind) || !Number.isInteger(count) || count < 2 || count > 49000) throw Error('Expected default|enabled, probe|quality|auto|slow|absent|repeat|stop, 2..49000');
if (Number(execFileSync('free', ['-g'], { encoding: 'utf8' }).split('\n').find(l => l.startsWith('Mem:')).trim().split(/\s+/).at(-1)) < 8) throw Error('Less than 8 GB available');
const args = mode === 'enabled' ? ['--enable-unsafe-webgpu', '--use-angle=vulkan', '--enable-features=Vulkan', '--ignore-gpu-blocklist'] : [];
const bundled = await build({ entryPoints: ['scripts/layout-engine-bench-worker.mjs'], bundle: true, write: false, platform: 'browser', plugins: [wgsl] });
const server = createServer((req, res) => {
  res.setHeader('Content-Type', req.url === '/worker.js' ? 'application/javascript' : 'text/html');
  res.end(req.url === '/worker.js' ? bundled.outputFiles[0].contents : '<!doctype html><title>Synthetic layout benchmark</title>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({ executablePath: process.env.CHROME_BIN, headless: true, args });
  const page = await browser.newPage();
  page.on('console', msg => { if (msg.type() === 'log') console.error(msg.text()); });
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  // Record the page probe separately. A cold Chromium GPU process can return null
  // on its first adapter request even when the subsequent worker can use Vulkan.
  const pageAdapter = mode === 'enabled' ? await page.evaluate(async () => !!(await navigator.gpu?.requestAdapter())) : null;
  const runs = [];
  for (const preference of kind === 'repeat' ? ['graphics', 'graphics'] : kind === 'stop' ? ['graphics', 'processor'] : ['auto']) {
    runs.push(await page.evaluate(job => new Promise((resolve, reject) => {
      const worker = new Worker('/worker.js'); let stopAt;
      const finish = fn => value => { clearTimeout(timer); worker.terminate(); fn(value); };
      const timer = setTimeout(() => finish(reject)(Error('Benchmark exceeded its time limit')), job.kind === 'quality' ? 6600000 : 3600000);
      worker.onerror = e => finish(reject)(Error(e.message));
      worker.onmessage = ({ data }) => {
        if (data.progress) { console.log(JSON.stringify(data.progress)); return; }
        if (data.frame) { if (stopAt === undefined) { stopAt = performance.now(); worker.postMessage('stop'); } return; }
        if (data.error) { finish(reject)(Error(data.error)); return; }
        finish(resolve)({ ...data, ...(stopAt === undefined ? {} : { stopRoundTripMs: performance.now() - stopAt }) });
      };
      worker.postMessage(job);
    }), { count, kind, preference, shape }));
  }
  console.log(JSON.stringify({ mode, args, kind, count, shape, pageAdapter, browser: browser.version(), runs }, null, 2));
} finally { try { await browser?.close(); } finally { await new Promise(resolve => server.close(resolve)); } }
