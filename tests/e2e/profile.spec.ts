import { browser, $ } from '@wdio/globals';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
const tag = `${process.env.GRAPH_LARGE ? 'large' : 'small'}-${process.env.GRAPH_SOFTWARE ? 'software' : 'hardware'}`;
const runDirectory = `.workspace/evidence/runs/profile-${tag}-${Date.now()}-${process.pid}`;
describe('Synthetic native phase profile', () => {
  it('attributes startup and explicit detail separately', async () => {
    await mkdir(runDirectory, { recursive: true }); await mkdir('test-screenshots', { recursive: true });
    await browser.waitUntil(async () => browser.executeObsidian(({ app }) => { const files = app.vault.getMarkdownFiles(); return files.length >= 2000 && files.every(f => app.metadataCache.getFileCache(f) !== null); }), { timeout: 180000 });
    const address = (browser.capabilities as any)['goog:chromeOptions']?.debuggerAddress;
    const connection = address ? await chromium.connectOverCDP(`http://${address}`) : undefined;
    const cdp = connection ? await connection.contexts()[0]!.newCDPSession(connection.contexts()[0]!.pages()[0]!) : undefined;
    if (cdp) { await cdp.send('Performance.enable'); await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 500 }); await cdp.send('Profiler.start'); }
    await browser.executeObsidian(({ app }) => {
      const state = window as any, plugin = (app as any).plugins.plugins['graph-ng'];
      state.graphProfile = { origin: performance.now(), spans: [], reads: { count: 0, milliseconds: 0 }, tasks: [] };
      const profile = state.graphProfile;
      const read = plugin.adapter.read.bind(plugin.adapter);
      plugin.adapter.read = (path: string) => { const start = performance.now(); try { return read(path); } finally { profile.reads.count++; profile.reads.milliseconds += performance.now() - start; } };
      const columns = plugin.adapter.columns.bind(plugin.adapter);
      plugin.adapter.columns = async function* (...args: any[]) { const iterator = columns(...args); for (;;) { const start = performance.now(), before = profile.reads.milliseconds; const result = await iterator.next(); profile.spans.push({ phase: 'columns.next', start, end: performance.now(), readMs: profile.reads.milliseconds - before }); if (result.done) return; yield result.value; } };
      let onGroups: ((event: any) => void) | undefined;
      Object.defineProperty(plugin.pipeline, 'onGroups', { configurable: true, get: () => onGroups, set: callback => {
        onGroups = callback ? event => { const start = performance.now(); callback(event); const view = app.workspace.getLeavesOfType('graph-ng')[0]!.view as any; profile.spans.push({ phase: 'groups.paint', start, end: performance.now(), firstGroupMs: Number(view.contentEl.dataset.firstGroupMs), revision: event.revision }); } : undefined;
      } });
      const request = plugin.pipeline.request.bind(plugin.pipeline);
      plugin.pipeline.request = async (revision: number, body: any) => { const start = performance.now(); try { return await request(revision, body); } finally { profile.spans.push({ phase: `worker.${body.kind}`, start, end: performance.now() }); } };
      state.graphObserver = new PerformanceObserver(list => profile.tasks.push(...list.getEntries().map(t => ({ start: t.startTime, duration: t.duration })))); state.graphObserver.observe({ type: 'longtask' });
      // The registered factory is already installed. Observe the public view after creation.
      const leaves = app.workspace.getLeavesOfType('graph-ng'); for (const leaf of leaves) leaf.detach();
    });
    await browser.executeObsidianCommand('graph-ng:open');
    await browser.waitUntil(async () => (await $('.graph-ng-view').getAttribute('data-state')) === 'ready', { timeout: 180000 });
    await browser.saveScreenshot(`test-screenshots/profile-${tag}-groups.png`);
    const cold = await browser.executeObsidian(({ app }) => {
      const state = window as any, view = app.workspace.getLeavesOfType('graph-ng')[0]!.view as any;
      state.graphProfile.firstGroupMs = Number(view.contentEl.dataset.firstGroupMs); state.graphProfile.ready = performance.now();
      return { firstGroupMs: state.graphProfile.firstGroupMs };
    });
    // Drain only our queued metadata notification after recording cold paint;
    // otherwise its later verification intentionally supersedes detail navigation.
    await browser.executeObsidian(({ app }) => (app as any).plugins.plugins['graph-ng'].adapter.index.flush());
    await browser.waitUntil(async () => browser.executeObsidian(({ app }) => !(app.workspace.getLeavesOfType('graph-ng')[0]!.view as any).refreshing), { timeout: 180000 });
    if (process.env.GRAPH_PROFILE_DRILL) {
      await $('.graph-ng-group-controls button').click();
      const member = await $('.graph-ng-member'), path = await member.getText(); await member.click();
      await browser.waitUntil(async () => browser.executeObsidian(({ app }, path) => app.workspace.getActiveFile()?.path === path, path));
      await browser.executeObsidianCommand('graph-ng:open');
    }
    await $('.graph-ng-toolbar button:nth-child(2)').click();
    await browser.waitUntil(async () => (await $('.graph-ng-view').getAttribute('data-mode')) !== 'nodes-building', { timeout: 180000 });
    await browser.saveScreenshot(`test-screenshots/profile-${tag}-detail.png`);
    const result = await browser.executeObsidian(({ app }) => { const state = window as any; state.graphProfile.tasks.push(...state.graphObserver.takeRecords().map((t: PerformanceEntry) => ({ start: t.startTime, duration: t.duration }))); state.graphObserver.disconnect(); const view = app.workspace.getLeavesOfType('graph-ng')[0]!.view as any; return { ...state.graphProfile, startupTrace: view.startupTrace, rendererTimings: view.detailRenderer?.timings, mode: view.contentEl.dataset.mode }; });
    const metrics = cdp ? await cdp.send('Performance.getMetrics') : undefined;
    const receipt = JSON.stringify({ ...result, metrics, runDirectory, app: '1.13.7', debuggerAvailable: !!cdp }, null, 2);
    await writeFile(`${runDirectory}/profile.json`, receipt, { flag: 'wx' });
    await writeFile(`.workspace/evidence/profile-${tag}.json`, receipt);
    if (cdp) { const { profile } = await cdp.send('Profiler.stop'); await writeFile(`${runDirectory}/profile.cpuprofile`, JSON.stringify(profile), { flag: 'wx' }); await writeFile(`.workspace/evidence/profile-${tag}.cpuprofile`, JSON.stringify(profile)); await cdp.detach(); await connection!.close(); }
    console.log(JSON.stringify({ tag, ...cold, reads: result.reads, tasks: result.tasks, rendererTimings: result.rendererTimings }));
  });
});
