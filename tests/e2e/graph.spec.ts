import { browser, $ } from '@wdio/globals';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const literal = Boolean(process.env.GRAPH_LITERAL);
const large = Boolean(process.env.GRAPH_LARGE), software = Boolean(process.env.GRAPH_SOFTWARE);
const tag = `${large ? 'large' : 'small'}${literal ? '-literal' : ''}-${software ? 'software' : 'hardware'}`;
const evidence: Record<string, unknown> = { tag, app: '1.13.7', installer: '1.13.7', notes: large ? 60600 : 2000 };
async function ready() { await browser.waitUntil(async () => (await $('.graph-ng-view').getAttribute('data-state')) === 'ready', { timeout: 180000, timeoutMsg: 'Graph did not become ready' }); }
async function open() { await browser.executeObsidianCommand('graph-ng:open'); await ready(); }
async function screenshot(name: string) { await browser.saveScreenshot(`test-screenshots/${tag}-${name}.png`); }
describe('Graph NG synthetic Obsidian path', () => {
  before(async () => {
    await mkdir('test-screenshots', { recursive: true }); await mkdir('.workspace/evidence', { recursive: true });
    await browser.waitUntil(async () => browser.executeObsidian(({ app }) => { const files = app.vault.getMarkdownFiles(); return files.length >= 2000 && files.every(f => app.metadataCache.getFileCache(f) !== null); }), { timeout: 180000, timeoutMsg: 'Synthetic cache indexing not complete' });
    await browser.executeObsidian(() => {
      const state = window as any; state.graphOpenTasks = [];
      state.graphOpenObserver = new PerformanceObserver(list => state.graphOpenTasks.push(...list.getEntries()));
      state.graphOpenObserver.observe({ type: 'longtask', buffered: false });
    });
    const start = Date.now(); await open(); evidence.coldOpenMs = Date.now() - start;
    evidence.firstGroupMs = Number(await $('.graph-ng-view').getAttribute('data-first-group-ms'));
    evidence.openTasks = await browser.executeObsidian(() => {
      const state = window as any; state.graphOpenTasks.push(...state.graphOpenObserver.takeRecords()); state.graphOpenObserver.disconnect();
      const values = state.graphOpenTasks.map((t: PerformanceEntry) => t.duration).sort((a: number, b: number) => a - b);
      return { count: values.length, p95Ms: values[Math.floor(values.length * .95)] ?? 0, maxMs: values.at(-1) ?? 0, durations: values };
    });
    evidence.status = await $('.graph-ng-status').getText();
  });
  after(async () => { await writeFile(`.workspace/evidence/e2e-${tag}.json`, JSON.stringify(evidence, null, 2)); });
  it('renders declared groups with counts and opens a contributing carrier', async () => {
    assert.equal(await $('.graph-ng-view').getAttribute('data-nodes'), literal ? '60600' : large ? '16000' : '600');
    assert.equal(await $('.graph-ng-view').getAttribute('data-edges'), literal ? '89200' : large ? '44600' : '1400');
    assert.equal(await $('.graph-ng-view').getAttribute('data-mode'), 'groups');
    assert.equal(await $$('.graph-ng-group-controls button').length, literal ? 7 : 6);
    await screenshot('groups');
    await $('.graph-ng-panel summary').click(); await $('.graph-ng-edge').click();
    const button = await $('.graph-ng-contribution button'), carrier = await button.getText();
    await screenshot('carriers'); await button.click();
    await browser.waitUntil(async () => browser.executeObsidian(({ app }, path) => app.workspace.getActiveFile()?.path === path, carrier));
    await open();
  });
  it('drills into members and opens an individual graph node when GPU is available', async () => {
    await $('.graph-ng-group-controls button').click();
    const member = await $('.graph-ng-member'), path = await member.getText(); await member.click();
    await browser.waitUntil(async () => browser.executeObsidian(({ app }, path) => app.workspace.getActiveFile()?.path === path, path));
    await open(); await $('.graph-ng-toolbar button:nth-child(2)').click();
    await browser.waitUntil(async () => (await $('.graph-ng-view').getAttribute('data-mode')) !== 'nodes-building');
    const mode = await $('.graph-ng-view').getAttribute('data-mode'); evidence.mode = mode;
    if (mode !== 'nodes') { assert.ok(software || (await $('.graph-ng-status').getText()).includes('GPU unavailable')); await screenshot('fallback'); return; }
    assert.equal(software, false, 'Software GL must not render full graph');
    await screenshot('nodes');
    const point = await browser.executeObsidian(({ app }) => {
      const view = app.workspace.getLeavesOfType('graph-ng')[0]!.view as any, sigma = view.detailRenderer.sigma;
      const rect = view.contentEl.querySelector('.graph-ng-stage').getBoundingClientRect();
      const nodes = sigma.getGraph().nodes().map((node: string) => ({ node, p: sigma.framedGraphToViewport(sigma.getNodeDisplayData(node)) }));
      for (const { node, p } of nodes) {
        if (p.x > 30 && p.x < rect.width - 30 && p.y > 30 && p.y < rect.height - 30 && nodes.every((n: any) => n.node === node || Math.hypot(n.p.x - p.x, n.p.y - p.y) > 12)) return { x: Math.round(rect.left + p.x), y: Math.round(rect.top + p.y), label: sigma.getGraph().getNodeAttribute(node, 'label') };
      }
      return null;
    });
    assert.ok(point); await browser.action('pointer').move({ x: point.x, y: point.y }).down().up().perform();
    await browser.waitUntil(async () => browser.executeObsidian(({ app }, label) => app.workspace.getActiveFile()?.basename === label, point.label));
    await open(); await $('.graph-ng-toolbar button:nth-child(2)').click();
    await browser.waitUntil(async () => (await $('.graph-ng-view').getAttribute('data-mode')) !== 'nodes-building');
    if (process.env.GRAPH_MEASURE_NATIVE) {
    await browser.executeObsidian(({ app }) => {
      const view = app.workspace.getLeavesOfType('graph-ng')[0]!.view as any, sigma = view.detailRenderer.sigma, camera = sigma.getCamera();
      const intervals: number[] = [], start = performance.now(); let previous = start, i = 0, ended = false;
      const finish = (error?: string) => { if (ended) return; ended = true; const sorted = intervals.slice(5).sort((a, b) => a - b); view.contentEl.dataset.frameResult = JSON.stringify({ samplerError: error, samples: sorted.length, durationMs: performance.now() - start, fps: sorted.length ? 1000 / (sorted.reduce((a, b) => a + b, 0) / sorted.length) : 0, p95Ms: sorted[Math.floor(sorted.length * 0.95)], rawSamples: intervals.length, visibility: document.visibilityState }); };
      setTimeout(() => finish('Sampler reached 10s wall limit'), 10000);
      function frame(_timestamp: number) {
        const now = performance.now();
        if (ended) return;
        try { intervals.push(now - previous); previous = now; i++;
          camera.setState({ x: 0.5 + Math.sin(i / 35) * 0.12, y: 0.5 + Math.cos(i / 41) * 0.12, ratio: 0.9 + Math.sin(i / 49) * 0.1 }); sigma.refresh({ partialGraph: {}, skipIndexation: true });
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
      const result = { identities: [...view.projection.identities], positions: [...view.positions] };
      await app.vault.create('Warm-Start-Added.md', '---\nid: "concept:warm-added"\nfamily: "Family 1"\n---\nSynthetic isolated node.\n');
      return result;
    });
    await browser.reloadObsidian(); await open();
    await browser.waitUntil(async () => browser.executeObsidian(({ app }) => { const view = app.workspace.getLeavesOfType('graph-ng')[0]!.view as any; return view.projection?.identities.includes('concept:warm-added') && view.contentEl.dataset.state === 'ready'; }));
    evidence.persistedMiss = await browser.executeObsidian(({ app }, before) => {
      const view = app.workspace.getLeavesOfType('graph-ng')[0]!.view as any, index = new Map(view.projection.identities.map((id: string, i: number) => [id, i]));
      let unchanged = 0;
      before.identities.forEach((id: string, i: number) => { const next = index.get(id) as number; if (before.positions[i * 2] === view.positions[next * 2] && before.positions[i * 2 + 1] === view.positions[next * 2 + 1]) unchanged++; });
      return { unchanged, expected: before.identities.length, nodes: view.projection.paths.length, finite: [...view.positions].every(Number.isFinite), trace: view.cacheTrace };
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
      return { positions: old, identities: p.identities };
    });
    const start = Date.now();
    await browser.waitUntil(async () => browser.executeObsidian(({ app }) => {
      const v = app.workspace.getLeavesOfType('graph-ng')[0]!.view as any, p = v.projection;
      const carrier = p.carrierPaths.indexOf('Mappings/Mapping-000000.md'), edge = Array.from(p.carrier).indexOf(carrier);
      return edge >= 0 && p.identities[p.target[edge]] === 'concept:7' && v.contentEl.dataset.state === 'ready';
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
    await $('.graph-ng-panel summary').click(); await $('.graph-ng-edge').click();
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
    await $('.graph-ng-panel summary').click(); assert.equal(await $$('.graph-ng-edge').length, 25); assert.ok((await $('.graph-ng-edge').getText()).includes('↔'));
    const first = await $('.graph-ng-group-controls button').getAttribute('data-group');
    await $('.graph-ng-panel > .graph-ng-pagination .graph-ng-page-controls button:last-child').click();
    assert.notEqual(await $('.graph-ng-group-controls button').getAttribute('data-group'), first); assert.equal(await $$('.graph-ng-group-controls button').length, 25);
    await screenshot('paged-groups');
  });

});
