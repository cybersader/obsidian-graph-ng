/** SPDX-License-Identifier: MIT */
import { browser, $ } from '@wdio/globals';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const receipt: Record<string, unknown> = {};
const input = '.graph-ng-explore-filters input[aria-label="Filter expression"]';
async function type(source: string) {
  await browser.execute((selector, source) => { const field = document.querySelector(selector) as HTMLInputElement; field.value = source; field.dispatchEvent(new Event('input')); }, input, source);
}
async function feedback() { return browser.execute(selector => document.querySelector(selector)?.closest('details')?.querySelector('pre')?.textContent ?? '', input); }
describe('Graph NG bounded expression editor', () => {
  before(async () => {
    await mkdir('test-screenshots', { recursive: true }); await mkdir('.workspace/evidence', { recursive: true });
    await browser.waitUntil(async () => browser.executeObsidian(({ app }) => { const files = app.vault.getMarkdownFiles(); return files.length >= 2000 && files.every(f => app.metadataCache.getFileCache(f) !== null); }), { timeout: 240000, interval: 1000 });
    await browser.executeObsidianCommand('graph-ng:open');
    await browser.waitUntil(async () => (await $('.graph-ng-view').getAttribute('data-state')) === 'ready', { timeout: 240000 });
    await browser.waitUntil(async () => browser.executeObsidian(({ app }) => { const v = app.workspace.getLeavesOfType('graph-ng')[0]!.view as any; return !v.refreshing && !v.queued && v.plugin.adapter.index.timer === undefined; }), { timeout: 60000 });
    await browser.execute(selector => { const d = document.querySelector(selector)?.closest('details'); if (d) d.open = true; }, input);
  });
  after(async () => { await writeFile('.workspace/evidence/e2e-expressions.json', JSON.stringify(receipt, null, 2)); });
  it('shows positioned errors and disables applying invalid syntax', async () => {
    assert.equal(await $(input).getAttribute('maxlength'), null);
    await type('a'.repeat(2049)); assert.match(await feedback(), /At 2049:.*2,048/);
    await type('/a+/'); assert.match(await feedback(), /At 1:.*Regex/);
    assert.equal(await browser.execute(selector => (document.querySelector(selector)?.closest('details')?.querySelector('button') as HTMLButtonElement).disabled, input), true);
    await browser.saveScreenshot('test-screenshots/expressions-positioned-error.png');
  });
  it('debounces worker counts and offers keys and receiver methods', async () => {
    await browser.executeObsidian(({ app }) => { const v = app.workspace.getLeavesOfType('graph-ng')[0]!.view as any, pipeline = v.plugin.pipeline, original = pipeline.request.bind(pipeline); (window as any).expressionCounts = []; pipeline.request = (revision: number, request: any) => { if (request.kind === 'expression-count') (window as any).expressionCounts.push(request.expr); return original(revision, request); }; });
    await browser.execute(selector => { const field = document.querySelector(selector) as HTMLInputElement; for (const source of ['true', 'false', 'note.category == "Category 1"']) { field.value = source; field.dispatchEvent(new Event('input')); } }, input);
    await browser.waitUntil(async () => /matched/.test(await feedback()), { timeout: 30000 });
    const calls = await browser.execute(() => (window as any).expressionCounts); assert.deepEqual(calls, ['note.category == "Category 1"']); receipt.countFeedback = await feedback();
    assert.match(await feedback(), /100 \/ 600 matched/);
    await type('note.category.');
    assert.ok(await browser.execute(selector => { const id = (document.querySelector(selector) as HTMLInputElement).getAttribute('list'); return [...document.getElementById(id!)!.querySelectorAll('option')].some(option => option.value === 'note.category.lower('); }, input));
    await type('note.category == "Category 1"'); await browser.waitUntil(async () => /matched/.test(await feedback()));
    await browser.saveScreenshot('test-screenshots/expressions-live-count.png');
  });
  it('applies text filters without relayout and retains oversized structured builder entries', async () => {
    const before = await $('.graph-ng-view').getAttribute('data-layout-ms');
    await browser.execute(selector => (document.querySelector(selector)?.closest('details')?.querySelector('button') as HTMLButtonElement).click(), input);
    await browser.waitUntil(async () => Number(await $('.graph-ng-view').getAttribute('data-visible-nodes')) === 100, { timeout: 30000 });
    assert.equal(await $('.graph-ng-view').getAttribute('data-layout-ms'), before);
    receipt.applied = await browser.executeObsidian(({ app }) => { const v = app.workspace.getLeavesOfType('graph-ng')[0]!.view as any; return v.view.filters; });
    assert.equal((receipt.applied as any[])[0].kind, 'expr');
    await browser.executeObsidian(({ app }) => { const v = app.workspace.getLeavesOfType('graph-ng')[0]!.view as any; v.setView({ ...v.view, filters: [{ kind: 'in', key: 'category', values: Array.from({ length: 10000 }, (_, i) => i) }] }); });
    await browser.waitUntil(async () => (await $('button[aria-label="Edit filter 1 as expression"]').isExisting()), { timeout: 30000 });
    assert.equal(await $('button[aria-label="Edit filter 1 as expression"]').isEnabled(), false);
    assert.match((await $('button[aria-label="Edit filter 1 as expression"]').getAttribute('title')) ?? '', /Too large.*builder/);
    assert.ok(await $('textarea[aria-label="Builder filter 1"]').isExisting());
  });
  it('paints a saved applied view while preview and members requests are queued', async () => {
    await browser.waitUntil(async () => Number(await $('.graph-ng-view').getAttribute('data-visible-nodes')) === 0);
    const result = await browser.executeObsidian(async ({ app }) => {
      const v = app.workspace.getLeavesOfType('graph-ng')[0]!.view as any;
      const saved = { name: 'Synthetic category view', camera: null, view: { ...v.view, filters: [{ kind: 'expr', expr: 'note.category == "Category 1"' }] } };
      v.plugin.settings.explore.savedViews = [saved];
      const generation = v.viewGeneration + 1;
      const applied = new Promise<void>(resolve => v.setView(saved.view, resolve));
      const count = v.plugin.pipeline.request(v.activeRevision, { kind: 'expression-count', expr: 'note.category == "Category 1"', context: 'filter' });
      const members = v.plugin.pipeline.request(v.activeRevision, { kind: 'members', group: '0', view: generation });
      const [, counted, memberIds] = await Promise.all([applied, count, members]);
      return { matched: counted.matched, members: memberIds.length, visible: Number(v.contentEl.dataset.visibleNodes), persisted: v.plugin.settings.explore.view.filters };
    });
    assert.equal(result.matched, 100); assert.equal(result.members, 100); assert.equal(result.visible, 100);
    assert.equal(result.persisted[0].expr, 'note.category == "Category 1"'); receipt.savedViewOverlap = result;
  });
});
