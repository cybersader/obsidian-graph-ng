// Run with flock -w 1800 /tmp/graph-ng-harness.lock. Synthetic worker only.
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { parseArgs } from 'node:util';
import { chromium } from 'playwright';
import { build } from 'esbuild';
import { wgsl } from './wgsl.mjs';
const { positionals, values } = parseArgs({ allowPositionals: true, options: {
  'max-iterations': { type: 'string' }, 'checkpoint-ms': { type: 'string' },
  'verify-fire': { type: 'boolean' }, engine: { type: 'string' }, seeds: { type: 'string' },
} });
const [mode, kind, countArg, shape = 'community'] = positionals, count = Number(countArg);
if (positionals.length > 4 || !['community', 'scale-free', 'grid'].includes(shape) || !['default', 'enabled'].includes(mode) || !['probe', 'quality', 'auto', 'slow', 'absent', 'repeat', 'stop'].includes(kind) || !Number.isInteger(count) || count < 2 || count > 49000) throw Error('Expected default|enabled, probe|quality|auto|slow|absent|repeat|stop, 2..49000, [community|scale-free|grid]');
if (kind !== 'quality' && Object.keys(values).length) throw Error('Experimental options are only valid for quality runs');
const maxIterations = Number(values['max-iterations'] ?? 20000), checkpointMs = Number(values['checkpoint-ms'] ?? 0);
const engine = values.engine ?? 'both', seeds = (values.seeds ?? '17,18,29').split(',').map(Number);
if (!Number.isSafeInteger(maxIterations) || maxIterations < 3 || maxIterations > 100000 ||
    !Number.isSafeInteger(checkpointMs) || (values['checkpoint-ms'] !== undefined && checkpointMs < 100) ||
    !['both', 'cpu', 'gpu'].includes(engine) || seeds.some(seed => ![17, 18, 29].includes(seed)) || new Set(seeds).size !== seeds.length) {
  throw Error('Expected --max-iterations 3..100000, --checkpoint-ms >=100, --engine both|cpu|gpu, --seeds comma-separated subset of 17,18,29');
}
if (values['verify-fire'] && !checkpointMs) throw Error('--verify-fire requires checkpoint measurements');
if (kind === 'quality' && engine !== 'cpu' && mode !== 'enabled') throw Error('GPU quality runs require enabled mode');
const availableGiB = () => Number(execFileSync('free', ['-g'], { encoding: 'utf8' }).split('\n').find(l => l.startsWith('Mem:'))?.trim().split(/\s+/).at(-1));
const args = mode === 'enabled' ? ['--enable-unsafe-webgpu', '--use-angle=vulkan', '--enable-features=Vulkan', '--ignore-gpu-blocklist'] : [];
const bundled = await build({ entryPoints: ['scripts/layout-engine-bench-worker.mjs'], bundle: true, write: false, platform: 'browser', plugins: [wgsl] });
const server = createServer((req, res) => {
  res.setHeader('Content-Type', req.url === '/worker.js' ? 'application/javascript' : 'text/html');
  res.end(req.url === '/worker.js' ? bundled.outputFiles[0].contents : '<!doctype html><title>Synthetic layout benchmark</title>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  // The invoking flock must already be held, including while waiting for memory.
  for (let available; !((available = availableGiB()) >= 8);) {
    if (!Number.isFinite(available)) throw Error('Could not read available memory from free -g');
    console.error(`Waiting for 8 GiB available before browser launch (${available} GiB available)`);
    await delay(5000);
  }
  browser = await chromium.launch({ executablePath: process.env.CHROME_BIN, headless: true, args });
  const page = await browser.newPage();
  page.on('console', msg => { if (msg.type() === 'log') console.error(msg.text()); });
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  // Record the page probe separately. A cold Chromium GPU process can return null
  // on its first adapter request even when the subsequent worker can use Vulkan.
  const pageAdapter = mode === 'enabled' && !(kind === 'quality' && engine === 'cpu') ? await page.evaluate(async () => !!(await navigator.gpu?.requestAdapter())) : null;
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
    }), { count, kind, preference, shape, maxIterations, checkpointMs, engine, seeds, verifyFire: values['verify-fire'] }));
  }
  console.log(JSON.stringify({ mode, args, kind, count, shape, pageAdapter, browser: browser.version(), runs }, null, 2));
} finally { try { await browser?.close(); } finally { await new Promise(resolve => server.close(resolve)); } }
