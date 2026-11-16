import { test, expect, beforeEach, afterEach } from 'bun:test';
import './support/obsidian-fixture';
import { ControlElement, control } from './support/controls-dom';
import GraphPlugin, { GraphView } from '../src/main';
import { folderPredicate, folderView } from '../src/saved-views';
import { emptyView, explore, validateSaved, type SavedView } from '../src/core/explore';
import { buildProjection, colorGroups } from '../src/core/projection';
import { defaults, loadSettings, settingsForSave } from '../src/settings';

const old = new Map<string, any>();
beforeEach(() => {
  for (const key of ['document', 'HTMLElement', 'HTMLInputElement']) old.set(key, (globalThis as any)[key]);
  Object.assign(globalThis, { document: { get activeElement() { return ControlElement.active; } }, HTMLElement: ControlElement, HTMLInputElement: ControlElement });
});
afterEach(() => { for (const [key, value] of old) { if (value === undefined) delete (globalThis as any)[key]; else (globalThis as any)[key] = value; } ControlElement.active = undefined; });
const tick = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
function deferred<T = void>() { let resolve!: (value: T) => void, reject!: (error: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function pluginFixture() {
  const plugin: any = Object.create(GraphPlugin.prototype), data = { disk: '' }, calls: string[] = [];
  Object.assign(plugin, { settings: defaults('links'), writes: Promise.resolve(), async saveData(value: unknown) { calls.push('write'); data.disk = JSON.stringify(value); }, saveSoon() { calls.push('coalesced preference'); }, apply() { throw Error('Full apply forbidden'); }, notify() { throw Error('Rebuild forbidden'); } });
  return { plugin, data, calls };
}
async function fixture() {
  const f = pluginFixture(), settings = f.plugin.settings, view: any = Object.create(GraphView.prototype), camera = { x: .2, y: .4, ratio: .7 };
  const projection = buildProjection(['Notes/a.md', 'Notes/Sub/b.md', 'NotesElse/c.md', 'Other/d.md'].map(path => ({ path, properties: {} })), settings.declaration);
  const colors = colorGroups(projection, settings.declaration), result = (v: any) => explore(projection, settings.declaration, v, colors, 0, { facetValues: 10 });
  const renderer = { gpu: true, camera, previewSizing() {}, calls: [] as string[], setView() { this.calls.push('display'); }, clearTrail() {}, flyTo(x: number, y: number, ratio: number) { this.calls.push('camera'); Object.assign(camera, { x, y, ratio }); }, policy: { reasons: [] }, carrierCount: 0 };
  f.plugin.pipeline = { async request(_revision: number, message: any) { f.calls.push(message.kind); return { explore: result(message.view), colors, groups: { groups: [], groupEdges: [] }, view: 2 }; }, cancelEvaluation() { f.calls.push('cancel'); } };
  f.plugin.subscribe = () => () => {};
  Object.assign(view, { plugin: f.plugin, contentEl: new ControlElement(), view: emptyView(), projection, explored: result(emptyView()), colors, visible: new Uint8Array(4).fill(1), activeRevision: 1, detailGeneration: 1, groupGeneration: 1, renderRevision: 1, exploreRequest: 0, members: new Map(), contributions: new Map(), closed: false, provisional: false, detailRenderer: renderer, contributionPage: { update() {}, clear() {} }, app: { workspace: { on() {} }, vault: { getMarkdownFiles: () => [] } }, registerEvent() {}, groupColor() { return '#808080'; }, async refresh() {} });
  view.contentEl.dataset.mode = 'nodes'; await view.onOpen(); view.explorePanel.show('views');
  return { ...f, view, panel: view.explorePanel as any, renderer, camera, projection, result };
}
function input(panel: any, label: string, value: string) {
  const element: any = panel.body.querySelectorAll('input').find((e: ControlElement) => e.getAttribute('aria-label') === label);
  expect(element).toBeDefined(); element.value = value; element.oninput();
}
function prepare(panel: any, folder = 'Notes', name = 'Folder focus') {
  control(panel.body, 'Set up folder view…').click(); input(panel, 'Folder prefix', folder); input(panel, 'Saved view name', name);
}

test('Show everything clears every restriction, keeps grouping/camera and never saves a built-in', async () => {
  const f = await fixture(), saved = folderView('Notes', 'Everything');
  f.plugin.settings.explore.savedViews = [saved];
  const requested = { ...folderView('Notes', 'Focus').view, query: 'a', hiddenGroups: ['Sub'], collapsedGroups: ['Notes'], hiddenColors: ['red'], hiddenTypes: ['link'] };
  f.view.view = requested; f.panel.setState(requested);
  const camera = { ...f.camera }, before = structuredClone(f.plugin.settings.explore.savedViews);
  await (control(f.panel.body, 'Show everything') as any).onclick();
  expect(f.view.view).toEqual({ ...emptyView(), group: requested.group });
  expect(f.view.view.group).not.toBe(requested.group);
  expect(f.camera).toEqual(camera); expect(f.plugin.settings.explore.savedViews).toEqual(before);
  expect(f.calls.filter(c => c === 'write')).toEqual([]);
  expect(f.panel.body.querySelectorAll('button').filter((b: any) => b.textContent === 'Show everything')).toHaveLength(1);
  expect(f.panel.body.querySelectorAll('button').filter((b: any) => b.textContent === 'Delete')).toHaveLength(1);
  expect(f.panel.body.textContent).not.toContain('Default view'); f.panel.dispose();
});
test('Show everything respects loading and selected-group scope', async () => {
  const f = await fixture();
  f.view.detailScope = new Uint8Array([1, 0, 0, 0]); f.panel.render();
  expect(control(f.panel.body, 'Show everything').disabled).toBe(true);
  expect(f.panel.body.textContent).toContain('Workspace scope');
  f.view.detailScope = undefined; f.view.detailGeneration = 0; f.panel.render();
  expect(control(f.panel.body, 'Show everything').disabled).toBe(true); f.panel.dispose();
});

test('scout W1 opened saved folder grouping remains selected without another graph request', async () => {
  const f = await fixture(), saved = folderView('Notes', 'Folder focus');
  await f.plugin.commitSavedView(saved, null); await f.view.openSavedView(f.plugin.settings.explore.savedViews[0]);
  const graphCalls = () => f.calls.filter(c => c !== 'coalesced preference' && c !== 'write'); // panel-open persistence is not a graph request
  const calls = graphCalls(), visible = f.view.visible, source = structuredClone(f.view.view.group);
  f.panel.show('filters');
  const select = f.panel.body.querySelectorAll('select').find((e: ControlElement) => e.getAttribute('aria-label') === 'Group by');
  expect(select.querySelectorAll('option').some((e: any) => e.selected && e.textContent === 'Folder depth 1 under Notes')).toBe(true);
  expect(graphCalls()).toEqual(calls); expect(f.view.visible).toBe(visible); expect(f.view.view.group).toEqual(source); f.panel.dispose();
});
for (const failed of [false, true]) test(`scout K1 save focus stays enabled and attached through ${failed ? 'failure' : 'success'}`, async () => {
  const f = await fixture(), gate = deferred(); prepare(f.panel);
  f.panel.host.commitSavedView = () => gate.promise;
  control(f.panel.body, 'Save view').focus(); const done = f.panel.saveViewDraft(null);
  expect(ControlElement.active).toBe(f.panel.closeButton); expect(ControlElement.active?.disabled).toBe(false); expect(f.panel.root.contains(ControlElement.active)).toBe(true);
  if (failed) gate.reject(new Error('Synthetic rejected save')); else gate.resolve(); await done;
  const expected = control(f.panel.body, failed ? 'Save view' : 'Open'); expect(ControlElement.active).toBe(expected);
  expect(expected.disabled).toBe(false); expect(f.panel.root.contains(expected)).toBe(true); expect(f.renderer.calls).toEqual([]); f.panel.dispose();
});
for (const away of ['close', 'switch', 'blur-and-return']) test(`scout K1 save completion cannot reclaim focus after ${away}`, async () => {
  const f = await fixture(), gate = deferred(); prepare(f.panel); f.panel.host.commitSavedView = () => gate.promise;
  control(f.panel.body, 'Save view').focus(); const done = f.panel.saveViewDraft(null);
  if (away === 'close') f.panel.close();
  else if (away === 'switch') f.panel.show('filters');
  else { new ControlElement('BUTTON').focus(); f.panel.closeButton.focus(); }
  const active = ControlElement.active; gate.resolve(); await done;
  expect(ControlElement.active).toBe(active); expect(f.renderer.calls).toEqual([]); f.panel.dispose();
});
function actualApply(f: Awaited<ReturnType<typeof fixture>>) {
  let notifications = 0;
  Object.assign(f.plugin, { apply: GraphPlugin.prototype.apply, work: Promise.resolve(), adapter: { configure() {} }, resetStore() {}, notify() { notifications++; } });
  f.view.contentEl.dataset.state = 'ready'; f.view.provisional = true; f.view.statusText = 'Base coverage warning';
  return () => notifications;
}
function submitMissingFilter(f: Awaited<ReturnType<typeof fixture>>) {
  f.panel.show('filters');
  const field = f.panel.body.querySelectorAll('input').find((e: ControlElement) => e.getAttribute('aria-label') === 'Filter expression');
  field.value = 'note.extra == "yes"'; field.oninput();
  control(field.parent, 'Apply expression').click();
}
test('scout R1 production apply rejection retains requested filter and retries only explicitly', async () => {
  const f = await fixture(), notifications = actualApply(f), projection = f.view.projection; let writes = 0;
  f.plugin.saveData = async () => { if (++writes === 1) throw new Error('Synthetic storage unavailable'); };
  submitMissingFilter(f); await f.plugin.work.catch(() => {}); await tick();
  expect(writes).toBe(1); expect(notifications()).toBe(0); expect(f.view.projection).toBe(projection);
  expect(f.view.view.filters.length).toBe(1); expect(f.panel.alert.textContent).toContain('storage may be incomplete');
  expect(f.view.statusSummary.textContent).toContain('Waiting for property verification'); expect(f.view.statusText).toBe('Base coverage warning');
  control(f.panel.alert, 'Retry view').click(); await f.plugin.work; await tick();
  expect(writes).toBe(2); expect(notifications()).toBe(1); expect(f.panel.alert.textContent).toBe('');
  expect(f.view.statusSummary.textContent).toContain('Waiting for property verification'); expect(f.renderer.calls).toEqual([]); f.panel.dispose();
});
for (const next of ['newer', 'closed']) test(`scout R1 late apply rejection is inert after ${next}`, async () => {
  const f = await fixture(), gate = deferred(); actualApply(f); f.plugin.saveData = () => gate.promise;
  submitMissingFilter(f); await tick();
  if (next === 'newer') { f.view.setView(emptyView()); await tick(); } else f.view.closed = true;
  const before = f.panel.alert.textContent; gate.reject(new Error('Obsolete failure')); await f.plugin.work.catch(() => {}); await tick();
  expect(f.panel.alert.textContent).toBe(before); expect(f.panel.alert.textContent).not.toContain('Obsolete failure'); f.panel.dispose();
});
test('scout R2 current success retires view error while preserving base warnings', async () => {
  const f = await fixture(), request = f.plugin.pipeline.request; actualApply(f);
  f.plugin.pipeline.request = async () => { throw new Error('Synthetic view failure'); };
  f.view.setView({ ...emptyView(), query: 'a' }); await tick(); expect(f.view.statusSummary.textContent).toContain('View not applied');
  f.plugin.pipeline.request = request; f.view.setView({ ...emptyView(), query: 'b' }); await tick();
  expect(f.panel.alert.textContent).toBe(''); expect(f.view.statusSummary.textContent).not.toContain('View not applied');
  expect(f.view.statusSummary.textContent).toContain('Waiting for property verification'); expect(f.view.statusText).toBe('Base coverage warning');
  expect([...f.view.visible]).toEqual([...f.result(f.view.view).visible]); f.panel.dispose();
});
test('scout R2 superseded rejection cannot overwrite a queued newer request', async () => {
  const f = await fixture(), gate = deferred<any>(), request = f.plugin.pipeline.request; let calls = 0;
  f.plugin.pipeline.request = (...args: any[]) => ++calls === 1 ? gate.promise : request(...args);
  f.view.setView({ ...emptyView(), query: 'a' }); f.view.setView({ ...emptyView(), query: 'b' });
  gate.reject(new Error('Obsolete failure')); await tick();
  expect(calls).toBe(2); expect(f.panel.alert.textContent).toBe(''); expect(f.view.statusSummary.textContent).not.toContain('Obsolete failure');
  expect([...f.view.visible]).toEqual([...f.result(f.view.view).visible]); f.panel.dispose();
});
test('batch 4 F1 failed saved-view Open offers no Retry view that would bypass its checks', async () => {
  const f = await fixture(), saved = folderView('Notes', 'Focus'), displayed = f.view.explored; saved.view.hiddenGroups = ['Notes'];
  await expect(f.view.openSavedView(saved)).rejects.toThrow('Not present in the saved grouping: Notes');
  expect(f.panel.alert.querySelectorAll('button').some((b: ControlElement) => b.textContent === 'Retry view')).toBe(false);
  f.view.admitDetail = () => false; await expect(f.view.openSavedView(folderView('Notes', 'Focus'))).rejects.toThrow('Detail limit');
  expect(f.panel.alert.querySelectorAll('button').length).toBe(0); expect(f.view.explored).toBe(displayed); expect(f.renderer.calls).toEqual([]); f.panel.dispose();
});
test('batch 4 L2 saved-view Open is re-enabled once refresh finishes loading', async () => {
  const f = await fixture(); let during: boolean | undefined;
  f.plugin.settings.explore.savedViews = [folderView('Notes', 'Focus')]; f.plugin.serialize = (run: () => Promise<void>) => run();
  Object.assign(f.view, { refresh: GraphView.prototype.refresh, refreshOnce: async () => { f.panel.render(); during = (control(f.panel.body, 'Open') as any).disabled; } });
  await f.view.refresh();
  expect(during).toBe(true); expect((control(f.panel.body, 'Open') as any).disabled).toBe(false); expect(f.panel.body.textContent).not.toContain('Graph is loading'); f.panel.dispose();
});
test('batch 4 F2 a refresh that rebuilds the requested view retires its stale failure message', async () => {
  const f = await fixture(), projection = f.view.projection, explored = f.view.explored; actualApply(f); let writes = 0;
  f.plugin.saveData = async () => { if (++writes === 1) throw new Error('Synthetic storage unavailable'); };
  submitMissingFilter(f); await f.plugin.work.catch(() => {}); await tick();
  expect(f.view.statusSummary.textContent).toContain('View not applied'); expect(control(f.panel.alert, 'Retry view')).toBeDefined();
  const replies: Record<string, unknown> = { configure: { declarationHash: 'd', layoutHash: 'l', ingestHash: 'i' }, project: { nodes: 4, edges: 0, unresolved: 0, quarantined: [], meta: { key: 'k' } },
    detail: { projection, visible: new Uint8Array(4).fill(1), colors: f.view.colors, explore: explored, view: 3 }, layout: { positions: new Float32Array(8), milliseconds: 1, cached: true } };
  Object.assign(f.plugin, { serialize: (run: () => Promise<void>) => run(), nextRevision: 1, ingestedHash: '', pipeline: { async request(_revision: number, message: any) { return replies[message.kind]; } },
    adapter: { configure() {}, async *columns() {}, coverage: () => ({ indexed: 1, listed: 1 }), factsComplete: () => true, pendingProperties: () => 0, linksPending: () => false, invalidate() {} } });
  f.plugin.settings.persistLayout = false;
  Object.assign(f.view, { refresh: GraphView.prototype.refresh, revision: 0, gpu: { available: true, reason: 'Synthetic' }, startupTrace: [], cacheTrace: [], contributionPage: { update() {}, clear() {}, suspend() {}, fail() {} } });
  await f.view.refresh();
  expect(f.view.contentEl.dataset.state).toBe('ready'); expect(f.view.view.filters.length).toBe(1);
  expect(f.view.statusSummary.textContent).not.toContain('View not applied'); expect(f.panel.alert.textContent).toBe(''); f.panel.dispose();
});
test('batch 4 F4 a finishing view request keeps an unrelated validation alert', async () => {
  const f = await fixture(), gate = deferred<any>(), request = f.plugin.pipeline.request;
  f.plugin.pipeline.request = () => gate.promise;
  f.panel.update({ query: 'a' }); f.panel.update({ query: 'x'.repeat(513) }); expect(f.panel.alert.textContent).toContain('Not applied');
  gate.resolve(await request(1, { kind: 'explore', view: { ...emptyView(), query: 'a' } })); await tick();
  expect(f.view.view.query).toBe('a'); expect(f.panel.alert.textContent).toContain('Not applied'); f.panel.dispose();
});
test('batch 4 F4/F5 ordinary Retry re-issues the same view, keeps focus on an enabled control and is inert once superseded', async () => {
  const f = await fixture(), request = f.plugin.pipeline.request, sent: string[] = [];
  f.plugin.pipeline.request = async (_revision: number, message: any) => { sent.push(JSON.stringify(message.view)); throw new Error('Synthetic view failure'); };
  f.view.setView({ ...emptyView(), query: 'a' }); await tick();
  const retry = control(f.panel.alert, 'Retry view'); retry.focus(); retry.click(); await tick();
  expect(sent.length).toBe(2); expect(sent[1]).toBe(sent[0]); expect(JSON.parse(sent[0]!).query).toBe('a');
  expect(f.panel.root.contains(ControlElement.active)).toBe(true); expect(ControlElement.active?.disabled).toBe(false);
  const stale = control(f.panel.alert, 'Retry view'), gate = deferred<any>(); let newer = 0;
  f.plugin.pipeline.request = () => { newer++; return gate.promise; };
  f.view.setView({ ...emptyView(), query: 'b' }); stale.click(); await tick(); expect(newer).toBe(1); expect(sent.length).toBe(2);
  gate.resolve(await request(1, { kind: 'explore', view: { ...emptyView(), query: 'b' } })); await tick();
  expect(f.view.view.query).toBe('b'); expect(f.panel.alert.textContent).toBe(''); f.panel.dispose();
});
test('batch 4 F5 aggregate graphs make no view request and no settings write', async () => {
  const f = await fixture(), before = [...f.calls], view = f.view.view; f.plugin.settings.projectionFile = 'aggregate.json';
  f.view.setView({ ...emptyView(), query: 'a' }); await tick();
  expect(f.calls).toEqual(before); expect(f.view.view).toBe(view); expect(f.plugin.settings.explore.view.query).toBe(''); f.panel.dispose();
});
test('folder recipe uses the shared builder and exact boundaries, including zero matches', () => {
  expect(folderPredicate('/Notes/Sub/')).toEqual({ kind: 'folder', prefix: ['Notes', 'Sub'] });
  expect(() => folderView('', 'Empty')).toThrow('Choose');
  const s = defaults('links'), paths = ['Notes/a.md', 'Notes/Sub/b.md', 'NotesElse/c.md', 'Notes.md'];
  const p = buildProjection(paths.map(path => ({ path, properties: {} })), s.declaration);
  for (const folder of ['Notes', 'Absent']) {
    const saved = folderView(folder, folder); validateSaved([saved]);
    const r = explore(p, s.declaration, saved.view, colorGroups(p, s.declaration), 0, { facetValues: 10 });
    expect(p.paths.filter((_, i) => r.visible[i])).toEqual(p.paths.filter(path => path.startsWith(folder + '/')));
    expect(saved.camera).toBeNull(); expect(saved.view.query).toBe(''); expect(saved.view.hiddenGroups).toEqual([]);
    expect(saved.view.group).toEqual({ from: 'folder', depth: 1, prefix: [folder] });
  }
});

test('production panel cancel, Escape, tool switch and ordinary rerender preserve graph ownership', async () => {
  const f = await fixture(), { panel, view } = f;
  const snapshot = [view.projection, view.detailRenderer, view.visible, view.view, view.detailScope, f.camera, view.stage];
  for (const cancel of ['Cancel', 'Escape', 'switch']) {
    panel.show('views'); prepare(panel); panel.render();
    expect(panel.viewDraft.saved.name).toBe('Folder focus'); expect(panel.body.textContent).toContain('matches are checked then');
    if (cancel === 'Cancel') control(panel.body, 'Cancel').click();
    else if (cancel === 'Escape') panel.root.onkeydown({ key: 'Escape', preventDefault() {}, stopPropagation() {} });
    else panel.show('filters');
    expect(panel.viewDraft).toBeUndefined();
    expect([view.projection, view.detailRenderer, view.visible, view.view, view.detailScope, f.camera, view.stage]).toEqual(snapshot);
  }
  expect(f.plugin.settings.explore.savedViews).toEqual([]); expect(f.renderer.calls).toEqual([]); expect(f.calls.filter(c => c !== 'coalesced preference')).toEqual([]); panel.dispose();
});

test('prepare → acknowledged Save → explicit Open → real loader retains the ordinary record', async () => {
  const f = await fixture(), { panel, plugin, view } = f, gate = deferred();
  expect(panel.body.textContent).toContain('Starting points'); expect(plugin.settings.explore.savedViews).toEqual([]);
  const write = plugin.saveData; let writes = 0;
  plugin.saveData = async (value: unknown) => { if (++writes === 1) await gate.promise; await write(value); };
  prepare(panel, 'Notes', 'Folder ' + 'a'.repeat(80)); control(panel.body, 'Save view').click(); await tick();
  expect(panel.body.textContent).toContain('Saving…'); expect(plugin.settings.explore.savedViews).toEqual([]); expect(f.renderer.calls).toEqual([]);
  plugin.settings.visuals.edgeOpacity = .123; panel.close(); gate.resolve(); await plugin.writes; await tick();
  expect(plugin.settings.visuals.edgeOpacity).toBe(.123); expect(JSON.parse(f.data.disk).settings.visuals.edgeOpacity).toBe(.123);
  expect(writes).toBe(2); expect(view.view).toEqual(emptyView()); expect(f.renderer.calls).toEqual([]);
  panel.show('views'); expect(panel.body.textContent).toContain('Current graph unchanged');
  await (control(panel.body, 'Open') as any).onclick();
  expect(panel.body.textContent).toContain('Opened'); expect(f.calls.filter(c => c === 'explore')).toHaveLength(1); expect(f.renderer.calls).toEqual(['display']);
  expect(view.explored.visible.reduce((n: number, x: number) => n + x, 0)).toBe(2);
  const loaded = await loadSettings({ stat: async () => ({ size: new TextEncoder().encode(f.data.disk).byteLength }), read: async () => f.data.disk } as any, 'data.json', 'links', () => { throw Error('Unexpected quarantine'); });
  expect(loaded.settings.explore.savedViews).toEqual(plugin.settings.explore.savedViews); expect(f.data.disk).toContain('$text'); panel.dispose();
});

test('save failures retain the draft; failed compensation reports uncertainty on reopen', async () => {
  for (const failRecovery of [false, true]) {
    const f = await fixture(), gate = deferred(); let calls = 0;
    f.plugin.saveData = async () => { if (++calls === 1) { await gate.promise; throw Error('synthetic write failure'); } if (failRecovery) throw Error('synthetic recovery failure'); };
    prepare(f.panel); control(f.panel.body, 'Save view').click(); await tick(); f.panel.close(); gate.resolve(); await f.plugin.writes.catch(() => {}); await tick(); f.panel.show('views');
    expect(f.panel.viewDraft.saved.name).toBe('Folder focus'); expect(f.plugin.settings.explore.savedViews).toEqual([]);
    expect(f.panel.body.textContent).toContain(failRecovery ? 'stored settings could not be confirmed' : 'synthetic write failure'); expect(f.renderer.calls).toEqual([]); f.panel.dispose();
  }
});

test('collision replacement is explicit, preserves position and refuses stale targets and list overflow', async () => {
  const f = await fixture(), first = folderView('Other', 'First'), target = folderView('Other', 'Folder focus');
  f.plugin.settings.explore.savedViews = [first, target]; f.panel.render(); prepare(f.panel); control(f.panel.body, 'Save view').click();
  expect(f.panel.body.textContent).toContain('already exists'); expect(f.plugin.settings.explore.savedViews[1]).toBe(target); expect(f.data.disk).toBe('');
  control(f.panel.body, 'Keep editing').click(); control(f.panel.body, 'Save view').click(); control(f.panel.body, 'Replace existing view').click(); await f.plugin.writes; await tick();
  expect(f.plugin.settings.explore.savedViews.map((s: SavedView) => s.name)).toEqual(['First', 'Folder focus']); expect(f.plugin.settings.explore.savedViews[1].view).toEqual(folderView('Notes', 'x').view);
  await expect(f.plugin.commitSavedView(folderView('Notes', 'Folder focus'), target)).rejects.toThrow('changed');
  f.plugin.settings.explore.savedViews = Array.from({ length: 200 }, (_, i) => folderView('Notes', `View ${i}`));
  await expect(f.plugin.commitSavedView(folderView('Notes', 'Extra'), null)).rejects.toThrow('200');
  await f.plugin.commitSavedView(null, f.plugin.settings.explore.savedViews[0]); expect(f.plugin.settings.explore.savedViews).toHaveLength(199); f.panel.dispose();
});

test('queued save uses latest unrelated settings and draft configuration changes require review', async () => {
  const f = await fixture(), gate = deferred(); f.plugin.writes = gate.promise;
  const saved = folderView('Notes', 'Queued'), save = f.plugin.commitSavedView(saved, null);
  f.plugin.settings.nodeSize = 3; gate.resolve(); await save;
  expect(JSON.parse(f.data.disk).settings.nodeSize).toBe(3);
  prepare(f.panel); f.plugin.settings.declaration.columns.push('new-column'); control(f.panel.body, 'Save view').click(); await tick();
  expect(f.panel.body.textContent).toContain('Graph configuration changed'); expect(f.plugin.settings.explore.savedViews).toHaveLength(1); f.panel.dispose();
});

test('Open refuses loading, aggregate, missing dependencies, stale hidden choices and scoped expansion', async () => {
  const f = await fixture(), saved = folderView('Notes', 'Focus'), original = f.view.view;
  const cases: [() => void, () => void, string][] = [
    [() => { f.view.detailGeneration = 0; }, () => { f.view.detailGeneration = 1; }, 'loading'],
    [() => { f.plugin.settings.projectionFile = 'synthetic.json'; }, () => { f.plugin.settings.projectionFile = ''; }, 'aggregate'],
    [() => { f.view.detailScope = new Uint8Array([1, 0, 0, 0]); }, () => { f.view.detailScope = undefined; }, 'Workspace scope'],
    [() => { saved.view.filters.push({ kind: 'exists', key: 'missing' }); }, () => { saved.view.filters.pop(); }, 'Requires projected property: missing'],
    [() => { saved.view.hiddenTypes = ['absent']; }, () => { saved.view.hiddenTypes = []; }, 'Not present'],
  ];
  for (const [set, reset, message] of cases) { set(); await expect(f.view.openSavedView(saved)).rejects.toThrow(message); expect(f.view.view).toBe(original); reset(); }
  expect(f.calls.filter(c => c === 'explore')).toEqual([]); expect(f.renderer.calls).toEqual([]); f.panel.dispose();
});

for (const [field, key] of [['hiddenGroups', 'Sub'], ['collapsedGroups', '(root)']] as const) test(`Open validates ${field} against the saved grouping`, async () => {
  const f = await fixture(), saved = folderView('Notes', 'Focus');
  saved.view[field] = [key];
  expect(f.view.explored.groupKeys).not.toContain(key);
  expect(f.result(saved.view).groupKeys).toContain(key);
  await f.view.openSavedView(saved);
  expect(f.view.explored.groupKeys).toContain(key);
  expect(f.view.view[field]).toEqual([key]);
  expect(f.renderer.calls).toEqual(['display']); f.panel.dispose();
});

test('Open rejects a hidden key absent from the saved grouping before adopting the result', async () => {
  const f = await fixture(), saved = folderView('Notes', 'Focus'), displayed = f.view.explored;
  saved.view.hiddenGroups = ['Notes'];
  expect(displayed.groupKeys).toContain('Notes');
  expect(f.result(saved.view).groupKeys).not.toContain('Notes');
  await expect(f.view.openSavedView(saved)).rejects.toThrow('Not present in the saved grouping: Notes');
  expect(f.view.explored).toBe(displayed);
  expect(f.renderer.calls).toEqual([]); f.panel.dispose();
});

test('Open failure/cap refusal leaves displayed result intact but requested settings honest', async () => {
  const f = await fixture(), saved = folderView('Notes', 'Focus'), displayed = f.view.explored;
  f.plugin.settings.explore.savedViews = [saved, { name: 'Previous', view: emptyView(), camera: null }]; f.panel.render();
  expect(f.panel.buttons.get('views').title).toBe('Saved views (requested: Previous)');
  f.plugin.pipeline.request = async () => { throw Error('synthetic worker failure'); };
  await (control(f.panel.body, 'Open') as any).onclick(); expect(f.panel.body.textContent).toContain('Displayed graph may still show the previous result');
  expect(f.view.explored).toBe(displayed); expect(f.plugin.settings.explore.view).toEqual(saved.view); expect(f.renderer.calls).toEqual([]);
  expect(f.panel.buttons.get('views').title).toBe('Saved views (requested: Focus)');
  f.plugin.pipeline.request = async () => ({ explore: f.result(saved.view), colors: new Uint32Array(4), groups: {}, view: 2 });
  let admissions = 0; f.view.admitDetail = () => { admissions++; return false; };
  await expect(f.view.openSavedView(saved)).rejects.toThrow('Detail limit'); expect(admissions).toBe(1); expect(f.view.explored).toBe(displayed); expect(f.renderer.calls).toEqual([]); f.panel.dispose();
});

test('superseded Open cannot display or restore camera; latest success restores it once', async () => {
  const f = await fixture(), first = { ...folderView('Notes', 'First'), camera: { x: .9, y: .8, ratio: .1 } }, second = { ...folderView('Other', 'Second'), camera: { x: .1, y: .2, ratio: .3 } };
  const gates: ReturnType<typeof deferred<any>>[] = [];
  f.plugin.pipeline.request = () => { const gate = deferred<any>(); gates.push(gate); return gate.promise; };
  const a = f.view.openSavedView(first);
  const b = f.view.openSavedView(second); await expect(a).rejects.toThrow('superseded');
  gates[0]!.resolve({ explore: f.result(first.view), colors: new Uint32Array(4), groups: {}, view: 2 }); await tick();
  expect(f.renderer.calls).toEqual([]);
  gates[1]!.resolve({ explore: f.result(second.view), colors: new Uint32Array(4), groups: {}, view: 3 }); await b;
  expect(f.renderer.calls).toEqual(['display', 'camera']); expect(f.camera).toEqual(second.camera); f.panel.dispose();
});

test('generation/configuration change during Open rejects completion and camera; group mode stays group mode', async () => {
  for (const mutate of [(f: any) => f.view.activeRevision++, (f: any) => f.plugin.settings.declaration.columns.push('changed'), (f: any) => { f.view.closed = true; }]) {
    const f = await fixture(), gate = deferred<any>(), saved = { ...folderView('Notes', 'Focus'), camera: { x: .1, y: .2, ratio: .3 } };
    f.plugin.pipeline.request = () => gate.promise; const pending = f.view.openSavedView(saved); mutate(f);
    gate.resolve({ explore: f.result(saved.view), colors: new Uint32Array(4), groups: {}, view: 2 }); await expect(pending).rejects.toThrow('changed'); expect(f.renderer.calls).toEqual([]); f.panel.dispose();
  }
  const f = await fixture(); f.view.contentEl.dataset.mode = 'groups'; let groups = 0; f.view.showGroups = () => { groups++; };
  await f.view.openSavedView({ ...folderView('Notes', 'Focus'), camera: { x: 0, y: 0, ratio: 1 } });
  expect(groups).toBe(1); expect(f.view.contentEl.dataset.mode).toBe('groups'); expect(f.renderer.calls).toEqual([]); f.panel.dispose();
});
