import { test, expect } from 'bun:test';
import { FixtureFile } from './support/obsidian-fixture';
import { ControlElement, control } from './support/controls-dom';
import { ExplorePanel } from '../src/explore-panel';
import { emptyView } from '../src/core/explore';

function controlsFixture(panelOpen = true) {
  const settings: any = { explore: { panelOpen, legendPageSize: 20 } }, root = new ControlElement();
  let persisted = 0, view: any = { ...emptyView(), filters: [] };
  const render = ExplorePanel.prototype.render;
  // Isolate the disclosure from unrelated sections; filter behavior below uses the real filter editor.
  ExplorePanel.prototype.render = function () {};
  let panel: any;
  try { panel = new ExplorePanel(root as any, { settings: () => settings, persist() { persisted++; }, setView(next: any) { view = next; } } as any, view); }
  finally { ExplorePanel.prototype.render = render; }
  panel.render = () => {};
  return { root, panel, settings, persisted: () => persisted, view: () => view };
}

test('persistent toolbar opens one overlay, keeps search visible and returns focus', () => {
  const f = controlsFixture(false), filters = control(f.root, 'Filters');
  filters.focus(); filters.click(); expect(f.panel.root.hidden).toBe(false); expect(f.panel.search.hidden).toBe(false);
  expect(filters.getAttribute('aria-controls')).toBe(f.panel.root.id); expect(filters.getAttribute('aria-expanded')).toBe('true');
  control(f.root, 'Layout').click(); expect(filters.getAttribute('aria-expanded')).toBe('false');
  f.panel.closeButton.click(); expect(f.panel.root.hidden).toBe(true); expect(ControlElement.active).toBe(control(f.root, 'Layout'));
  expect(f.settings.explore.panelOpen).toBe(false); expect(f.persisted()).toBe(3); f.panel.dispose();
});

test('filter text is non-destructive, removal is distinct and focused, expression editing is retained', () => {
  const f = controlsFixture(), filters: any[] = [{ kind: 'eq', key: 'category', value: '<synthetic>' }, { kind: 'exists', key: 'rank' }];
  let expression = '';
  f.panel.view = { ...emptyView(), filters }; f.panel.predicateForm = () => {};
  f.panel.expressionField = (_host: any, _result: any, _label: any, _context: any, submit: any) => { expression = f.panel.drafts.get('Edit filter 1'); submit('note.category == "changed"'); };
  f.panel.render = () => { f.panel.body.empty(); f.panel.filters(f.panel.body, { facets: [] }); };
  f.panel.render();
  const label = f.panel.body.querySelector('.graph-ng-chip-text');
  expect(label.textContent).toContain('<synthetic>'); expect(label.onclick).toBeUndefined();
  expect(f.panel.view.filters).toEqual(filters);
  // Pill actions are labelled icon buttons; find them by accessible name.
  const labelled = (prefix: string) => { const found = f.panel.body.querySelectorAll('button').find((b: ControlElement) => b.getAttribute('aria-label')?.startsWith(prefix)); expect(found).toBeDefined(); return found!; };
  const remove = labelled('Remove filter'); expect(remove.getAttribute('aria-label')).toBe('Remove filter: category is “<synthetic>”'); expect(remove.getAttribute('title')).toBeNull(); expect(remove.textContent).toBe('');
  remove.focus(); remove.click(); expect(f.view().filters).toEqual([filters[1]]);
  expect(ControlElement.active).toBe(labelled('Remove filter'));
  labelled('Remove filter').click(); expect(f.view().filters).toEqual([]); expect(ControlElement.active).toBe(f.panel.search);
  f.panel.view = { ...emptyView(), filters: [filters[0]] }; f.panel.render();
  // Stop the synthetic editor after applying once, as a real submit closes its draft.
  const expressionField = f.panel.expressionField;
  f.panel.expressionField = (...args: any[]) => { f.panel.expressionField = () => {}; expressionField(...args); };
  labelled('Edit filter 1 as expression').click();
  expect(expression).toContain('note.category'); expect(f.view().filters[0]).toEqual({ kind: 'expr', expr: 'note.category == "changed"' });
  f.panel.dispose();
});

test('filters inspector: inline stat rows, readable chips with named counts, facet toggles and an add control', () => {
  const f = controlsFixture(), result: any = { visible: [3, 4], nodes: 10, visibleEdges: 5, edges: 20, facets: [] };
  f.panel.host.scope = () => 'Workspace'; f.panel.host.scoped = () => false;
  f.panel.summary(false, result);
  const counts = f.panel.counts, row = (s: any) => [s.querySelector('svg')?.getAttribute('data-icon'), s.querySelector('.graph-ng-stat-label').textContent, s.querySelector('.graph-ng-count').textContent];
  expect(counts.querySelector('.graph-ng-scope-name')).toBeUndefined(); expect(counts.textContent).not.toContain('filter');
  expect(counts.querySelectorAll('.graph-ng-stat').map(row)).toEqual([['circle-dot', 'Notes shown', '7'], ['spline', 'Edges drawn', '5'], ['eye-off', 'Hidden, see why', '3 notes, 15 edges']]);
  // The hidden row leads to the breakdown.
  const opened: unknown[] = []; f.panel.show = (tool: string) => opened.push(tool); counts.querySelectorAll('.graph-ng-stat').at(-1).click(); expect(opened).toEqual(['information']); delete f.panel.show;
  f.panel.host.scoped = () => true; f.panel.host.scope = () => 'Group A'; f.panel.summary(false, result); expect(counts.querySelector('.graph-ng-scope-name').textContent).toBe('In Group A');
  f.panel.summary(true, undefined); expect(counts.textContent).toContain('External aggregate'); expect(counts.querySelector('.graph-ng-stat')).toBeUndefined();
  f.panel.view = { ...emptyView(), filters: [] }; f.panel.body.empty(); f.panel.filters(f.panel.body, result);
  expect(f.panel.body.querySelector('.graph-ng-chip')).toBeUndefined(); expect(f.panel.body.textContent).not.toContain('Every note is shown');
  const adder = f.panel.body.querySelector('.graph-ng-add-filter'); expect(adder.tagName).toBe('DETAILS'); expect(adder.querySelector('summary').textContent).toBe('Add filter');
  const add = f.panel.body.querySelector('.graph-ng-builder');
  expect(add.getAttribute('role')).toBe('group'); expect(add.getAttribute('aria-label')).toBe('Add filter');
  expect(control(add, 'Add filter').classes.has('mod-cta')).toBe(false);
  const filters = [{ kind: 'expr', expr: '!file.hasProperty("kind")' }, { kind: 'expr', expr: 'note.rank > 2 || note.rank < 0' }, { kind: 'exists', key: 'rank' }];
  f.panel.view = { ...emptyView(), filters };
  const counted = { ...result, filters, filterHidden: [191, 12, 0] };
  f.panel.body.empty(); f.panel.filters(f.panel.body, counted);
  const list = f.panel.body.querySelector('.graph-ng-chips'); expect(list.getAttribute('role')).toBe('list'); expect(list.getAttribute('aria-label')).toBe('Active filters');
  const chips = f.panel.body.querySelectorAll('.graph-ng-chip'); expect(chips.map((c: ControlElement) => c.getAttribute('role'))).toEqual(['listitem', 'listitem', 'listitem']);
  const text = chips.map((c: ControlElement) => c.querySelector('.graph-ng-chip-text'));
  expect(text.map((t: ControlElement) => t.querySelector('.graph-ng-help-trigger')?.textContent)).toEqual(['kind is missing', 'note.rank > 2 || note.rank < 0', 'rank exists']);
  expect(text.map((t: ControlElement) => t.classes.has('graph-ng-chip-code'))).toEqual([false, true, false]);
  expect(text[0]!.querySelector('.graph-ng-help-popover')?.textContent).toBe('!file.hasProperty("kind")'); expect(text[0]!.getAttribute('title')).toBeNull();
  expect(chips.map((c: any) => c.querySelector('.graph-ng-count').textContent)).toEqual(['191 notes hidden', '12 notes hidden', '0 notes hidden']);
  const actions = chips.map((c: ControlElement) => c.querySelectorAll('button').filter(b => !b.classes.has('graph-ng-help-trigger')).map(b => [b.getAttribute('aria-label'), b.textContent, b.querySelector('svg')?.getAttribute('data-icon')]));
  expect(actions[0]).toEqual([['Edit filter 1 as expression', '', 'pencil'], ['Remove filter: kind is missing', '', 'x']]);
  // Builder filters keep the JSON editor as a compact labelled disclosure inside the pill.
  const json = chips[2]!.querySelector('details'); expect(json.querySelector('summary').getAttribute('aria-label')).toBe('Edit builder filter 3 as JSON');
  expect(actions[2]!.map((a: any) => a[0])).toEqual(['Edit filter 3 as expression', null, 'Remove filter: rank exists']);
  // Counts remain specific to the exact filter list; obsolete counts are not shown.
  f.panel.view = { ...emptyView(), filters: [filters[0]] }; f.panel.body.empty(); f.panel.filters(f.panel.body, { ...counted, filters: [filters[0]], filterHidden: [191] });
  expect(f.panel.body.querySelector('.graph-ng-chip').querySelector('.graph-ng-count').textContent).toBe('191 notes hidden');
  f.panel.body.empty(); f.panel.filters(f.panel.body, { ...counted, filters: [filters[1]] });
  expect(f.panel.body.querySelector('.graph-ng-chip').querySelector('.graph-ng-count')).toBeUndefined();
  // Removing a chip removes exactly that filter.
  f.panel.view = { ...emptyView(), filters }; f.panel.body.empty(); f.panel.filters(f.panel.body, counted);
  f.panel.body.querySelectorAll('.graph-ng-remove')[1].click(); expect(f.view().filters).toEqual([filters[0], filters[2]]);
  expect(f.panel.body.textContent).not.toContain('·'); expect(f.panel.body.textContent).not.toContain('filter being used');
  f.panel.dispose();
});

test('facet toggles: one checkbox and aligned count per value; unticking and reticking rewrite the room filter', () => {
  const f = controlsFixture(), room = { kind: 'expr', expr: '!file.hasProperty("kind")' };
  const facet = (key: string, values: [string, number][]) => ({ key, distinct: values.length, values: values.map(([raw, count]) => ({ raw, label: raw === 'undefined' ? '(missing)' : JSON.parse(raw), count, visible: 0 })) });
  const result: any = { visible: [], nodes: 0, visibleEdges: 0, edges: 0, facets: [facet('kind', [['undefined', 16309], ['"mapping-set"', 89], ['"facet"', 81]]), facet('team', [['"A"', 3], ['"B"', 2]]), { ...facet('id', [['"x"', 1], ['"y"', 1]]), distinct: 900 }] };
  f.panel.view = { ...emptyView(), filters: [room] }; f.panel.render = () => { f.panel.body.empty(); f.panel.filters(f.panel.body, result); }; f.panel.render();
  const box = f.panel.body.querySelector('.graph-ng-toggles'); expect(box.getAttribute('aria-label')).toBe('Show notes by kind');
  // Truncated facets (more values than listed) never offer toggles.
  expect(box.querySelector('select').children.map((o: ControlElement) => o.value)).toEqual(['kind', 'team']);
  const rows = () => f.panel.body.querySelectorAll('.graph-ng-toggle').map((r: any) => [r.querySelector('input').getAttribute('aria-label'), (r.querySelector('input') as any).checked, r.querySelector('.graph-ng-count').textContent]);
  expect(rows()).toEqual([['Show (missing)', true, '16,309'], ['Show mapping-set', false, '89'], ['Show facet', false, '81']]);
  const tick = (label: string) => { const input: any = f.panel.body.querySelectorAll('input').find((i: ControlElement) => i.getAttribute('aria-label') === label)!; input.checked = !input.checked; input.onchange(); };
  tick('Show mapping-set'); expect(f.view().filters).toEqual([{ kind: 'expr', expr: '!["facet"].contains(note.kind)' }]);
  expect(rows().map((r: any) => r[1])).toEqual([true, true, false]);
  tick('Show mapping-set'); expect(f.view().filters).toEqual([room]);
  tick('Show (missing)'); expect(f.view().filters).toEqual([{ kind: 'expr', expr: 'file.hasProperty("kind")' }, room]);
  f.panel.dispose();
});

test('graph information retains full diagnostics while healthy summary stays quiet', async () => {
  const { GraphView } = await import('../src/main');
  const view: any = Object.create(GraphView.prototype), root = new ControlElement(), render = ExplorePanel.prototype.render;
  const persistedPanelStates: boolean[] = [];
  Object.assign(view, { contentEl: root, view: { query: '' }, closed: false, provisional: true,
    plugin: { settings: { explore: { panelOpen: false, legendPageSize: 20 } }, subscribe: () => () => {},
      saveSoon() { persistedPanelStates.push(view.plugin.settings.explore.panelOpen); } },
    app: { workspace: { on() {} } }, registerEvent() {}, async refresh() {} });
  ExplorePanel.prototype.render = function () {};
  try { await view.onOpen(); } finally { ExplorePanel.prototype.render = render; }
  view.explorePanel.render = () => {}; view.contentEl.dataset.state = 'building';
  const text = 'Reading properties: 4 read, 6 left. Filters and member lists are provisional.';
  view.statusText = text; expect(view.status.querySelector('.graph-ng-status-message').textContent).toBe(text); expect(view.statusSummary.hidden).toBe(false);
  expect(view.statusSummary.title).toBe(''); expect(view.status.parent).toBe(view.explorePanel.root);
  expect(persistedPanelStates).toEqual([]);
  const info = control(view.statusSummary, 'Graph information'); info.click(); expect(view.status.hidden).toBe(false); const status = view.status; view.statusText = text; expect(control(view.statusSummary, 'Graph information')).toBe(info);
  expect(persistedPanelStates).toEqual([true]);
  view.explorePanel.close(); expect(persistedPanelStates).toEqual([true, false]);
  expect(ControlElement.active).toBe(info);
  view.provisional = false; view.contentEl.dataset.state = 'ready'; view.statusText = '10 nodes verified.'; expect(view.statusSummary.hidden).toBe(true); expect(view.status).toBe(status);
  view.contentEl.dataset.state = 'error'; view.statusText = 'Graph NG: synthetic failure'; expect(view.statusSummary.hidden).toBe(false); expect(view.status.textContent).toContain('failure');
  view.explorePanel.dispose();
});

test('public property source changes refresh deferred facts, reject old epochs, and unregister without disposing provider', async () => {
  const { default: GraphPlugin } = await import('../src/main');
  const plugin: any = Object.create(GraphPlugin.prototype), host: any = new EventTarget();
  const cleanups: (() => void)[] = []; let invalidated = 0, notifications = 0, loads = 0, disposed = 0;
  Object.assign(plugin, { propertyRevision: 0, register: (fn: () => void) => cleanups.push(fn),
    adapter: { setPropertySource() { invalidated++; } }, app: { workspace: { getLeavesOfType: () => [] } }, notify() { notifications++; } });
  const source = { get() {}, load() { loads++; return Promise.resolve(); }, dispose() { disposed++; } };
  plugin.watchProperties(host); expect(plugin.propertySource).toBeUndefined();
  host.openclast = { propertyFacts: source }; host.dispatchEvent(new Event('oc:property-facts-changed'));
  await Promise.resolve(); expect(loads).toBe(1); expect(plugin.propertySource).toBe(source);
  const revision = plugin.propertyRevision;
  host.dispatchEvent(new Event('oc:property-facts-changed')); // successful deferred load, no native event
  expect(plugin.propertyRevision).toBe(revision + 1); expect(notifications).toBe(3); expect(loads).toBe(1);
  host.openclast.propertyFacts = { ...source }; host.dispatchEvent(new Event('oc:property-facts-changed'));
  await Promise.resolve(); expect(loads).toBe(2); expect(plugin.propertySource).not.toBe(source);
  cleanups.forEach(fn => fn()); const before = invalidated;
  host.dispatchEvent(new Event('oc:property-facts-changed')); expect(invalidated).toBe(before); expect(disposed).toBe(0);
});

test('verification scheduling keeps one audit active without revising or clearing the view', async () => {
  const { default: GraphPlugin } = await import('../src/main');
  const plugin: any = Object.create(GraphPlugin.prototype), host: any = new EventTarget();
  let resolve!: (v: boolean) => void, started!: () => void, promoted!: () => void;
  const audit = new Promise<boolean>(r => { resolve = r; }), running = new Promise<void>(r => { started = r; }), promotion = new Promise<void>(r => { promoted = r; });
  const cleanup: Function[] = []; let resets = 0, clears = 0, audits = 0;
  const source = { get() {} }; host.openclast = { propertyFacts: source };
  Object.assign(plugin, { propertySource: source, propertyRevision: 0, settings: { debounceMs: 1, ingest: { chunkRows: 1, budgetMs: 8 } },
    register: (f: Function) => cleanup.push(f), notify() {}, adapter: { setPropertySource() { resets++; }, async verifyProperties() { audits++; started(); return await audit; } },
    app: { workspace: { getLeavesOfType: () => [{ view: { invalidateSource() { clears++; }, promoteProperties() { promoted(); } } }] } } });
  plugin.watchProperties(host); const revision = plugin.propertyRevision;
  const event = () => host.dispatchEvent(new CustomEvent('oc:property-facts-changed', { detail: { reason: 'live_verified', invalidated: false } }));
  try {
    event(); await running;
    for (let i = 0; i < 24; i++) { event(); await Promise.resolve(); }
    expect(resets).toBe(1); expect(clears).toBe(1); expect(plugin.propertyRevision).toBe(revision); expect(audits).toBe(1);
    resolve(true); await promotion;
  } finally { cleanup.forEach(f => f()); }
});

test('queued layout persistence rechecks owner and captured store', async () => {
  const { default: GraphPlugin } = await import('../src/main');
  for (const obsolete of ['owner', 'store']) {
    const plugin: any = Object.create(GraphPlugin.prototype); let release!: () => void, owner = true, writes = 0;
    Object.assign(plugin, { settings: { persistLayout: true }, writes: new Promise<void>(r => { release = r; }), store: { async write() { writes++; } } });
    const pending = plugin.cache({}, () => owner);
    if (obsolete === 'owner') owner = false; else plugin.store = { async write() { writes++; } };
    release(); await pending; expect(writes).toBe(0);
    owner = true; await plugin.cache({}, () => owner); expect(writes).toBe(1);
  }
});

test('fact groups paint before layout, pending links prevent exact caching, and native readiness upgrades', async () => {
  const { GraphView } = await import('../src/main');
  const { LocalAdapter } = await import('../src/adapter/local');
  const { defaultDeclaration } = await import('../src/core/declaration');
  const { defaults } = await import('../src/settings');
  const { unpackRows } = await import('../src/core/columns');
  const { buildProjection } = await import('../src/core/projection');
  const { contractGroups } = await import('../src/core/group-projection');
  const files = [new FixtureFile('a.md')], links: any = {}, rows: any[] = [];
  const declaration = { ...defaultDeclaration('p@1'), groups: [{ from: 'key' as const, key: 'category' }] };
  const app: any = { vault: { getMarkdownFiles: () => files, getAbstractFileByPath: () => files[0], on() {}, read() { throw Error('no bodies'); } }, metadataCache: { getFileCache: () => null, resolvedLinks: links, on() {} } };
  const source = { get: () => ({ source: 'derived', state: 'current', verified: true, frontmatter: { category: 'Meaningful group' } }) };
  const adapter = new LocalAdapter(app, { register() {}, registerEvent() {} } as any, 'p@1', 1, () => {}, true, declaration, source);
  const settings: any = { ...defaults('p@1'), declaration, persistLayout: true };
  let encoded = 0, caches = 0, painted = 0, complete = false;
  const pipeline: any = { async request(revision: number, r: any) {
    switch (r.kind) {
      case 'configure': return { declarationHash: 'd', layoutHash: 'l', ingestHash: 'i' };
      case 'rows': if (r.reset) rows.length = 0; rows.push(...unpackRows(r.columns)); return;
      case 'project': {
        complete = r.complete;
        const p = buildProjection(rows, declaration), groups = contractGroups(p, new Uint8Array(p.paths.length).fill(1), 0).projection;
        expect(groups.groups[0]!.label).toBe('Meaningful group');
        pipeline.onGroups({ revision, view: 1, projection: groups });
        return { meta: { key: 'k' }, nodes: 1, edges: 0, unresolved: 0, quarantined: [] };
      }
      case 'detail': return { projection: {}, visible: new Uint8Array([1]), colors: new Uint32Array(1), explore: { visible: new Uint8Array([1]) }, view: 1 };
      case 'layout': expect(painted).toBeGreaterThan(0); return { positions: new Float32Array(2), milliseconds: 1, cached: false };
      case 'encode': encoded++; return {};
    }
  } };
  const plugin: any = { settings, propertySource: source, propertyRevision: 0, sourceIdentity: 'local', nextRevision: 0, linkProducer: 'p@1', adapter, pipeline,
    async migrate() {}, store: { async latest() {} }, async cache() { caches++; } };
  const view: any = Object.create(GraphView.prototype);
  Object.assign(view, { plugin, app, revision: 0, renderRevision: 0, closed: false, members: new Map(), contributions: new Map(), startupTrace: [], cacheTrace: [],
    contributionPage: { clear() {}, suspend() {}, update() {} }, contentEl: { dataset: {} }, status: new ControlElement(), statusSummary: new ControlElement(), gpu: { available: false, reason: 'Not probed' },
    showGroups() { painted++; expect(encoded).toBe(0); } });
  try {
    await view.refreshOnce(); expect(painted).toBe(1); expect(complete).toBe(false); expect(caches).toBe(0); expect(encoded).toBe(0);
    expect(view.contentEl.dataset.verified).toBe('false'); expect(view.status.textContent).toContain('Ready, source checks incomplete'); expect(view.statusSummary.textContent).not.toContain('1 note0 edges'); expect(view.statusSummary.textContent).toContain('Ready, source checks incomplete');
    links['a.md'] = {}; adapter.invalidate();
    await view.refreshOnce(); expect(complete).toBe(true); expect(encoded).toBe(1); expect(caches).toBe(1); expect(view.contentEl.dataset.verified).toBe('true');
    const request = pipeline.request;
    for (const interruption of ['replacement', 'close']) {
      view.closed = false; encoded = 0; caches = 0;
      let release!: (v: any) => void, started!: () => void;
      const waiting = new Promise<void>(resolve => { started = resolve; });
      pipeline.request = (revision: number, r: any) => r.kind === 'layout' ? new Promise(resolve => { release = resolve; started(); }) : request(revision, r);
      const pending = view.refreshOnce(); await waiting;
      if (interruption === 'close') await view.onClose();
      else { plugin.propertySource = { ...source }; plugin.propertyRevision++; view.invalidateSource(); }
      release({ positions: new Float32Array(2), milliseconds: 1, cached: false }); await pending;
      expect(caches).toBe(0); expect(encoded).toBe(0); expect(view.contentEl.dataset.verified).toBe('false');
    }

  } finally { adapter.index.dispose(); }
});

test('refresh invalidates an in-flight carrier index before a replacement graph arrives', async () => {
  const { GraphView } = await import('../src/main');
  const view: any = Object.create(GraphView.prototype);
  let finishRead!: (text: string) => void, refreshing: Promise<void> | undefined, paginated = 0;
  const read = new Promise<string>(resolve => { finishRead = resolve; });
  const status = { textContent: '', remove() {} };
  const graph = { groups: [], groupEdges: [] };
  const declaration = { groups: [], carrierResolvers: [{ kind: 'synthetic-id', key: 'id' }] };
  const settings = { declaration, projectionFile: 'aggregate.json', groupLevel: 0, listPageSize: 25, ingest: { chunkRows: 1, budgetMs: 8 }, maxProjectionBytes: 1024 };
  const row = { path: 'Old.md', properties: { get id() { refreshing = view.refreshOnce(); return 'old'; } } };
  Object.assign(view, {
    revision: 0, renderRevision: 0, closed: false, contributions: new Map(), members: new Map(), groupGraph: graph,
    contributionScope: JSON.stringify(['local', settings.projectionFile, settings.groupLevel, declaration.groups]),
    contributionPage: { clear() {}, suspend() {} }, status: new ControlElement(), statusSummary: new ControlElement(), contentEl: { dataset: {} },
    panel: { empty() {}, createEl() {}, createDiv() { return status; } },
    plugin: { settings, sourceIdentity: 'local', nextRevision: 0, adapter: { *values() { yield row; } }, pipeline: { async request() { return { groups: [], groupEdges: [] }; } } },
    app: { vault: { getAbstractFileByPath() { return new FixtureFile('aggregate.json'); }, read() { return read; } } },
    paginate() { paginated++; }, showGroups() {},
  });
  await view.edgeList({ a: 'a', b: 'b', total: 1, typeCounts: { related: 1 }, carriers: { kind: 'synthetic-id', ids: ['old'] } }, graph, 1);
  expect(refreshing).toBeDefined(); expect(view.carrierLookup).toBeUndefined(); expect(paginated).toBe(0);
  finishRead('{}'); await refreshing;
});

test('late upload-window resize is reconciled before first draw and restoration', async () => {
  const previous = (globalThis as any).window;
  (globalThis as any).window = { devicePixelRatio: 1 };
  try {
    const { DetailRenderer } = await import('../src/webgl-renderer');
    const r: any = Object.create(DetailRenderer.prototype), container = { clientWidth: 800, clientHeight: 600 };
    let resized = false;
    Object.assign(r, {
      container, canvas: { width: 0, height: 0, style: {} }, ready: false, lost: false, disposed: false,
      width: 0, height: 0, dpr: 1, timings: {}, grid: { width: 1, height: 1 }, cameraFrame: { minX: 0, minY: 0, width: 1, height: 1 }, refresh() {},
      settings: { workerTimeoutMs: 1000, shaderPollMs: 1 },
      positions: new Float32Array([0, 0]), visible: new Uint8Array([1]), colorIds: new Uint32Array([0]),
      carrierGeometry: { enabled: new Uint8Array(), ends: new Uint32Array(), nodes: new Uint32Array(1) }, projection: { source: new Uint32Array(), target: new Uint32Array() }, theme: { palette: new Uint8Array(1024) },
      programs: [], vaos: [], buffers: [], discBuffers: [], async program() { return {}; }, texture() {}, uploadPalette() {}, uploadLens() {}, buffer() {}, uploadView() {},
      integer() { if (!resized) { resized = true; container.clientWidth += 400; r.resize(); expect(r.canvas.width).not.toBe(container.clientWidth); } },
      gl: { SYNC_GPU_COMMANDS_COMPLETE: 1, ALREADY_SIGNALED: 2, CONDITION_SATISFIED: 3, WAIT_FAILED: 4,
        fenceSync() { return {}; }, flush() {}, clientWaitSync(_fence: unknown, _flags: number, timeout: number) { expect(timeout).toBe(0); return 2; }, deleteSync() {},
        getParameter() { return 2048; }, texImage2D() {}, createVertexArray() { return {}; }, bindVertexArray() {}, enable() {}, blendFunc() {},
        createBuffer() { return {}; }, bindBuffer() {}, bufferData() {}, enableVertexAttribArray() {}, vertexAttribPointer() {}, vertexAttribDivisor() {} },
    });
    // Both first initialization and context restoration run this same method.
    for (let pass = 0; pass < 2; pass++) {
      resized = false; r.ready = false; r.programs = []; r.vaos = []; r.buffers = [];
      await r.initialize();
      expect(r.ready).toBe(true); expect(r.canvas.width).toBe(container.clientWidth); expect(r.canvas.height).toBe(container.clientHeight);
    }
  } finally {
    if (previous === undefined) delete (globalThis as any).window;
    else (globalThis as any).window = previous;
  }
});

test('GPU resize fences poll without blocking, enforce deadline and always release', async () => {
  const { DetailRenderer } = await import('../src/webgl-renderer');
  for (const scenario of ['complete', 'failed', 'disposed', 'lost', 'timeout', 'no-fence']) {
    const r: any = Object.create(DetailRenderer.prototype); let polls = 0, deleted = 0, flushed = 0;
    Object.assign(r, { canvas: { width: 1, height: 1 }, width: 2, height: 2, dpr: 1,
      resize() {}, disposed: scenario === 'disposed', lost: scenario === 'lost', settings: { workerTimeoutMs: 1, shaderPollMs: 2 },
      gl: { SYNC_GPU_COMMANDS_COMPLETE: 1, ALREADY_SIGNALED: 2, CONDITION_SATISFIED: 3, WAIT_FAILED: 4,
        fenceSync() { return scenario === 'no-fence' ? null : {}; }, flush() { flushed++; },
        clientWaitSync(_fence: unknown, flags: number, timeout: number) {
          expect(flags).toBe(0); expect(timeout).toBe(0); polls++;
          if (scenario === 'failed') return 4;
          return scenario === 'complete' && polls > 1 ? 2 : 5;
        }, deleteSync() { deleted++; } },
    });
    if (scenario === 'complete') await r.waitForResize();
    else await expect(r.waitForResize()).rejects.toThrow(({ failed: 'GL_RESIZE_WAIT', disposed: 'Renderer superseded', lost: 'Renderer superseded', timeout: 'GL_RESIZE_TIMEOUT', 'no-fence': 'GL_RESIZE_FENCE' } as Record<string, string>)[scenario]);
    expect(deleted).toBe(scenario === 'no-fence' ? 0 : 1); expect(flushed).toBe(scenario === 'no-fence' ? 0 : 1);
  }
});

test('presentation state is per view, validates unknown values and restores only when detail is ready', async () => {
  const { GraphView } = await import('../src/main');
  const base = Object.getPrototypeOf(GraphView.prototype), old = base.setState;
  let inherited = 0; base.setState = async () => { inherited++; };
  const make = () => {
    const plugin: any = { settings: { explore: { view: emptyView() }, listPageSize: 100 } };
    const view: any = new GraphView(null as any, plugin), shown: string[] = [];
    view.app = { workspace: { requestSaveLayout() { shown.push('saved'); } } }; view.contentEl = { dataset: {} };
    view.showDetails = async () => { shown.push('nodes'); };
    view.toGroups = () => { shown.push('groups'); };
    return { view, shown };
  };
  try {
    const a = make(), b = make(); expect(a.view.getState()).toEqual({ presentation: 'groups' });
    await a.view.setState({ presentation: 'nodes' }, {}); expect(a.shown).toEqual([]);
    expect(a.view.getState()).toEqual({ presentation: 'nodes' }); expect(b.view.getState()).toEqual({ presentation: 'groups' });
    a.view.positions = new Float32Array(2); a.view.projection = {};
    await a.view.setState(a.view.getState(), {}); expect(a.shown).toEqual(['nodes']);
    await a.view.setState({ presentation: 'groups' }, {}); expect(a.shown).toEqual(['nodes', 'groups']);
    for (const state of [null, {}, { presentation: '<untrusted>' }, { presentation: true }]) {
      await a.view.setState(state, {}); expect(a.view.getState()).toEqual({ presentation: 'groups' });
    }
    expect(inherited).toBe(7);
    // Review 2026-11-16: an already-open leaf re-receiving its own state must not rebuild (camera, selection, drill-in survive).
    const c = make(); c.view.positions = new Float32Array(2); c.view.projection = {}; c.view.contentEl.dataset.mode = 'nodes';
    await c.view.setState({ presentation: 'nodes' }, {}); expect(c.shown).toEqual([]);
    c.view.contentEl.dataset.mode = 'groups'; await c.view.setState({ presentation: 'groups' }, {}); expect(c.shown).toEqual([]);
    c.view.contentEl.dataset.mode = 'nodes-building'; await c.view.setState({ presentation: 'groups' }, {}); expect(c.shown).toEqual([]);
    // A refused admission changes what is shown, never the user's requested presentation.
    const d = make(); d.view.positions = new Float32Array(2); d.view.projection = {}; d.view.visible = new Uint32Array(1);
    d.view.presentation = 'nodes'; d.view.gpu = { available: true, reason: '' }; d.view.admitDetail = () => false; d.view.showGroups = () => { d.view.contentEl.dataset.mode = 'groups'; }; delete d.view.showDetails;
    await d.view.showDetails(); expect(d.view.getState()).toEqual({ presentation: 'nodes' }); expect(d.view.contentEl.dataset.mode).toBe('groups');
  } finally { if (old) base.setState = old; else delete base.setState; }
});

test('live layout preview coalesces while opening, recycles superseded frames, and owns cleanup', async () => {
  const { LayoutPreview } = await import('../src/layout-preview');
  const frames = Array.from({ length: 4 }, (_, i) => new Float32Array([i, i]));
  const recycled: Float32Array[] = [], updates: Float32Array[] = []; let release!: () => void, disposed = 0, creates = 0;
  const preview = new LayoutPreview(async positions => {
    creates++; await new Promise<void>(resolve => { release = resolve; });
    const renderer = { positions, streamPositions(next: Float32Array) { const old = renderer.positions; renderer.positions = next; updates.push(next); return old; }, dispose() { disposed++; } }; return renderer;
  }, p => recycled.push(p), () => true, e => { throw e; });
  preview.push(frames[0]!); preview.push(frames[1]!); preview.push(frames[2]!);
  expect(creates).toBe(1); expect(recycled).toEqual([frames[1]!]);
  release(); await new Promise(resolve => setTimeout(resolve, 0));
  expect(updates).toEqual([frames[2]!]); expect(recycled).toEqual([frames[1]!, frames[0]!]);
  preview.push(frames[3]!); expect(updates).toEqual([frames[2]!, frames[3]!]);
  await preview.finish(); await preview.finish();
  expect(disposed).toBe(1); expect(new Set(recycled).size).toBe(4); expect(recycled.length).toBe(4);
});

test('returning to Notes replaces a preview disposed by Groups', async () => {
  const { LayoutPreview } = await import('../src/layout-preview');
  const recycled: Float32Array[] = []; let creates = 0;
  let renderer: any;
  const preview = new LayoutPreview(async positions => { creates++; renderer = { positions, usable: true, streamPositions() { throw Error('disposed renderer reused'); }, dispose() { this.usable = false; } }; return renderer; }, p => recycled.push(p), () => true, e => { throw e; });
  const first = new Float32Array(2), next = new Float32Array(2);
  preview.push(first); await new Promise(resolve => setTimeout(resolve, 0)); renderer.dispose();
  preview.push(next); await new Promise(resolve => setTimeout(resolve, 0));
  expect(creates).toBe(2); expect(recycled).toEqual([first]);
  await preview.finish(); expect(recycled).toEqual([first, next]);
});

test('completed partial projections do not keep layout busy waiting for host metadata', async () => {
  const { GraphView } = await import('../src/main'); const view: any = Object.create(GraphView.prototype);
  Object.assign(view, { contentEl: { dataset: { state: 'ready' } }, provisional: true, plugin: { settings: { projectionFile: '' } }, report: { linksPending: true, pendingProperties: 4 } });
  expect(view.loading()).toBeUndefined();
  view.layoutWorking = true; view.statusMessage = 'Laying out notes 64%'; expect(view.loading().stage).toBe('Laying out notes 64%'); view.layoutWorking = false;
  view.plugin.settings.projectionFile = 'synthetic-projection'; expect(view.loading()).toBeUndefined();
  view.plugin.settings.projectionFile = ''; view.contentEl.dataset.state = 'error'; expect(view.loading()).toBeUndefined();
});

test('obsolete or closed live layout cannot adopt an initializing renderer', async () => {
  const { LayoutPreview } = await import('../src/layout-preview');
  for (const stop of ['source', 'close']) {
    let active = true, release!: () => void, disposed = 0; const recycled: Float32Array[] = [], first = new Float32Array(2), next = new Float32Array(2);
    const preview = new LayoutPreview(async positions => { await new Promise<void>(r => { release = r; }); return { positions, streamPositions() { throw Error('obsolete'); }, dispose() { disposed++; } }; }, p => recycled.push(p), () => active, () => { throw Error('obsolete error surfaced'); });
    preview.push(first); preview.push(next);
    if (stop === 'source') active = false;
    const finish = stop === 'close' ? preview.finish() : undefined;
    release(); await finish; await preview.finish();
    expect(disposed).toBe(1); expect(recycled.length).toBe(2); expect(new Set(recycled).size).toBe(2);
  }
});

test('a failed preview stops new admissions without stopping the final layout', async () => {
  const { LayoutPreview } = await import('../src/layout-preview');
  let creates = 0, errors = 0; const recycled: Float32Array[] = [];
  const preview = new LayoutPreview(async () => { creates++; throw Error('synthetic unavailable'); }, p => recycled.push(p), () => true, () => { errors++; });
  preview.push(new Float32Array(2)); await new Promise(resolve => setTimeout(resolve, 0)); preview.push(new Float32Array(2)); await preview.finish();
  expect(creates).toBe(1); expect(errors).toBe(1); expect(recycled.length).toBe(2);
});

test('16k-note refresh preserves Notes intent, refuses software overflow visibly, and never opens seed coordinates', async () => {
  const { GraphView } = await import('../src/main'), { defaults } = await import('../src/settings');
  const settings = defaults('fixture'); settings.persistLayout = false; settings.canvasMaxDetailNodes = 2000;
  const count = 16001, visible = new Uint8Array(count).fill(1), projection = { nodeCount: count, source: new Uint32Array(), target: new Uint32Array(), quarantined: [] };
  const explored = { nodes: count, visible, matched: count, filters: [], filterHidden: [], queryHidden: 0, visibleEdges: 0, ruleVisible: [], edgeHidden: [], groupKeys: [], groupLabels: [], groupCodes: new Uint32Array(count), types: [] };
  let shown = 0, saves = 0, released!: (v: unknown) => void, started!: () => void;
  const waiting = new Promise<void>(r => { started = r; }), recycled: ArrayBuffer[] = [];
  const groups = { groups: [], groupEdges: [] };
  const pipeline: any = { recycle: (p: ArrayBuffer) => recycled.push(p), async request(revision: number, r: any) {
    switch (r.kind) {
      case 'configure': return { declarationHash: 'd', layoutHash: 'l', ingestHash: 'i' };
      case 'project': pipeline.onGroups({ revision, view: 1, projection: groups }); return { nodes: count, edges: 0, rows: count, unresolved: 0, quarantined: [], meta: { key: 'k' } };
      case 'detail': return { projection, visible, colors: new Uint32Array(count), explore: explored, view: 1 };
      case 'layout': started(); return new Promise(resolve => { released = resolve; });
    }
  } };
  const view: any = Object.create(GraphView.prototype), app = { vault: { getMarkdownFiles: () => [] }, workspace: { requestSaveLayout() { saves++; } } };
  Object.assign(view, { app, plugin: { settings, pipeline, nextRevision: 0, sourceIdentity: 'local', propertyRevision: 0, adapter: { async *columns() {}, coverage: () => ({ listed: count, indexed: count }), factsComplete: () => true, pendingProperties: () => 0, linksPending: () => false, invalidate() {} } },
    contentEl: { dataset: {} }, status: new ControlElement(), statusSummary: new ControlElement(), stage: new ControlElement(), view: emptyView(), presentation: 'nodes', revision: 0, renderRevision: 0,
    members: new Map(), contributions: new Map(), startupTrace: [], cacheTrace: [], contributionPage: { clear() {}, suspend() {}, update() {}, fail() {} }, gpu: { available: false, reason: 'Synthetic software renderer' },
    showGroups() { shown++; view.contentEl.dataset.mode = 'groups'; } });
  const work = view.refreshOnce(); await waiting;
  expect(shown).toBe(0); expect(view.positions).toBeUndefined();
  const revision = view.activeRevision, seed = new Float32Array(count * 2);
  pipeline.onPositions({ revision, positions: seed, iteration: 0, total: 100 });
  expect(recycled).toContain(seed.buffer); expect(view.positions).toBeUndefined();
  await view.showDetails(); expect(view.positions).toBeUndefined(); expect(view.getState()).toEqual({ presentation: 'nodes' });
  pipeline.onPositions({ revision, positions: new Float32Array(count * 2), iteration: settings.streamEveryIterations * 2, total: 100 });
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(view.statusSummary.textContent).toContain("16,001 notes exceed this renderer's 2,000-note limit");
  expect(view.statusSummary.textContent).toContain('Narrow filters to see notes'); expect(view.getState()).toEqual({ presentation: 'nodes' });
  released({ positions: new Float32Array(count * 2), milliseconds: 1, cached: false }); await work;
  expect(view.contentEl.dataset.state).toBe('ready'); expect(view.contentEl.dataset.mode).toBe('groups'); expect(view.getState()).toEqual({ presentation: 'nodes' });
  expect(saves).toBeGreaterThan(0); expect(shown).toBeGreaterThan(0);
});

test('failed or timed-out Notes refresh paints available groups without changing Notes intent', async () => {
  const { GraphView } = await import('../src/main'), { defaults } = await import('../src/settings');
  for (const failed of ['project', 'layout']) for (const message of ['synthetic failure', 'Worker request timed out']) {
    const settings = defaults('fixture'); settings.persistLayout = false;
    const groups = { groups: [], groupEdges: [] }, visible = new Uint8Array([1]); let shown = 0;
    const pipeline: any = { async request(revision: number, request: any) {
      if (request.kind === 'configure') return { declarationHash: 'd', layoutHash: 'l', ingestHash: 'i' };
      if (request.kind === 'project') pipeline.onGroups({ revision, view: 1, projection: groups });
      if (request.kind === failed) throw Error(message);
      if (request.kind === 'project') return { nodes: 1, edges: 0, rows: 1, unresolved: 0, quarantined: [], meta: { key: 'k' } };
      if (request.kind === 'detail') return { projection: {}, visible, colors: new Uint32Array(1), explore: { visible }, view: 1 };
    } };
    const view: any = Object.create(GraphView.prototype);
    Object.assign(view, { app: { vault: { getMarkdownFiles: () => [] } }, plugin: { settings, pipeline, nextRevision: 0, propertyRevision: 0,
      adapter: { async *columns() {}, coverage: () => ({ listed: 1, indexed: 1 }), factsComplete: () => true, pendingProperties: () => 0, linksPending: () => false, invalidate() {} } },
      contentEl: { dataset: {} }, status: new ControlElement(), statusSummary: new ControlElement(), stage: new ControlElement(), view: emptyView(), presentation: 'nodes', revision: 0, renderRevision: 0,
      members: new Map(), contributions: new Map(), startupTrace: [], cacheTrace: [], contributionPage: { clear() {}, suspend() {}, update() {}, fail() {} },
      showGroups() { expect(view.groupGraph).toBe(groups); shown++; view.stage.createEl('canvas'); view.contentEl.dataset.mode = 'groups'; } });
    await view.refreshOnce();
    expect(view.contentEl.dataset.state).toBe('error'); expect(view.status.textContent).toContain(message);
    expect(shown).toBe(1); expect(view.stage.querySelector('canvas')).toBeDefined();
    expect(view.contentEl.dataset.mode).toBe('groups'); expect(view.getState()).toEqual({ presentation: 'nodes' });
  }
});

test('choosing the displayed Groups replaces fallback Notes intent', async () => {
  const { GraphView } = await import('../src/main');
  const view: any = Object.create(GraphView.prototype), root = new ControlElement(), render = ExplorePanel.prototype.render; let saves = 0;
  Object.assign(view, { contentEl: root, view: emptyView(), closed: false, presentation: 'nodes', detailFallback: 'Narrow filters to see notes',
    plugin: { settings: { explore: { panelOpen: false, legendPageSize: 20 } }, subscribe: () => () => {}, saveSoon() {} },
    app: { workspace: { on() {}, requestSaveLayout() { saves++; } } }, registerEvent() {}, async refresh() {},
    showGroups() { view.contentEl.dataset.mode = 'groups'; } });
  ExplorePanel.prototype.render = function () {};
  try { await view.onOpen(); } finally { ExplorePanel.prototype.render = render; }
  view.contentEl.dataset.mode = 'groups'; control(root, 'Groups').click();
  expect(view.getState()).toEqual({ presentation: 'groups' }); expect(view.detailFallback).toBe(''); expect(saves).toBe(1);
  view.explorePanel.dispose();
});

test('final renderer replaces the retained preview only after create confirms its first paint', async () => {
  const { GraphView } = await import('../src/main'), { DetailRenderer } = await import('../src/webgl-renderer');
  const view: any = Object.create(GraphView.prototype), preview: any = Object.create(DetailRenderer.prototype);
  let painted = false, disposed = 0, emptied = 0, release!: () => void;
  Object.assign(preview, { canvas: { style: {} }, dispose() { expect(painted).toBe(true); disposed++; } });
  const final: any = { fitAll() {}, syncTools() {}, adoptCamera() { expect(painted).toBe(true); return false; } }, original = DetailRenderer.create;
  Object.assign(view, { contentEl: { dataset: { state: 'ready', mode: 'nodes-building' } }, renderer: preview, detailRenderer: undefined,
    projection: {}, positions: new Float32Array(2), visible: new Uint8Array([1]), colors: new Uint32Array(1), gpu: { available: true, reason: 'fixture' },
    renderRevision: 1, plugin: { settings: {}, pipeline: {} }, app: {}, stage: { empty() { emptied++; } }, panel: { empty() {} },
    contributionPage: { clear() {} }, rememberPresentation() {}, admitDetail: () => true, renderView: () => ({}), status: new ControlElement(), statusSummary: new ControlElement() });
  DetailRenderer.create = async () => { await new Promise<void>(resolve => { release = resolve; }); painted = true; return final; };
  try {
    const pending = view.showDetails(); expect(disposed).toBe(0); expect(emptied).toBe(0); expect(preview.canvas.style.position).toBe('absolute');
    release(); await pending; expect(disposed).toBe(1); expect(view.renderer).toBe(final); expect(view.contentEl.dataset.mode).toBe('nodes');
  } finally { DetailRenderer.create = original; }
});

test('fallback summary uses compact on-demand help outside the information button and panel footprint', async () => {
  const { GraphView } = await import('../src/main'), { readFileSync } = await import('node:fs');
  const view: any = Object.create(GraphView.prototype), summary = new ControlElement();
  const explanation = 'Narrow filters to see notes. Synthetic renderer limit exceeded.';
  Object.assign(view, { contentEl: { dataset: { state: 'ready' } }, status: new ControlElement(), statusSummary: summary, detailFallback: explanation, plugin: { settings: {} } });
  view.statusText = '';
  const tip = summary.querySelector('.graph-ng-help-popover')!, trigger = summary.querySelector('.graph-ng-help-trigger')!;
  expect(tip).toBeDefined(); expect(tip.hidden).toBe(true); expect(tip.textContent).toBe(explanation);
  expect(trigger.textContent.length).toBeLessThan(20); expect(trigger.getAttribute('title')).toBeNull();
  for (const button of summary.querySelectorAll('button')) expect(button.querySelector('button')).toBeUndefined();
  const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
  expect(css).toMatch(/\.graph-ng-body:has\(> \.graph-ng-explore:not\(\[hidden\]\)\) > \.graph-ng-summary[^}]+max-width:calc\(100% - 384px\)/);
  expect(css).toMatch(/@container \(max-width: 480px\)[^\n]+\.graph-ng-summary[^\n]+display:none/);
});

test('relationship display rebuild settles despite unchanged metadata bursts; real edits still queue once', async () => {
  const { default: GraphPlugin, GraphView } = await import('../src/main');
  const { LocalAdapter } = await import('../src/adapter/local');
  const { defaults } = await import('../src/settings');
  const { setRelationshipDisplay } = await import('../src/explore-panel');
  const { unpackRows } = await import('../src/core/columns');
  const files = ['a.md', 'b.md', 'relation.md'].map(p => new FixtureFile(p));
  const facts: Record<string, any> = { 'a.md': { id: 'a' }, 'b.md': { id: 'b' }, 'relation.md': { source: 'a', target: 'b' } };
  const events = new Map<string, Function>(), links: Record<string, Record<string, number>> = {};
  const app: any = { vault: { getMarkdownFiles: () => files, getAbstractFileByPath: (p: string) => files.find(f => f.path === p), on() {} }, metadataCache: { getFileCache: (f: FixtureFile) => ({ frontmatter: facts[f.path] }), resolvedLinks: links, on: (n: string, fn: Function) => events.set(n, fn) } };
  const plugin: any = new GraphPlugin(app, {} as any); plugin.settings = defaults('p@1');
  Object.assign(plugin.settings.declaration, { identity: [{ key: 'id' }], display: { reifiedAsNodes: true } });
  plugin.settings.declaration.edges.unshift({ name: 'relation', kind: 'reified', sourceProperty: 'source', targetProperty: 'target' });
  plugin.app = app; plugin.register = () => {}; plugin.registerEvent = () => {};
  let saves = 0, cacheAttempts = 0, projects = 0, layouts = 0, hold = false, release!: () => void;
  let begun!: () => void, running = Promise.resolve();
  plugin.saveData = async () => { saves++; }; plugin.resetStore = () => {};
  plugin.store = { async latest() {}, async write() { cacheAttempts++; throw Error('Buffer is not defined'); } };
  const source = { get: (path: string) => ({ source: 'derived', state: 'current', verified: true, frontmatter: facts[path] }) };
  plugin.propertySource = source;
  plugin.adapter = new LocalAdapter(app, plugin, 'p@1', 5000, () => plugin.notify(), true, plugin.settings.declaration, source);
  const rows = new Map<string, any>();
  plugin.pipeline = { recycle() {}, async request(revision: number, r: any) {
    switch (r.kind) {
      case 'configure': return { declarationHash: 'd', layoutHash: 'l', ingestHash: String(r.config.declaration.display.reifiedAsNodes) };
      case 'rows': if (r.reset) rows.clear(); for (const row of unpackRows(r.columns)) rows.set(row.path, row); for (const p of r.removed) rows.delete(p); return;
      case 'project': projects++; return { nodes: 2, edges: 1, rows: 3, ruleNotes: { relation: 1 }, unresolved: 0, quarantined: [], meta: { key: 'k' } };
      case 'detail': return { projection: {}, visible: new Uint8Array([1, 1]), colors: new Uint32Array(2), explore: { visible: new Uint8Array([1, 1]) }, view: 1 };
      case 'layout':
        layouts++; if (hold) { hold = false; begun(); await new Promise<void>(r => { release = r; }); }
        return { positions: new Float32Array(4), milliseconds: 1, cached: false };
      case 'encode': return {};
    }
  } };
  const view: any = new GraphView(null as any, plugin);
  Object.assign(view, { app, contentEl: { dataset: {} }, status: new ControlElement(), statusSummary: new ControlElement(), showGroups() {} });
  plugin.subscribe(() => running = view.refresh());
  // Flush represents the adapter's 5-second debounce, without wall-clock sleeps.
  let irrelevant = 0;
  const burst = () => { for (const f of files) { facts[f.path].unprojected = ++irrelevant; events.get('changed')!(f); events.get('resolve')!(f); } events.get('resolved')!(); plugin.adapter.index.flush(); };
  try {
    await view.refresh(); expect(layouts).toBe(1); expect(view.contentEl.dataset.verified).toBe('false');
    const started = new Promise<void>(r => { begun = r; }); hold = true;
    let switched = false; const switching = setRelationshipDisplay(plugin, false).then(() => { switched = true; });
    await started; expect(switched).toBe(false);
    burst(); burst(); burst(); // unchanged resolver batches during a layout longer than debounce
    release(); await switching; expect(switched).toBe(true);
    expect(projects).toBe(2); expect(layouts).toBe(2); expect(saves).toBe(1);
    for (let elapsed = 0; elapsed < 120000; elapsed += 5000) { burst(); await running; }
    expect(projects).toBe(2); expect(layouts).toBe(2); // two-minute simulated settle window
    expect(plugin.settings.declaration.display.reifiedAsNodes).toBe(false);
    // A declared edit is not swallowed; another edit during layout queues exactly one follow-up.
    const next = new Promise<void>(r => { begun = r; }); hold = true;
    facts['relation.md'].target = 'a'; events.get('changed')!(files[2]); plugin.adapter.index.flush(); await next;
    facts['relation.md'].target = 'b'; events.get('changed')!(files[2]); plugin.adapter.index.flush();
    release(); await running;
    expect(rows.get('relation.md').properties.target).toBe('b'); expect(projects).toBe(4);
    // Readiness is meaningful even with unchanged rows. Cache failure never schedules a retry.
    for (const f of files) links[f.path] = {};
    burst(); await running; expect(view.contentEl.dataset.verified).toBe('true'); expect(projects).toBe(5);
    expect(cacheAttempts).toBe(1); expect(view.contentEl.dataset.cacheError).toContain('Buffer is not defined');
    for (let i = 0; i < 24; i++) { burst(); await running; }
    expect(projects).toBe(5); expect(cacheAttempts).toBe(1);
  } finally { plugin.adapter.index.dispose(); await view.onClose(); }
});


test('review: save completes after its rebuild while later hydration rebuilds continue', async () => {
  const { default: GraphPlugin, GraphView } = await import('../src/main');
  const { defaults } = await import('../src/settings');
  const plugin: any = new GraphPlugin({} as any, {} as any);
  plugin.settings = defaults('p@1'); plugin.adapter = { configure() {} }; plugin.resetStore = () => {}; plugin.saveData = async () => {};
  const view: any = Object.create(GraphView.prototype);
  const started: (() => void)[] = [], releases: (() => void)[] = [];
  const begins = Array.from({ length: 3 }, () => new Promise<void>(r => started.push(r)));
  let passes = 0, saved = false;
  Object.assign(view, { plugin, closed: false, refreshing: false, async refreshOnce() {
    const pass = passes++; started[pass]!(); await new Promise<void>(r => { releases[pass] = r; });
  } });
  plugin.subscribe(() => view.refresh());
  const apply = plugin.apply(plugin.settings).then(() => { saved = true; });
  let later: Promise<unknown> | undefined, final: Promise<unknown> | undefined;
  try {
    await begins[0]; expect(saved).toBe(false);
    later = plugin.notify(); // arrives during the save's rebuild
    releases[0]!(); await begins[1];
    final = plugin.notify(); // another hydration pass remains outstanding
    // Flush only microtasks, never wait for the later rebuilds or a wall-clock timeout.
    for (let i = 0; i < 20; i++) await Promise.resolve();
    expect(saved).toBe(true); expect(passes).toBe(2);
  } finally {
    releases[0]?.(); releases[1]?.();
    if (final) { await begins[2]; releases[2]!(); }
    await Promise.all([apply, later, final]);
  }
});


test('layout status updates the same ring, stops shimmer and clears stopped feedback on refinement', async () => {
  const { GraphView } = await import('../src/main'); const { BuildProgress } = await import('../src/working');
  const view: any = Object.create(GraphView.prototype), root = new ControlElement();
  Object.assign(view, { contentEl: root, status: new ControlElement(), statusSummary: new ControlElement(), buildProgress: new BuildProgress(), plugin: { settings: {} }, layoutWorking: true });
  view.statusText = view.buildProgress.text(2, .2); view.layoutControl(true);
  const ring = view.layoutRing, button = control(view.statusSummary, 'Stop layout');
  expect(ring.getAttribute('stroke-dashoffset')).toBe('41');
  view.statusText = view.buildProgress.text(2, .4);
  expect(view.layoutRing).toBe(ring); expect(ring.getAttribute('stroke-dashoffset')).toBe('32');
  expect(view.statusSummary.querySelector('.graph-ng-working')).toBeDefined();
  let stops = 0; view.plugin.pipeline = { stopLayout() { stops++; } };
  button.click(); button.click(); expect(stops).toBe(1);
  expect(view.statusSummary.querySelector('.graph-ng-working')).toBeUndefined();
  view.layoutControl(false); view.layoutWorking = false; root.dataset.state = 'ready'; view.statusText = 'Layout not settled';
  expect(view.statusSummary.textContent).toContain('Layout stopped'); expect(view.statusSummary.querySelector('.graph-ng-working')).toBeUndefined();
  view.layoutControl(true); view.layoutWorking = true; view.statusText = view.buildProgress.text(2, .5);
  expect(view.statusSummary.textContent).not.toContain('Layout stopped'); expect(view.statusSummary.querySelector('.graph-ng-working')).toBeDefined();
});
