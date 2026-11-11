import { browser, $ } from '@wdio/globals';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium, type Browser, type CDPSession } from 'playwright';
const literal = Boolean(process.env.GRAPH_LITERAL);
const large = Boolean(process.env.GRAPH_LARGE), software = Boolean(process.env.GRAPH_SOFTWARE);
const tag = `${large ? 'large' : 'small'}${process.env.GRAPH_FIXTURE === 'clustered' ? '-clustered' : ''}${literal ? '-literal' : ''}-${software ? 'software' : 'hardware'}`;
const runDirectory = `.workspace/evidence/runs/native-${tag}-${Date.now()}-${process.pid}`;
const evidence: Record<string, unknown> = { runDirectory, tag, app: '1.13.7', installer: '1.13.7', notes: large ? 60600 : 2000 };
async function ready() { await browser.waitUntil(async () => (await $('.graph-ng-view').getAttribute('data-state')) === 'ready', { timeout: 180000, timeoutMsg: 'Graph did not become ready' }); }
async function open() { await browser.executeObsidianCommand('graph-ng:open'); await ready(); }
/** A ready local view can still be finishing a queued cached refresh that repaints the panel; wait for the verified, idle pass. */
async function settled() { await browser.waitUntil(async () => browser.executeObsidian(({ app }) => { const v = app.workspace.getLeavesOfType('graph-ng')[0]?.view as any; return Boolean(v) && v.contentEl.dataset.state === 'ready' && v.contentEl.dataset.verified === 'true' && !v.refreshing && !v.queued; }), { timeout: 180000, timeoutMsg: 'Graph did not settle' }); }
/** Open the Relationships section unless a preserved open state already shows it. */
async function relationships() { const d = await $('.graph-ng-panel details.graph-ng-relationships'); if (!(await d.getProperty('open'))) await d.$('summary').click(); }
async function screenshot(name: string) { await browser.saveScreenshot(`test-screenshots/${tag}-${name}.png`); }
let profileConnection: Browser | undefined, profileCdp: CDPSession | undefined;
describe('Graph NG synthetic Obsidian path', () => {
  before(async () => {
    await mkdir('test-screenshots', { recursive: true }); await mkdir(runDirectory, { recursive: true });
    await browser.waitUntil(async () => browser.executeObsidian(({ app }) => { const files = app.vault.getMarkdownFiles(); return files.length >= 2000 && files.every(f => app.metadataCache.getFileCache(f) !== null); }), { timeout: 180000, timeoutMsg: 'Synthetic cache indexing not complete' });
    if (process.env.GRAPH_TRACE || process.env.GRAPH_CPU) {
      const address = (browser.capabilities as any)['goog:chromeOptions']?.debuggerAddress;
      assert.ok(address, 'Native trace requires CDP');
      profileConnection = await chromium.connectOverCDP(`http://${address}`);
      profileCdp = await profileConnection.contexts()[0]!.newCDPSession(profileConnection.contexts()[0]!.pages()[0]!);
      if (process.env.GRAPH_TRACE) await profileCdp.send('Tracing.start', { categories: 'devtools.timeline,toplevel,v8,v8.execute,blink.user_timing,disabled-by-default-v8.cpu_profiler', transferMode: 'ReturnAsStream' });
      await profileCdp.send('Performance.enable');
      await profileCdp.send('Profiler.enable'); await profileCdp.send('Profiler.setSamplingInterval', { interval: 500 }); await profileCdp.send('Profiler.start');
    }
    await browser.executeObsidian(() => {
      performance.mark('graph-ng-native-origin');
      const state = window as any; state.graphOpenTasks = [];
      state.graphOpenObserver = new PerformanceObserver(list => state.graphOpenTasks.push(...list.getEntries()));
      state.graphOpenObserver.observe({ type: 'longtask', buffered: false });
    });
    const start = Date.now(); await open(); evidence.coldOpenMs = Date.now() - start;
    evidence.firstGroupMs = Number(await $('.graph-ng-view').getAttribute('data-first-group-ms'));
    evidence.openTasks = await browser.executeObsidian(() => {
      const state = window as any; state.graphOpenTasks.push(...state.graphOpenObserver.takeRecords()); state.graphOpenObserver.disconnect();
      const values = state.graphOpenTasks.map((t: PerformanceEntry) => t.duration).sort((a: number, b: number) => a - b);
      return { count: values.length, p95Ms: values[Math.floor(values.length * .95)] ?? 0, maxMs: values.at(-1) ?? 0, durations: values, entries: state.graphOpenTasks.map((t: PerformanceEntry) => ({ start: t.startTime, duration: t.duration })) };
    });
    evidence.status = await $('.graph-ng-status').getText();
  });
  after(async () => {
    if (profileCdp) evidence.cpuClock = await profileCdp.send('Performance.getMetrics');
    await writeFile(`${runDirectory}/receipt.json`, JSON.stringify(evidence, null, 2), { flag: 'wx' });
    await writeFile(`.workspace/evidence/e2e-${tag}.json`, JSON.stringify(evidence, null, 2));
    if (profileCdp) {
      const { profile } = await profileCdp.send('Profiler.stop'); await writeFile(`${runDirectory}/profile.cpuprofile`, JSON.stringify(profile), { flag: 'wx' }); await writeFile(`.workspace/evidence/native-${tag}.cpuprofile`, JSON.stringify(profile));
      if (process.env.GRAPH_TRACE) {
        const done = new Promise<any>(resolve => profileCdp!.once('Tracing.tracingComplete', resolve)); await profileCdp.send('Tracing.end');
        const { stream } = await done; let data = '';
        for (;;) { const chunk = await profileCdp.send('IO.read', { handle: stream }); data += chunk.data; if (chunk.eof) break; }
        await profileCdp.send('IO.close', { handle: stream }); await writeFile(`${runDirectory}/timeline.json`, data, { flag: 'wx' }); await writeFile(`.workspace/evidence/native-${tag}.trace.json`, data);
      }
      await profileCdp.detach(); await profileConnection!.close();
    }
  });
  it('renders declared groups with counts and opens a contributing carrier', async () => {
    assert.equal(await $('.graph-ng-view').getAttribute('data-nodes'), literal ? '60600' : large ? '16000' : '600');
    assert.equal(await $('.graph-ng-view').getAttribute('data-edges'), literal ? '89200' : large ? '44600' : '1400');
    assert.equal(await $('.graph-ng-view').getAttribute('data-mode'), 'groups');
    assert.equal(await $$('.graph-ng-group-controls button').length, literal ? 7 : 6);
    await screenshot('groups');
    await settled(); await relationships();
    await browser.executeObsidian(({ app }) => (app.workspace.getLeavesOfType('graph-ng')[0]!.view as any).showGroups(true));
    assert.equal(await $('.graph-ng-panel details.graph-ng-relationships').getProperty('open'), true, 'a group re-render must keep an opened section open');
    await $('.graph-ng-edge').click();
    const button = await $('.graph-ng-contribution button'); await button.waitForExist({ timeout: 180000 }); const carrier = await button.getText();
    await screenshot('carriers'); await button.click();
    await browser.waitUntil(async () => browser.executeObsidian(({ app }, path) => app.workspace.getActiveFile()?.path === path, carrier));
    await open();
  });
  it('retains contributing mappings across generation refresh and exposes failed reads with Retry', async () => {
    await $('.graph-ng-toolbar button').click();
    await relationships(); await $('.graph-ng-edge').click();
    await $('.graph-ng-contribution button').waitForExist({ timeout: 15000 });
    await browser.waitUntil(async () => browser.executeObsidian(({ app }) => !(app.workspace.getLeavesOfType('graph-ng')[0]!.view as any).refreshing));
    const state = await browser.executeObsidian(async ({ app }) => {
      const view = app.workspace.getLeavesOfType('graph-ng')[0]!.view as any;
      void view.refresh(); await Promise.resolve(); await Promise.resolve();
      return view.panel.querySelector('.graph-ng-contribution-status')?.dataset.state;
    });
    assert.equal(state, 'refreshing'); await ready();
    await $('.graph-ng-contribution button').waitForExist({ timeout: 15000 });
    await screenshot('carriers-refreshed');
    await $('.graph-ng-toolbar button').click();
    await browser.executeObsidian(({ app }) => {
      const pipeline = (app.workspace.getLeavesOfType('graph-ng')[0]!.view as any).plugin.pipeline, original = pipeline.request.bind(pipeline);
      pipeline.request = (revision: number, request: any) => { if (request.kind === 'contributions') { pipeline.request = original; return Promise.reject(new Error('synthetic contribution failure')); } return original(revision, request); };
    });
    await relationships(); await $('.graph-ng-edge').click();
    await browser.waitUntil(async () => (await $('.graph-ng-contribution-status').getText()).includes('synthetic contribution failure'));
    await $('.graph-ng-contribution-status button').click();
    await $('.graph-ng-contribution button').waitForExist({ timeout: 15000 });
    evidence.contributionRecovery = { retainedAfterRefresh: true, failedReadVisible: true, explicitRetry: true };
  });
  it('drills into members and opens an individual graph node when GPU is available', async () => {
    await $('.graph-ng-toolbar button').click();
    await $('.graph-ng-group-controls button').click();
    const member = await $('.graph-ng-member'), path = await member.getText(); await member.click();
    await browser.waitUntil(async () => browser.executeObsidian(({ app }, path) => app.workspace.getActiveFile()?.path === path, path));
    await open();
    await browser.executeObsidian(() => { const state = window as any; state.graphDetailTasks = []; state.graphDetailObserver = new PerformanceObserver(list => state.graphDetailTasks.push(...list.getEntries())); state.graphDetailObserver.observe({ type: 'longtask', buffered: false }); });
    await $('.graph-ng-toolbar button:nth-child(2)').click();
    await browser.waitUntil(async () => (await $('.graph-ng-view').getAttribute('data-mode')) !== 'nodes-building');
    evidence.detailTasks = await browser.executeObsidian(() => { const state = window as any; state.graphDetailTasks.push(...state.graphDetailObserver.takeRecords()); state.graphDetailObserver.disconnect(); const durations = state.graphDetailTasks.map((t: PerformanceEntry) => t.duration).sort((a: number, b: number) => a - b); return { count: durations.length, durations, entries: state.graphDetailTasks.map((t: PerformanceEntry) => ({ start: t.startTime, duration: t.duration })), p95Ms: durations.length ? durations[Math.floor(durations.length * .95)] : null, maxMs: durations.at(-1) ?? null }; });
    const mode = await $('.graph-ng-view').getAttribute('data-mode'); evidence.mode = mode;
    if (mode !== 'nodes') { assert.ok(software || (await $('.graph-ng-status').getText()).includes('GPU unavailable')); await screenshot('fallback'); return; }
    assert.equal(await browser.executeObsidian(({ app }) => (app.workspace.getLeavesOfType('graph-ng')[0]!.view as any).detailRenderer.gpu), !software);
    await screenshot('nodes');
    const point = await browser.executeObsidian(({ app }) => {
      const view = app.workspace.getLeavesOfType('graph-ng')[0]!.view as any, renderer = view.detailRenderer;
      // The canvas, not the bordered stage, is the pick coordinate space.
      const rect = renderer.canvas.getBoundingClientRect();
      for (let node = 0; node < renderer.visible.length; node++) if (renderer.visible[node]) {
        const p = renderer.screenPoint(node);
        if (p.x > 30 && p.x < rect.width - 30 && p.y > 30 && p.y < rect.height - 30 && renderer.pick(Math.round(rect.left + p.x) - rect.left, Math.round(rect.top + p.y) - rect.top) === node && document.elementFromPoint(Math.round(rect.left + p.x), Math.round(rect.top + p.y)) === renderer.canvas) return { x: Math.round(rect.left + p.x), y: Math.round(rect.top + p.y), label: renderer.path(node).split('/').pop().replace(/\.md$/, '') };
      }
      return null;
    });
    assert.ok(point); await browser.action('pointer').move({ x: point.x, y: point.y }).down().up().perform();
    await browser.waitUntil(async () => browser.executeObsidian(({ app }, label) => app.workspace.getActiveFile()?.basename === label, point.label));
    await open(); await $('.graph-ng-toolbar button:nth-child(2)').click();
    await browser.waitUntil(async () => (await $('.graph-ng-view').getAttribute('data-mode')) !== 'nodes-building');
    if (process.env.GRAPH_MEASURE_NATIVE) {
    await browser.executeObsidian(({ app }) => {
      const view = app.workspace.getLeavesOfType('graph-ng')[0]!.view as any, renderer = view.detailRenderer;
      const intervals: number[] = [], start = performance.now(); let previous = start, i = 0, ended = false;
      const finish = (error?: string) => { if (ended) return; ended = true; const sorted = intervals.slice(5).sort((a, b) => a - b); view.contentEl.dataset.frameResult = JSON.stringify({ samplerError: error, samples: sorted.length, durationMs: performance.now() - start, fps: sorted.length ? 1000 / (sorted.reduce((a, b) => a + b, 0) / sorted.length) : null, p95Ms: sorted[Math.floor(sorted.length * 0.95)], rawSamples: intervals.length, visibility: document.visibilityState }); };
      setTimeout(() => finish('Sampler reached 10s wall limit'), 10000);
      function frame(_timestamp: number) {
        const now = performance.now();
        if (ended) return;
        try { intervals.push(now - previous); previous = now; i++;
          renderer.setCamera(0.5 + Math.sin(i / 35) * 0.12, 0.5 + Math.cos(i / 41) * 0.12, 0.9 + Math.sin(i / 49) * 0.1);
          if (now - start < 3000) requestAnimationFrame(frame); else finish();
        } catch (e) { finish(String(e)); }
      }
      requestAnimationFrame(frame);
    });
    await browser.waitUntil(async () => Boolean(await $('.graph-ng-view').getAttribute('data-frame-result')), { timeout: 15000, interval: 500 });
    evidence.frames = JSON.parse((await $('.graph-ng-view').getAttribute('data-frame-result'))!);
    } else evidence.frames = 'Not sampled: this native harness yielded no rAF callbacks; use the separately labelled browser benchmark.';
    await $('.graph-ng-toolbar button').click();
  });
  it('redraws both themes without worker calls and restores WebGL buffers after context loss', async () => {
    await open();
    // Startup metadata may still have its real five-second coalescing timer. Wait
    // for that refresh before this deliberately stable-buffer screenshot lane.
    await browser.waitUntil(async () => browser.executeObsidian(({ app }) => { const view = app.workspace.getLeavesOfType('graph-ng')[0]!.view as any; return !view.refreshing && !view.queued && view.plugin.adapter.index.timer === undefined; }), { timeout: 30000 });
    const themeResults = [];
    for (const theme of ['light', 'dark']) {
      await browser.executeObsidian(({ app }, theme) => {
        const view = app.workspace.getLeavesOfType('graph-ng')[0]!.view as any;
        document.body.classList.toggle('theme-light', theme === 'light'); document.body.classList.toggle('theme-dark', theme === 'dark');
        view.stage.style.setProperty('--graph-ng-bg', theme === 'light' ? '#f4f5f8' : '#141b26');
        view.stage.style.setProperty('--graph-ng-text', theme === 'light' ? '#18212e' : '#edf4ff');
        view.stage.style.setProperty('--graph-ng-edge', theme === 'light' ? '#a4b0c2' : '#43566e');
        app.workspace.trigger('css-change'); view.showGroups();
      }, theme);
      await screenshot(`${theme}-groups`);
      await $('.graph-ng-toolbar button:nth-child(2)').click();
      await browser.waitUntil(async () => (await $('.graph-ng-view').getAttribute('data-mode')) !== 'nodes-building');
      if ((await $('.graph-ng-view').getAttribute('data-mode')) !== 'nodes') continue;
      const check = await browser.executeObsidian(async ({ app }) => {
        const view = app.workspace.getLeavesOfType('graph-ng')[0]!.view as any, r = view.detailRenderer;
        const buffers = r.buffers, positions = r.positions, before = r.paletteUploads;
        let messages = 0; const original = Worker.prototype.postMessage;
        Worker.prototype.postMessage = function (...args: any[]) { messages++; return original.apply(this, args as any); };
        try { app.workspace.trigger('css-change'); await new Promise(resolve => setTimeout(resolve, 100)); }
        finally { Worker.prototype.postMessage = original; }
        r.setCamera(.5, .5, .2);
        const rect = r.canvas.getBoundingClientRect(); let point: { x: number; y: number; node: number } | undefined;
        for (let i = 0; i < r.visible.length; i++) if (r.visible[i]) { const p = r.screenPoint(i), x = Math.round(rect.left + p.x), y = Math.round(rect.top + p.y); if (p.x > 30 && p.x < r.canvas.clientWidth - 30 && p.y > 30 && p.y < r.canvas.clientHeight - 30 && r.pick(x - rect.left, y - rect.top) === i) { point = { x, y, node: i }; break; } }
        // A format-key change changes the deterministic layout seed. At tight zoom
        // the bounding-box center may be empty; frame a real high-degree note.
        if (!point) {
          let target = -1, degree = -1;
          for (let i = 0; i < r.visible.length; i++) if (r.visible[i]) { const d = r.projection.offsets[i + 1] - r.projection.offsets[i]; if (d > degree) { degree = d; target = i; } }
          r.setCamera((r.positions[target * 2] - r.grid.minX) / r.grid.width, (r.positions[target * 2 + 1] - r.grid.minY) / r.grid.height, .2);
          const x = Math.round(rect.left + r.canvas.clientWidth / 2), y = Math.round(rect.top + r.canvas.clientHeight / 2), node = r.pick(x - rect.left, y - rect.top);
          if (node >= 0) point = { x, y, node };
        }
        r.selected = -1; r.refresh();
        return { messages, stableBuffers: r.buffers === buffers && r.positions === positions, uploads: r.paletteUploads - before, gpu: r.gpu, point };
      });
      assert.equal(check.messages, 0); assert.equal(check.stableBuffers, true); assert.equal(check.uploads, check.gpu ? 1 : 0); themeResults.push(check);
      assert.ok(check.point); await browser.action('pointer').move({ x: check.point.x, y: check.point.y }).perform();
      await browser.waitUntil(async () => browser.executeObsidian(({ app }, node) => (app.workspace.getLeavesOfType('graph-ng')[0]!.view as any).detailRenderer?.hovered === node, check.point!.node));
      await screenshot(`${theme}-detail-hover`);
      await browser.executeObsidian(({ app }) => { const r = (app.workspace.getLeavesOfType('graph-ng')[0]!.view as any).detailRenderer; r.selected = r.hovered; r.refresh(); });
      await screenshot(`${theme}-detail-selected`);
    }
    evidence.themes = themeResults;
    const canRestore = await browser.executeObsidian(({ app }) => {
      const r = (app.workspace.getLeavesOfType('graph-ng')[0]!.view as any).detailRenderer;
      if (!r?.gpu) return false;
      const ext = r.gl.getExtension('WEBGL_lose_context');
      if (!ext) return false; (window as any).restoreGraph = () => ext.restoreContext(); ext.loseContext(); return true;
    });
    if (canRestore) {
      await browser.waitUntil(async () => (await $('.graph-ng-detail').getAttribute('data-context')) === 'lost');
      await browser.execute(() => (window as any).restoreGraph());
      await browser.waitUntil(async () => (await $('.graph-ng-detail').getAttribute('data-context')) === 'restored');
      await screenshot('context-restored'); evidence.contextRestored = true;
      await browser.executeObsidian(({ app }) => { const v = app.workspace.getLeavesOfType('graph-ng')[0]!.view as any; (window as any).disposedGraphGL = v.detailRenderer.gl; v.showGroups(); });
      await browser.waitUntil(async () => browser.execute(() => (window as any).disposedGraphGL.isContextLost())); evidence.disposedContextReleased = true;
      await $('.graph-ng-toolbar button:nth-child(2)').click();
      await browser.waitUntil(async () => (await $('.graph-ng-view').getAttribute('data-mode')) === 'nodes');
      await browser.executeObsidian(({ app }) => {
        const v = app.workspace.getLeavesOfType('graph-ng')[0]!.view as any, r = v.detailRenderer;
        (window as any).previousRestoreTimeout = v.plugin.settings.contextRestoreTimeoutMs;
        v.plugin.settings.contextRestoreTimeoutMs = 25; r.gl.getExtension('WEBGL_lose_context').loseContext();
      });
      await browser.waitUntil(async () => browser.executeObsidian(({ app }, large) => { const v = app.workspace.getLeavesOfType('graph-ng')[0]!.view as any; return large ? v.contentEl.dataset.mode === 'groups' && !v.detailRenderer : v.contentEl.dataset.mode === 'nodes' && v.detailRenderer?.gpu === false; }, large));
      evidence.permanentContextFallback = large ? 'group/member canvas' : 'bounded Canvas2D detail';
      await screenshot('context-permanent-fallback');
      await browser.executeObsidian(({ app }) => { (app.workspace.getLeavesOfType('graph-ng')[0]!.view as any).plugin.settings.contextRestoreTimeoutMs = (window as any).previousRestoreTimeout; });
    } else evidence.contextRestored = 'Not applicable: Canvas fallback or no extension';
    await $('.graph-ng-toolbar button').click();
  });
  it('reopens offline from persisted layout without recomputation', async () => {
    await browser.setNetworkConditions({ offline: true, latency: 0, download_throughput: 0, upload_throughput: 0 });
    await browser.executeObsidian(({ app }) => { for (const leaf of app.workspace.getLeavesOfType('graph-ng')) leaf.detach(); });
    const start = Date.now(); await open(); evidence.warmOpenMs = Date.now() - start;
    assert.equal(await $('.graph-ng-view').getAttribute('data-cached'), 'true');
    evidence.offlineCache = true; await browser.deleteNetworkConditions();
    const saved = await browser.executeObsidian(async ({ app }) => {
      const plugin = (app.workspace.getLeavesOfType('graph-ng')[0]!.view as any).plugin;
      await plugin.save(); const data = JSON.parse(await app.vault.adapter.read(`${plugin.manifest.dir}/data.json`));
      return { keys: Object.keys(data), version: data.settings.declaration.version, hasPositions: JSON.stringify(data).includes('"positions"') };
    });
    assert.deepEqual(saved.keys, ['settings']); assert.equal(saved.version, 2); assert.equal(saved.hasPositions, false); evidence.settingsOnly = saved;
  });
  it('restores its persisted layout after a complete Obsidian restart', async function () {
    if (large) { this.skip(); return; }
    evidence.beforeRestart = await browser.executeObsidian(({ app }) => { const v = app.workspace.getLeavesOfType('graph-ng')[0]!.view as any; return { generations: v.plugin.generations, firstRow: v.plugin.adapter.index.snapshot()[0], coverage: v.plugin.adapter.coverage() }; });
    const start = Date.now(); await browser.reloadObsidian(); await open();
    try { await browser.waitUntil(async () => (await $('.graph-ng-view').getAttribute('data-cached')) === 'true', { timeout: 15000 }); }
    finally { evidence.afterRestart = await browser.executeObsidian(({ app }) => { const v = app.workspace.getLeavesOfType('graph-ng')[0]!.view as any; return { generations: v.plugin.generations, firstRow: v.plugin.adapter.index.snapshot()[0], coverage: v.plugin.adapter.coverage(), cacheTrace: v.cacheTrace, status: v.contentEl.querySelector('.graph-ng-status').textContent }; }); }
    evidence.restartAndRestoreMs = Date.now() - start;
  });
  it('warm-starts a persisted key miss after restart without moving untouched nodes', async function () {
    if (large) { this.skip(); return; }
    const before = await browser.executeObsidian(async ({ app }) => {
      const view = app.workspace.getLeavesOfType('graph-ng')[0]!.view as any;
      const p = view.projection, decoder = new TextDecoder();
      const paths = Array.from({ length: p.nodeCount }, (_, i) => decoder.decode(p.paths.bytes.subarray(p.paths.offsets[i], p.paths.offsets[i + 1])));
      const result = { paths, positions: [...view.positions] };
      await app.vault.create('Warm-Start-Added.md', '---\nid: "concept:warm-added"\nfamily: "Family 1"\n---\nSynthetic isolated node.\n');
      return result;
    });
    await browser.reloadObsidian(); await open();
    await browser.waitUntil(async () => browser.executeObsidian(({ app }) => {
      const view = app.workspace.getLeavesOfType('graph-ng')[0]!.view as any, p = view.projection;
      if (!p || p.nodeCount !== 601 || view.contentEl.dataset.state !== 'ready') return false;
      const decoder = new TextDecoder(), expectedPath = 'Warm-Start-Added.md';
      const present = Array.from({ length: p.nodeCount }, (_, i) => decoder.decode(p.paths.bytes.subarray(p.paths.offsets[i], p.paths.offsets[i + 1]))).includes(expectedPath);
      const file = app.vault.getAbstractFileByPath(expectedPath);
      return present && !!file && app.metadataCache.getFileCache(file as any)?.frontmatter?.id === 'concept:warm-added';
    }));
    evidence.persistedMiss = await browser.executeObsidian(({ app }, before) => {
      const view = app.workspace.getLeavesOfType('graph-ng')[0]!.view as any, p = view.projection, decoder = new TextDecoder();
      const paths = Array.from({ length: p.nodeCount }, (_, i) => decoder.decode(p.paths.bytes.subarray(p.paths.offsets[i], p.paths.offsets[i + 1]))), index = new Map(paths.map((path, i) => [path, i]));
      let unchanged = 0;
      before.paths.forEach((id: string, i: number) => { const next = index.get(id) as number; if (before.positions[i * 2] === view.positions[next * 2] && before.positions[i * 2 + 1] === view.positions[next * 2 + 1]) unchanged++; });
      return { unchanged, expected: before.paths.length, nodes: view.projection.nodeCount, finite: [...view.positions].every(Number.isFinite), trace: view.cacheTrace };
    }, before);
    const result = evidence.persistedMiss as { unchanged: number; expected: number; finite: boolean; nodes: number; trace: { expected: string; stored?: string; valid: boolean; nodes: number }[] };
    assert.equal(result.unchanged, result.expected); assert.equal(result.finite, true); assert.equal(result.nodes, result.expected + 1);
    assert.ok(result.trace.some(entry => entry.nodes === result.nodes && entry.stored && entry.expected !== entry.stored && !entry.valid), 'Restart must exercise a persisted key miss, not an exact cache hit');
  });
  it('updates one declared carrier without moving untouched nodes', async function () {
    if (large) { this.skip(); return; }
    const before = await browser.executeObsidian(async ({ app, obsidian }) => {
      const view = app.workspace.getLeavesOfType('graph-ng')[0]!.view as any;
      const p = view.projection, old = Array.from(view.positions as Float32Array), file = app.vault.getAbstractFileByPath('Mappings/Mapping-000000.md');
      if (!(file instanceof obsidian.TFile)) throw new Error('Synthetic carrier not found');
      await app.fileManager.processFrontMatter(file, fm => { fm.object_id = 'concept:7'; });
      return { positions: old };
    });
    const start = Date.now();
    await browser.waitUntil(async () => browser.executeObsidian(async ({ app }) => {
      const v = app.workspace.getLeavesOfType('graph-ng')[0]!.view as any;
      if (v.contentEl.dataset.state !== 'ready' || v.activeRevision !== v.detailGeneration) return false;
      // Verify the exact carrier via the same paged worker API as the UI, not a
      // second main-realm identity/carrier dictionary kept only for the harness.
      for (const edge of v.groupGraph.groupEdges) {
        const key = JSON.stringify([edge.a, edge.b].sort());
        for (let offset = 0; offset < edge.total; offset += 100) {
          const result = await v.plugin.pipeline.request(v.activeRevision, { kind: 'contributions', pair: key, offset, count: 100, view: v.viewGeneration });
          if (result.items.some((row: any) => row.carrier === 'Mappings/Mapping-000000.md' && row.target === 'Concepts/Family-2/Concept-000007.md')) return true;
        }
      }
      return false;
    }), { timeout: 15000 });
    const unchanged = await browser.executeObsidian(({ app }, before) => {
      const v = app.workspace.getLeavesOfType('graph-ng')[0]!.view as any;
      let same = 0; for (let i = 0; i < before.positions.length; i += 2) if (before.positions[i] === v.positions[i] && before.positions[i + 1] === v.positions[i + 1]) same++;
      return same;
    }, before);
    assert.ok(unchanged > 300, 'Most unrelated nodes must remain pinned'); evidence.incremental = { updateMs: Date.now() - start, unchangedNodes: unchanged };
  });
  it('quarantines duplicate identities visibly without breaking the graph', async function () {
    if (large) { this.skip(); return; }
    await browser.executeObsidian(async ({ app }) => { await app.vault.create('Quarantine-Duplicate.md', '---\nid: "concept:0"\nfamily: "Family 1"\n---\nSynthetic duplicate.\n'); });
    await browser.waitUntil(async () => (await $('.graph-ng-status').getText()).includes('2 notes share an ID') && (await $('.graph-ng-view').getAttribute('data-state')) === 'ready', { timeout: 15000 });
    await $('.graph-ng-quarantine summary').click();
    assert.equal(await $$('.graph-ng-quarantine .graph-ng-list button').length, 2);
    assert.ok(Number(await $('.graph-ng-view').getAttribute('data-nodes')) > 500);
    await screenshot('quarantine'); evidence.quarantine = { notes: 2, graphRemainsAvailable: true };
    await browser.executeObsidian(async ({ app, obsidian }) => { const file = app.vault.getAbstractFileByPath('Quarantine-Duplicate.md'); if (file instanceof obsidian.TFile) await app.vault.trash(file, true); });
  });
  it('accepts draft producer aggregates and resolves opaque carriers by a declared key', async () => {
    await browser.executeObsidian(async ({ app }) => {
      const view = app.workspace.getLeavesOfType('graph-ng')[0]!.view as any;
      const projection = { schema: 'graph-projection-v0', producer: { name: 'synthetic', projection: 'fixture', asOf: '2026-11-10' }, groups: [{ id: 'a', label: 'Alpha', count: 10, identityPrefix: 'concept:' }, { id: 'b', label: 'Beta', count: 20 }], groupEdges: [{ a: 'a', b: 'b', total: 1, typeCounts: { related: 1 }, directional: { aToB: { related: 1 }, bToA: {} }, carriers: { kind: 'synthetic-id', ids: ['mapping:0'] } }], coverage: { synthetic: true } };
      await app.vault.create('precomputed.json', JSON.stringify(projection));
      const settings = structuredClone(view.plugin.settings); settings.projectionFile = 'precomputed.json'; settings.declaration.carrierResolvers.push({ kind: 'synthetic-id', key: 'id' });
      await view.plugin.apply(settings);
    });
    await ready(); await screenshot('precomputed');
    await relationships(); await $('.graph-ng-edge').click();
    const carrier = await $('.graph-ng-carrier'); assert.equal(await carrier.isEnabled(), true); await carrier.click();
    await browser.waitUntil(async () => browser.executeObsidian(({ app }) => app.workspace.getActiveFile()?.path === 'Mappings/Mapping-000000.md'));
  });
  it('renders a bounded first page for 16000 groups and 44600 pairs', async () => {
    await open(); const start = Date.now();
    await browser.executeObsidian(async ({ app }) => {
      const view = app.workspace.getLeavesOfType('graph-ng')[0]!.view as any;
      const projection = { groups: Array.from({ length: 16000 }, (_, i) => ({ id: String(i), label: `Synthetic group ${i}`, count: 1 })),
        groupEdges: Array.from({ length: 44600 }, (_, i) => ({ a: String(i % 16000), b: String((i + 1 + Math.floor(i / 16000)) % 16000), total: 1, typeCounts: { related: 1 }, carriers: { kind: 'none', ids: [] } })) };
      await app.vault.create('paged-projection.json', JSON.stringify(projection));
      const settings = structuredClone(view.plugin.settings); Object.assign(settings, { projectionFile: 'paged-projection.json', listPageSize: 25, groupCanvasPageSize: 6, maxProjectionGroups: 16000, maxProjectionPairs: 44600 });
      await view.plugin.apply(settings);
    });
    await ready();
    const firstPageMs = Number(await $('.graph-ng-view').getAttribute('data-group-first-page-ms'));
    evidence.pagedGroups = { groups: 16000, pairs: 44600, listPageSize: 25, canvasPageSize: 6, firstPageMs, totalMs: Date.now() - start };
    assert.ok(firstPageMs < 1000, 'First-page synchronous rendering must stay below 1 second');
    assert.ok(Date.now() - start < 5000, 'Full aggregate first-page load must stay below 5 seconds');
    assert.equal(await $$('.graph-ng-group-controls button').length, 25); assert.equal(await $('.graph-ng-view').getAttribute('data-canvas-groups'), '6');
    await relationships(); assert.equal(await $$('.graph-ng-edge').length, 25); assert.ok((await $('.graph-ng-edge').getText()).includes('↔'));
    const first = await $('.graph-ng-group-controls button').getAttribute('data-group');
    await $('.graph-ng-panel > .graph-ng-pagination .graph-ng-page-controls button:last-child').click();
    assert.notEqual(await $('.graph-ng-group-controls button').getAttribute('data-group'), first); assert.equal(await $$('.graph-ng-group-controls button').length, 25);
    await screenshot('paged-groups');
  });

});
