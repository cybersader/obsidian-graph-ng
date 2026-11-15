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
  control(f.root, 'Close').click(); expect(f.panel.root.hidden).toBe(true); expect(ControlElement.active).toBe(control(f.root, 'Layout'));
  expect(f.settings.explore.panelOpen).toBe(false); expect(f.persisted()).toBe(3); f.panel.dispose();
});

test('filter text is non-destructive, removal is distinct and focused, expression editing is retained', () => {
  const f = controlsFixture(), filters: any[] = [{ kind: 'eq', key: 'category', value: '<synthetic>' }, { kind: 'exists', key: 'rank' }];
  let expression = '';
  f.panel.view = { ...emptyView(), filters }; f.panel.predicateForm = () => {};
  f.panel.expressionField = (_host: any, _result: any, _label: any, _context: any, submit: any) => { expression = f.panel.drafts.get('Edit filter 1'); submit('note.category == "changed"'); };
  f.panel.render = () => { f.panel.body.empty(); f.panel.filters(f.panel.body, {}); };
  f.panel.render();
  const label = f.panel.body.querySelector('span');
  expect(label.textContent).toContain('<synthetic>'); expect(label.onclick).toBeUndefined();
  expect(f.panel.view.filters).toEqual(filters);
  // Pill actions are labelled icon buttons; find them by accessible name.
  const labelled = (prefix: string) => { const found = f.panel.body.querySelectorAll('button').find((b: ControlElement) => b.getAttribute('aria-label')?.startsWith(prefix)); expect(found).toBeDefined(); return found!; };
  const remove = labelled('Remove filter 1:'); expect(remove.getAttribute('aria-label')).toBe('Remove filter 1: category is “<synthetic>”'); expect(remove.textContent).toBe('');
  remove.focus(); remove.click(); expect(f.view().filters).toEqual([filters[1]]);
  expect(ControlElement.active).toBe(labelled('Remove filter 1:'));
  labelled('Remove filter 1:').click(); expect(f.view().filters).toEqual([]); expect(ControlElement.active).toBe(f.panel.search);
  f.panel.view = { ...emptyView(), filters: [filters[0]] }; f.panel.render();
  // Stop the synthetic editor after applying once, as a real submit closes its draft.
  const expressionField = f.panel.expressionField;
  f.panel.expressionField = (...args: any[]) => { f.panel.expressionField = () => {}; expressionField(...args); };
  labelled('Edit filter 1 as expression').click();
  expect(expression).toContain('note.category'); expect(f.view().filters[0]).toEqual({ kind: 'expr', expr: 'note.category == "changed"' });
  f.panel.dispose();
});

test('filters inspector renders scope tiles, readable pills with labelled icon actions and an aligned add row', () => {
  const f = controlsFixture(), result: any = { visible: [3, 4], nodes: 10, visibleEdges: 5, edges: 20, facets: [] };
  f.panel.host.scope = () => 'Workspace';
  f.panel.summary(false, result);
  const counts = f.panel.counts;
  expect(counts.querySelector('.graph-ng-scope-name').textContent).toBe('Workspace'); expect(counts.querySelector('.graph-ng-scope-detail').textContent).toBe('No filters');
  expect(counts.textContent).not.toContain(' · ');
  expect(counts.querySelectorAll('.graph-ng-stat').map((t: ControlElement) => t.textContent)).toEqual(['7 of 10 nodes', '5 of 20 edges']);
  expect(counts.querySelectorAll('.graph-ng-stat-bar').map((b: ControlElement) => [b.getAttribute('aria-hidden'), b.children[0]!.style.width])).toEqual([['true', '70%'], ['true', '25%']]);
  f.panel.summary(true, undefined); expect(counts.textContent).toContain('External aggregate'); expect(counts.querySelector('.graph-ng-stat')).toBeUndefined();
  f.panel.view = { ...emptyView(), filters: [] }; f.panel.body.empty(); f.panel.filters(f.panel.body, result);
  expect(f.panel.body.textContent).toContain('No filters. Every note is shown.');
  const add = f.panel.body.querySelector('.graph-ng-builder');
  expect(add.getAttribute('role')).toBe('group'); expect(add.getAttribute('aria-label')).toBe('Add filter');
  expect(control(add, 'Add filter').classes.has('mod-cta')).toBe(false);
  f.panel.view = { ...emptyView(), filters: [{ kind: 'expr', expr: '!file.hasProperty("kind")' }, { kind: 'expr', expr: 'note.rank > 2 || note.rank < 0' }, { kind: 'exists', key: 'rank' }] };
  f.panel.body.empty(); f.panel.filters(f.panel.body, result);
  expect(f.panel.body.textContent).toContain('match all 3 filters');
  const list = f.panel.body.querySelector('.graph-ng-chips'); expect(list.getAttribute('role')).toBe('list'); expect(list.getAttribute('aria-label')).toBe('Active filters');
  const chips = f.panel.body.querySelectorAll('.graph-ng-chip'); expect(chips.map((c: ControlElement) => c.getAttribute('role'))).toEqual(['listitem', 'listitem', 'listitem']);
  const text = chips.map((c: ControlElement) => c.querySelector('.graph-ng-chip-text'));
  expect(text.map((t: ControlElement) => t.textContent)).toEqual(['kind is missing', 'note.rank > 2 || note.rank < 0', 'rank exists']);
  expect(text.map((t: ControlElement) => t.classes.has('graph-ng-chip-code'))).toEqual([false, true, false]);
  expect(text[0]!.getAttribute('title')).toBe('!file.hasProperty("kind")');
  const actions = chips.map((c: ControlElement) => c.querySelectorAll('button').map(b => [b.getAttribute('aria-label'), b.textContent, b.querySelector('svg')?.getAttribute('data-icon')]));
  expect(actions[0]).toEqual([['Edit filter 1 as expression', '', 'pencil'], ['Remove filter 1: kind is missing', '', 'x']]);
  // Builder filters keep the JSON editor as a compact labelled disclosure inside the pill.
  const json = chips[2]!.querySelector('details'); expect(json.querySelector('summary').getAttribute('aria-label')).toBe('Edit builder filter 3 as JSON');
  expect(actions[2]!.map((a: any) => a[0])).toEqual(['Edit filter 3 as expression', null, 'Remove filter 3: rank exists']);
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
  view.explorePanel.render = () => {};
  const text = 'Reading properties: 4 of 10 notes. Filters and member lists are provisional.';
  view.statusText = text; expect(view.status.textContent).toBe(text); expect(view.statusSummary.hidden).toBe(false);
  expect(view.statusSummary.title).toBe(text); expect(view.status.parent).toBe(view.explorePanel.root);
  expect(persistedPanelStates).toEqual([]);
  view.statusSummary.click(); expect(view.status.hidden).toBe(false); const status = view.status;
  expect(persistedPanelStates).toEqual([true]);
  view.explorePanel.close(); expect(persistedPanelStates).toEqual([true, false]);
  expect(ControlElement.active).toBe(view.statusSummary);
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
    expect(view.contentEl.dataset.verified).toBe('false'); expect(view.status.textContent).toContain('Links pending'); expect(view.status.textContent).toContain('Partial graph'); expect(view.statusSummary.textContent).toContain('Partial graph, still loading');
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
      projection: { source: new Uint32Array(), target: new Uint32Array() }, theme: { palette: new Uint8Array(1024) },
      programs: [], vaos: [], discBuffers: [], async program() { return {}; }, texture() {}, uploadPalette() {}, buffer() {}, uploadView() {},
      integer() { if (!resized) { resized = true; container.clientWidth += 400; r.resize(); expect(r.canvas.width).not.toBe(container.clientWidth); } },
      gl: { SYNC_GPU_COMMANDS_COMPLETE: 1, ALREADY_SIGNALED: 2, CONDITION_SATISFIED: 3, WAIT_FAILED: 4,
        fenceSync() { return {}; }, flush() {}, clientWaitSync(_fence: unknown, _flags: number, timeout: number) { expect(timeout).toBe(0); return 2; }, deleteSync() {},
        getParameter() { return 2048; }, texImage2D() {}, createVertexArray() { return {}; }, bindVertexArray() {}, enable() {}, blendFunc() {},
        createBuffer() { return {}; }, bindBuffer() {}, enableVertexAttribArray() {}, vertexAttribPointer() {}, vertexAttribDivisor() {} },
    });
    // Both first initialization and context restoration run this same method.
    for (let pass = 0; pass < 2; pass++) {
      resized = false; r.ready = false; r.programs = []; r.vaos = [];
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
