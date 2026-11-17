/** Synthetic, serial actual-worker acceptance. Run under /tmp/graph-ng-harness.lock.
 * No downloaded browser, real vault, server mode or remote publication. */
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
const root = process.cwd(), dir = path.join(root, '.workspace/evidence/wasm-kernel');
mkdirSync(dir, { recursive: true });
const memory = execFileSync('free', ['-g'], { encoding: 'utf8' }); console.log(memory);
const available = Number(memory.split('\n').find(s => s.startsWith('Mem:')).trim().split(/\s+/).at(-1));
if (available < 8) throw Error(`Need >=8 GiB available; got ${available}`);
const baseline = '3d7096b', common = { bundle: true, minify: true, format: 'iife', platform: 'browser', target: 'es2022' };
await build({ ...common, entryPoints: ['src/layout-worker.ts'], outfile: path.join(dir, 'baseline-worker.js'), plugins: [{ name: 'frozen-baseline', setup(b) {
  b.onLoad({ filter: /[/\\]src[/\\].*\.ts$/ }, args => ({ contents: execFileSync('git', ['show', `${baseline}:${path.relative(root, args.path)}`], { encoding: 'utf8' }), loader: 'ts' }));
} }] });
await build({ ...common, entryPoints: ['src/layout-worker.ts'], outfile: path.join(dir, 'after-worker.js') });
await build({ ...common, entryPoints: ['scripts/wasm-kernel-bridge.ts'], outfile: path.join(dir, 'bridge.js') });
// A separate cold realm proves the selected backend under actual worker CSP.
await build({ ...common, entryPoints: ['scripts/wasm-kernel-probe.ts'], outfile: path.join(dir, 'probe-worker.js') });
const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.searchParams.has('policy')) res.setHeader('Content-Security-Policy', `script-src 'self'${url.searchParams.get('policy') === 'allow' ? " 'wasm-unsafe-eval'" : ''}; worker-src 'self'`);
  if (url.pathname === '/') { res.setHeader('content-type', 'text/html'); res.end('<!doctype html><title>Synthetic scalar worker measurement</title><script src="/bridge.js"></script>'); return; }
  if (['/bridge.js', '/baseline-worker.js', '/after-worker.js', '/probe-worker.js'].includes(url.pathname)) { res.setHeader('content-type', 'text/javascript'); res.end(readFileSync(path.join(dir, url.pathname.slice(1)))); return; }
  res.writeHead(404).end();
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const receipt = { baseline, hardware: 'hybrid x86 desktop; no mobile or laptop acceptance', engine: '', results: [], csp: [], memory: [], errors: [] };
const save = () => writeFileSync(path.join(dir, 'browser-results.json'), JSON.stringify(receipt, null, 2) + '\n');
let browser;
try {
  browser = await chromium.launch({ headless: true, args: ['--js-flags=--expose-gc'], ...(process.env.GRAPH_CHROMIUM ? { executablePath: process.env.GRAPH_CHROMIUM } : {}) });
  receipt.engine = browser.version();
  const page = await browser.newPage();
  page.on('console', msg => console.log(msg.text()));
  page.on('pageerror', e => console.error(e));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  for (const count of [5000, 20000, 49000]) {
    const results = await page.evaluate(async count => {
      const { WorkerPipeline, defaultDeclaration, packRows, DEFAULT_LAYOUT, initialPositions, kernelFixture } = globalThis;
      const med = xs => { const sorted = xs.toSorted((a, b) => a - b); return (sorted[2] + sorted[3]) / 2; };
      const bits = p => new Uint32Array(p.buffer, p.byteOffset, p.length);
      const equal = (a, b) => { const x = bits(a), y = bits(b); return x.length === y.length && x.every((v, i) => v === y[i]); };
      const hash = async p => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', p)), x => x.toString(16).padStart(2, '0')).join('');
      const input = kernelFixture(count), declaration = defaultDeclaration('fixture@1'), results = [];
      const rows = Array.from({ length: count }, (_, i) => ({ path: `note-${String(i).padStart(5, '0')}.md`, properties: {}, links: { 'fixture@1': [] } }));
      for (let e = 0; e < input.source.length; e++) rows[input.source[e]].links['fixture@1'].push(rows[input.target[e]].path);
      const workers = Object.fromEntries(['baseline', 'after'].map(k => [k, new WorkerPipeline(new Worker(`/${k}-worker.js`), () => 120000)]));
      const seed = initialPositions(count, 7 ^ DEFAULT_LAYOUT.seed, DEFAULT_LAYOUT.initialRadius);
      try {
        for (const adjustSizes of [false, true]) {
          const options = { ...DEFAULT_LAYOUT, iterations: 100, relaxIterations: 100, batchIterations: 5, convergenceThreshold: 0, force: { ...DEFAULT_LAYOUT.force, adjustSizes } };
          const config = { declaration, layout: options, source: 'synthetic-kernel/local', groupLevel: 0, streamEveryIterations: 5 };
          for (const p of Object.values(workers)) {
            await p.request(1, { kind: 'configure', config });
            await p.request(1, { kind: 'rows', reset: true, columns: packRows(rows, declaration) });
            await p.request(1, { kind: 'project' });
            p.onPositions = e => p.recycle(e.positions.buffer);
            await p.request(1, { kind: 'layout' });
          }
          const run = async k => { const p = workers[k], initial = seed.slice(), start = performance.now(); const result = await p.request(1, { kind: 'recompute', options, initial }); return { ms: performance.now() - start, ...result }; };
          for (let warm = 0; warm < 2; warm++) for (const k of ['baseline', 'after']) await run(k);
          const samples = { baseline: [], after: [] }; let final;
          for (let pair = 0; pair < 6; pair++) {
            const values = {}; for (const k of pair % 2 ? ['after', 'baseline'] : ['baseline', 'after']) { values[k] = await run(k); samples[k].push(values[k].ms); }
            if (!equal(values.baseline.positions, values.after.positions)) throw Error(`Coordinate drift ${count}, overlap=${adjustSizes}, pair=${pair}`);
            final = values.after.positions;
            console.log(JSON.stringify({ count, adjustSizes, pair, before: values.baseline.ms, after: values.after.ms, exact: true }));
          }
          const before = med(samples.baseline), after = med(samples.after);
          const row = { count, adjustSizes, iterations: 100, samples, beforeMedianMs: before, afterMedianMs: after, speedup: before / after, bitIdentical: true, sha256: await hash(final) };
          results.push(row); console.log('RESULT ' + JSON.stringify(row));
        }
        const p = workers.after;
        // A frequent stream and a sparse stream exercise both cadence paths.
        for (const every of [1, 1000]) for (const adjustSizes of [false, true]) {
          const stopOptions = { ...DEFAULT_LAYOUT, iterations: 10000, batchIterations: 1000, convergenceThreshold: 0, force: { ...DEFAULT_LAYOUT.force, adjustSizes } };
          await p.request(1, { kind: 'configure', config: { declaration, layout: stopOptions, source: 'synthetic-kernel/local', groupLevel: 0, streamEveryIterations: every } });
          for (const kind of ['layout', 'recompute']) {
            let stopAt = 0, lastIteration = 0, timer;
            p.onPositions = e => { lastIteration = e.iteration; if (!stopAt && every === 1) { stopAt = performance.now(); p.stopLayout(e.revision); } p.recycle(e.positions.buffer); };
            const request = p.request(1, kind === 'layout' ? { kind } : { kind, options: stopOptions, initial: seed.slice() });
            if (every !== 1) timer = setTimeout(() => { stopAt = performance.now(); p.stopLayout(1); }, 150);
            try {
              const result = await request, latencyMs = performance.now() - stopAt;
              if (!stopAt || latencyMs >= 500 || result.settled) throw Error(`Stop regression ${count} ${kind}: ${latencyMs}`);
              const stop = { count, adjustSizes, every, kind, latencyMs, lastIteration, settled: result.settled };
              results.push({ stop }); console.log('STOP ' + JSON.stringify(stop));
            } finally { clearTimeout(timer); }
          }
        }
      } finally { for (const p of Object.values(workers)) p.dispose(); }
      return results;
    }, count);
    receipt.results.push(...results); save();
  }
  for (const count of [20000, 49000]) for (const adjustSizes of [false, true]) {
    const result = await page.evaluate(request => new Promise((resolve, reject) => {
      const w = new Worker('/probe-worker.js');
      const timer = setTimeout(() => { w.terminate(); reject(Error('Memory probe deadline')); }, 60000);
      w.onmessage = e => { clearTimeout(timer); w.terminate(); resolve(e.data); };
      w.onerror = e => { clearTimeout(timer); w.terminate(); reject(Error(e.message)); };
      w.postMessage(request);
    }), { kind: 'memory', count, adjustSizes });
    if (result.error) throw Error(result.error);
    receipt.memory.push(result); save(); console.log('MEMORY ' + JSON.stringify(result));
  }
  for (const policy of ['deny', 'allow']) {
    const result = await page.evaluate(policy => new Promise((resolve, reject) => {
      const w = new Worker('/probe-worker.js?policy=' + policy);
      const timer = setTimeout(() => { w.terminate(); reject(Error('CSP probe deadline')); }, 10000);
      w.onmessage = e => { clearTimeout(timer); w.terminate(); resolve(e.data); };
      w.onerror = e => { clearTimeout(timer); w.terminate(); reject(Error(e.message)); };
      w.postMessage(null);
    }), policy);
    if (result.error || !result.exact || result.backend !== (policy === 'deny' ? 'js' : 'wasm-scalar')) throw Error('CSP fallback mismatch: ' + JSON.stringify(result));
    receipt.csp.push({ policy, ...result }); save();
  }
} catch (e) { receipt.errors.push(String(e)); save(); throw e; }
finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
