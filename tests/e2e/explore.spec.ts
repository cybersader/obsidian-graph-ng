import { browser, $, $$ } from '@wdio/globals';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chooseFixture, fixtureShape } from '../../scripts/fixture';
// Slice 6 exploration lane: real Obsidian, real WebGL, synthetic vaults only.
const literal = Boolean(process.env.GRAPH_LITERAL), large = Boolean(process.env.GRAPH_LARGE), software = Boolean(process.env.GRAPH_SOFTWARE);
const tag = `explore-${large ? 'large' : 'small'}${process.env.GRAPH_FIXTURE === 'clustered' ? '-clustered' : ''}${literal ? '-literal' : ''}-${software ? 'software' : 'hardware'}`;
const evidence: Record<string, unknown> = { tag };
// The filter expectation follows the generated synthetic shape (uniform or clustered).
const family1 = chooseFixture(fixtureShape())(large ? 16000 : 600, large ? 44600 : 1400).filter(r => r.properties.family === 'Family 1').length;
const view = () => $('.graph-ng-view');
const choose = (selector: string, value: string) => browser.execute((s, v) => { const el = document.querySelector(s) as HTMLSelectElement; el.value = v; el.dispatchEvent(new Event('change')); return el.value === v; }, selector, value);
const clickText = (selector: string, text: string) => browser.execute((s, t) => { const el = [...document.querySelectorAll(s)].find(e => e.textContent === t) as HTMLElement | undefined; el?.click(); return Boolean(el); }, selector, text);
const visibleNodes = async () => { const v = await view().getAttribute('data-visible-nodes'); return v === null ? NaN : Number(v); };
const count = (selector: string) => browser.execute(s => document.querySelectorAll(s).length, selector);
async function ready() { await browser.waitUntil(async () => (await view().getAttribute('data-state')) === 'ready', { timeout: 240000, timeoutMsg: 'Graph did not become ready' }); }
async function settle(ms = 450) { await browser.pause(ms); }
async function shot(name: string) { await browser.saveScreenshot(`test-screenshots/${tag}-${name}.png`); }
async function theme(name: 'light' | 'dark') {
  await browser.executeObsidian(({ app }, name) => {
    document.body.classList.toggle('theme-light', name === 'light'); document.body.classList.toggle('theme-dark', name === 'dark');
    app.workspace.trigger('css-change'); const v = app.workspace.getLeavesOfType('graph-ng')[0]!.view as any; v.detailRenderer?.refreshTheme();
  }, name);
  await settle(300);
}
/** Observe long tasks across one interaction; graph-ng's own work is main-thread JS here. */
async function measured<T>(label: string, run: () => Promise<T>): Promise<T> {
  await browser.execute(() => { const w = window as any; w.exploreTasks = []; w.exploreObserver = new PerformanceObserver(l => w.exploreTasks.push(...l.getEntries().map((e: PerformanceEntry) => e.duration))); w.exploreObserver.observe({ type: 'longtask', buffered: false }); });
  const result = await run();
  (evidence.longTasks ??= {} as Record<string, number[]>) && ((evidence.longTasks as Record<string, number[]>)[label] = await browser.execute(() => { const w = window as any; w.exploreTasks.push(...w.exploreObserver.takeRecords().map((e: PerformanceEntry) => e.duration)); w.exploreObserver.disconnect(); return w.exploreTasks; }));
  return result;
}
describe('Graph NG explore controls and visuals', () => {
  before(async () => {
    await mkdir('test-screenshots', { recursive: true }); await mkdir('.workspace/evidence', { recursive: true });
    await browser.waitUntil(async () => browser.executeObsidian(({ app }) => { const files = app.vault.getMarkdownFiles(); return files.length >= 2000 && files.every(f => app.metadataCache.getFileCache(f) !== null); }), { timeout: 240000, interval: 1000, timeoutMsg: 'Synthetic cache indexing not complete' });
    await browser.executeObsidianCommand('graph-ng:open'); await ready();
    // Let the startup metadata debounce settle so screenshots are not racing a rebuild.
    await browser.waitUntil(async () => browser.executeObsidian(({ app }) => { const v = app.workspace.getLeavesOfType('graph-ng')[0]!.view as any; return !v.refreshing && !v.queued && v.plugin.adapter.index.timer === undefined && v.contentEl.dataset.state === 'ready'; }), { timeout: 60000 });
    evidence.nodes = Number(await view().getAttribute('data-nodes')); evidence.edges = Number(await view().getAttribute('data-edges'));
  });
  after(async () => { await writeFile(`.workspace/evidence/e2e-${tag}.json`, JSON.stringify(evidence, null, 2)); });
  it('shows the control panel with live counts and group-colored groups in both themes', async () => {
    assert.ok(await $('.graph-ng-explore').isDisplayed());
    const counts = await $('.graph-ng-explore-counts').getText(); evidence.initialCounts = counts;
    assert.match(counts, new RegExp(`${Number(evidence.nodes).toLocaleString()} of ${Number(evidence.nodes).toLocaleString()} nodes`));
    await theme('dark'); await shot('dark-groups');
    await theme('light'); await shot('light-groups');
  });
  it('renders the detail web with effects, hover neighborhood and smooth camera', async () => {
    await theme('dark');
    await measured('detailOpen', async () => { await $('.graph-ng-toolbar button:nth-child(2)').click(); await browser.waitUntil(async () => (await view().getAttribute('data-mode')) !== 'nodes-building', { timeout: 120000 }); });
    const mode = await view().getAttribute('data-mode'); evidence.mode = mode;
    if (mode !== 'nodes') { assert.ok(software); await shot('fallback'); return; }
    await settle(800); await shot('dark-detail');
    evidence.policy = await browser.executeObsidian(({ app }) => (app.workspace.getLeavesOfType('graph-ng')[0]!.view as any).detailRenderer.policy);
    const target = await browser.executeObsidian(({ app }) => {
      const r = (app.workspace.getLeavesOfType('graph-ng')[0]!.view as any).detailRenderer; let best = -1, degree = -1;
      for (let i = 0; i < r.visible.length; i++) if (r.visible[i]) { const d = r.projection.offsets[i + 1] - r.projection.offsets[i]; if (d > degree) { degree = d; best = i; } }
      r.flyTo((r.positions[best * 2] - r.grid.minX) / r.grid.width, (r.positions[best * 2 + 1] - r.grid.minY) / r.grid.height, .3, 300); return { node: best, degree };
    });
    await settle(700);
    const point = await browser.executeObsidian(({ app }, node) => { const r = (app.workspace.getLeavesOfType('graph-ng')[0]!.view as any).detailRenderer, rect = r.canvas.getBoundingClientRect(), p = r.screenPoint(node); return { x: Math.round(rect.left + p.x), y: Math.round(rect.top + p.y), camera: { ...r.camera } }; }, target.node);
    assert.ok(Math.abs(point.camera.ratio - .3) < 1e-6, 'flyTo must land exactly on the requested camera');
    await measured('hover', async () => { await browser.action('pointer').move({ x: point.x, y: point.y }).perform(); await browser.waitUntil(async () => browser.executeObsidian(({ app }, node) => (app.workspace.getLeavesOfType('graph-ng')[0]!.view as any).detailRenderer.hovered === node, target.node)); });
    await settle(400); await shot('dark-hover');
    evidence.hover = { ...target, near: await browser.executeObsidian(({ app }) => (app.workspace.getLeavesOfType('graph-ng')[0]!.view as any).detailRenderer.near.length) };
    await theme('light'); await shot('light-hover');
    await browser.action('pointer').move({ x: 5, y: 5 }).perform(); await settle(300);
    await browser.executeObsidian(({ app }) => (app.workspace.getLeavesOfType('graph-ng')[0]!.view as any).detailRenderer.fitAll(0)); await settle(500); await shot('light-detail');
    // Literal display: edge notes fold into edges at home zoom; also judge them drawn (LOD off).
    evidence.carriers = await browser.executeObsidian(({ app }) => { const r = (app.workspace.getLeavesOfType('graph-ng')[0]!.view as any).detailRenderer; return { count: r.carrierCount, home: r.carrierLevel() }; });
    if ((evidence.carriers as { count: number }).count) {
      const lod = (on: boolean) => browser.executeObsidian(({ app }, on) => { const v = app.workspace.getLeavesOfType('graph-ng')[0]!.view as any; v.plugin.settings.visuals.carrierLod = on; v.detailRenderer.refreshVisuals(); }, on);
      await measured('carrierLod', async () => { await lod(false); await settle(500); }); await shot('light-detail-notes');
      await theme('dark'); await shot('dark-detail-notes'); await lod(true); await settle(300);
    }
    await theme('dark');
  });
  it('filters by a declared property through the panel without relayout', async function () {
    if ((await view().getAttribute('data-mode')) !== 'nodes') this.skip();
    const before = await browser.executeObsidian(({ app }) => { const v = app.workspace.getLeavesOfType('graph-ng')[0]!.view as any; return { buffers: v.detailRenderer.buffers.length, positions: v.positions, layoutMs: v.contentEl.dataset.layoutMs }; });
    assert.ok(await choose('.graph-ng-explore-filters select[aria-label="Property"]', 'k:family'));
    assert.ok(await choose('.graph-ng-explore-filters select[aria-label="Value"]', '"Family 1"'));
    await measured('filter', async () => {
      await $('.graph-ng-explore-filters button.mod-cta').click();
      await browser.waitUntil(async () => (await visibleNodes()) < Number(evidence.nodes), { timeout: 30000 });
    });
    const after = await browser.executeObsidian(({ app }) => { const v = app.workspace.getLeavesOfType('graph-ng')[0]!.view as any; return { visible: Number(v.contentEl.dataset.visibleNodes), exploreMs: Number(v.contentEl.dataset.exploreMs), counts: v.contentEl.querySelector('.graph-ng-explore-counts').textContent, mode: v.contentEl.dataset.mode, samePositions: v.positions === v.detailRenderer.positions, chips: v.contentEl.querySelectorAll('.graph-ng-chip').length }; });
    evidence.filter = after;
    assert.equal(after.mode, 'nodes'); assert.equal(after.chips, 1); assert.ok(after.samePositions); assert.equal(before.layoutMs, await view().getAttribute('data-layout-ms'));
    assert.equal(after.visible, family1);
    await settle(600); await shot('dark-filter');
    await $('.graph-ng-chip').click(); await browser.waitUntil(async () => (await visibleNodes()) === Number(evidence.nodes), { timeout: 30000 });
  });
  it('collapses a group into a hub and expands it again', async function () {
    if ((await view().getAttribute('data-mode')) !== 'nodes') this.skip();
    await measured('collapse', async () => {
      const folds = await $$('.graph-ng-explore-groups .graph-ng-fold'); await folds[0]!.click(); await settle(200);
      const again = await $$('.graph-ng-explore-groups .graph-ng-fold'); await again[1]!.click();
      await browser.waitUntil(async () => browser.executeObsidian(({ app }) => (app.workspace.getLeavesOfType('graph-ng')[0]!.view as any).detailRenderer.hubs.length === 2), { timeout: 30000 });
    });
    await browser.executeObsidian(({ app }) => (app.workspace.getLeavesOfType('graph-ng')[0]!.view as any).detailRenderer.fitAll(0)); await settle(600);
    await shot('dark-collapsed');
    const hub = await browser.executeObsidian(({ app }) => { const r = (app.workspace.getLeavesOfType('graph-ng')[0]!.view as any).detailRenderer, rect = r.canvas.getBoundingClientRect(), h = r.hubs[0]; return { x: Math.round(rect.left + (h.x - r.grid.minX - r.camera.x * r.grid.width) * r.fit / r.camera.ratio + r.canvas.clientWidth / 2), y: Math.round(rect.top + (h.y - r.grid.minY - r.camera.y * r.grid.height) * r.fit / r.camera.ratio + r.canvas.clientHeight / 2), labels: r.hubLabels.map((l: HTMLElement) => l.textContent) }; });
    evidence.hubs = hub.labels; assert.equal(hub.labels.length, 2);
    await theme('light'); await shot('light-collapsed'); await theme('dark');
    await browser.action('pointer').move({ x: hub.x, y: hub.y }).down().up().perform();
    await browser.waitUntil(async () => browser.executeObsidian(({ app }) => (app.workspace.getLeavesOfType('graph-ng')[0]!.view as any).detailRenderer.hubs.length === 1), { timeout: 30000 });
    await settle(700); await shot('dark-expanded-zoom');
    assert.ok(await clickText('.graph-ng-explore-groups button', 'Expand all'));
    await browser.waitUntil(async () => browser.executeObsidian(({ app }) => (app.workspace.getLeavesOfType('graph-ng')[0]!.view as any).detailRenderer.hubs.length === 0), { timeout: 30000 });
  });
  it('saves a reproducible view and persists only scanner-safe settings', async function () {
    if ((await view().getAttribute('data-mode')) !== 'nodes') this.skip();
    await browser.executeObsidian(({ app }) => { const v = app.workspace.getLeavesOfType('graph-ng')[0]!.view as any; v.setView({ ...v.view, filters: [{ kind: 'in', key: 'family', values: ['Family 2', 'Family 3'] }] }, () => v.detailRenderer.flyTo(.4, .45, .55, 0)); });
    await browser.waitUntil(async () => (await count('.graph-ng-chip')) === 1);
    const expected = Number(await view().getAttribute('data-visible-nodes'));
    await $('.graph-ng-explore-views summary').click();
    await $('.graph-ng-explore-views input[aria-label="Saved view name"]').setValue('Two families');
    await $('.graph-ng-explore-views button.mod-cta').click();
    await $('.graph-ng-chip').click(); await browser.waitUntil(async () => (await visibleNodes()) === Number(evidence.nodes));
    await browser.executeObsidian(({ app }) => (app.workspace.getLeavesOfType('graph-ng')[0]!.view as any).detailRenderer.fitAll(0));
    await $('button[aria-label="Apply view Two families"]').click();
    await browser.waitUntil(async () => (await visibleNodes()) === expected, { timeout: 30000 }); await settle(700);
    const restored = await browser.executeObsidian(({ app }) => ({ ...(app.workspace.getLeavesOfType('graph-ng')[0]!.view as any).detailRenderer.camera }));
    assert.ok(Math.abs(restored.ratio - .55) < 1e-6 && Math.abs(restored.x - .4) < 1e-6, 'saved camera must be restored');
    await shot('dark-saved-view');
    const saved = await browser.executeObsidian(async ({ app }) => { const p = (app.workspace.getLeavesOfType('graph-ng')[0]!.view as any).plugin; await p.save(); const text = await app.vault.adapter.read(`${p.manifest.dir}/data.json`), data = JSON.parse(text); return { keys: Object.keys(data), views: data.settings.explore.savedViews, positions: text.includes('"positions"') }; });
    assert.deepEqual(saved.keys, ['settings']); assert.equal(saved.positions, false); assert.equal(saved.views.length, 1); assert.deepEqual(saved.views[0].view.filters, [{ kind: 'in', key: 'family', values: ['Family 2', 'Family 3'] }]);
    evidence.savedView = { expected, restored, persisted: saved.views[0] };
    await $('.graph-ng-chip').click(); await browser.waitUntil(async () => (await visibleNodes()) === Number(evidence.nodes));
  });
  it('switches group source at runtime and keeps the group view usable', async () => {
    await $('.graph-ng-toolbar button').click();
    await browser.waitUntil(async () => (await view().getAttribute('data-mode')) === 'groups');
    const folder = await browser.execute(() => [...document.querySelectorAll('.graph-ng-explore-groups select[aria-label="Group by"] option')].findIndex(o => o.textContent!.startsWith('Folder depth 2')));
    await measured('regroup', async () => { await choose('.graph-ng-explore-groups select[aria-label="Group by"]', String(folder)); await browser.waitUntil(async () => (await view().getAttribute('data-group-source')) === 'folder:2', { timeout: 30000 }); });
    await settle(400); evidence.regroup = await browser.execute(() => [...document.querySelectorAll('.graph-ng-group-controls button')].map(b => b.textContent)); await shot('dark-regrouped');
    await theme('light'); await shot('light-regrouped'); await theme('dark');
    // Derived source: identity namespace prefix, no new note properties.
    await browser.execute(() => { (document.querySelector('.graph-ng-derived') as HTMLDetailsElement).open = true; });
    assert.ok(await choose('.graph-ng-derived select[aria-label="Derive from"]', '$identity'));
    assert.ok(await choose('.graph-ng-derived select[aria-label="Transform"]', 'segment'));
    await $('.graph-ng-derived input[aria-label="N"]').setValue('0');
    assert.ok(await clickText('.graph-ng-derived button', 'Group'));
    await browser.waitUntil(async () => (await view().getAttribute('data-group-source')) === 'derived:$identity', { timeout: 30000 }); await settle(300);
    evidence.derived = await browser.execute(() => [...document.querySelectorAll('.graph-ng-group-controls button')].map(b => b.textContent));
    await shot('dark-derived');
    assert.ok(await choose('.graph-ng-explore-groups select[aria-label="Group by"]', '0')); await settle(300);
  });
});
