import { test, expect } from 'bun:test';
import { FixtureFile } from './support/obsidian-fixture';
import { ControlElement } from './support/controls-dom';
import { MemoryAdapter } from './support/memory-adapter';
import { WorkerPipeline, type Transport } from '../src/pipeline';
import { BinaryLayoutStore } from '../src/core/binary-layout';
import { defaultDeclaration } from '../src/core/declaration';
import { defaults } from '../src/settings';
import { renderPath } from '../src/render-projection';
import { layoutText } from '../src/graph-information';

/** The real view refresh, layout worker and binary store over a disk that survives a simulated
 * Obsidian reload. Only Obsidian itself (vault, metadata cache) and the renderer are fixtures. */
const N = 48, name = (i: number) => `${i % 2 ? 'A' : 'B'}/n${i}.md`;
const graph = () => { const links: Record<string, Record<string, number>> = {}; for (let i = 0; i < N; i++) links[name(i)] = { [name((i + 1) % N)]: 1, [name((i * 7 + 3) % N)]: 1 }; return links; };
const declaration = defaultDeclaration('p@1');
function settings(change: (s: any) => void = () => {}) {
  const s: any = { ...defaults('p@1'), declaration: structuredClone(declaration), persistLayout: true, streamEveryIterations: 1 };
  s.layout = { ...s.layout, iterations: 60, relaxIterations: 12, convergenceThreshold: 1e20, convergenceIterations: 12 }; change(s); return s;
}
async function boot(disk: MemoryAdapter, resolved: Record<string, Record<string, number>>, initial = settings(), quickClock = false) {
  const { default: GraphPlugin } = await import('../src/main');
  const { LocalAdapter } = await import('../src/adapter/local');
  const files = Array.from({ length: N }, (_, i) => new FixtureFile(name(i)));
  const app: any = { workspace: { requestSaveLayout() {} }, vault: { getMarkdownFiles: () => files, getAbstractFileByPath: (p: string) => files.find(f => f.path === p), on() {}, read() { throw Error('no bodies'); } },
    metadataCache: { getFileCache: () => ({ frontmatter: {} }), resolvedLinks: resolved, on() {} } };
  const worker = new Worker(new URL(quickClock ? './support/quick-clock-worker.ts' : '../src/layout-worker.ts', import.meta.url).href), transport = worker as unknown as Transport;
  const views = new Set<{activeRevision: number; presentation: string}>(), send = transport.postMessage.bind(transport);
  const wantsNotes = (rev: number) => [...views].some(v => v.activeRevision === rev && v.presentation === 'nodes');
  let solve: {id: number; revision: number; requested: boolean} | undefined;
  // Observe dispatched demand. A picture can cross a withdrawal, but never the reply that ends its RPC.
  transport.postMessage = (m: any, transfers) => {
    if (m.kind === 'layout' || m.kind === 'recompute') solve = {id: m.id, revision: m.revision, requested: !!m.preview?.wanted && wantsNotes(m.revision)};
    if (m.kind === 'preview-wanted' && m.wanted && solve && m.id === solve.id && wantsNotes(solve.revision)) solve.requested = true;
    send(m, transfers);
  };
  worker.addEventListener('message', ({data}) => { if (solve && data.id === solve.id && !data.kind) solve = undefined; });
  const pipeline = new WorkerPipeline(transport, () => 20000);
  let boundaries = 0, inner: any, viewPositions: any;
  Object.defineProperty(pipeline, 'onPositions', { get: () => (event: { revision: number; positions: Float32Array }) => {
    if (!solve?.requested || solve.revision !== event.revision) throw Error('Unexpected Groups preview');
    if ((pipeline as any).forwardPositions) return viewPositions?.(event);
    pipeline.recycle(event.positions.buffer as ArrayBuffer); return false;
  }, set: fn => { viewPositions = fn; } });
  Object.defineProperty(pipeline, 'onProgress', { get: () => (step: number, total: number) => { boundaries++; inner?.(step, total); }, set: fn => { inner = fn; } });
  const plugin: any = Object.create(GraphPlugin.prototype);
  Object.assign(plugin, { settings: initial, propertyRevision: 0, nextRevision: 0, linkProducer: 'p@1', pipeline, generations: Object.create(null), writes: Promise.resolve(), work: Promise.resolve(),
    ingestedHash: '', viewIdentity: 'local', store: new BinaryLayoutStore(disk, { ...initial.cache, directory: 'plugin/cache/local', cachedDeclarations: initial.cachedDeclarations }) });
  plugin.adapter = new LocalAdapter(app, { register() {}, registerEvent() {} } as any, 'p@1', 1, () => {}, true, initial.declaration);
  const { GraphView } = await import('../src/main');
  /** One view open (or one refresh after a change): returns what the user would see. */
  function makeView() {
    const view: any = Object.create(GraphView.prototype); boundaries = 0; disk.reads = []; disk.writes = 0;
    Object.assign(view, { plugin, app, presentation: 'groups', revision: 0, renderRevision: 0, closed: false, members: new Map(), contributions: new Map(), startupTrace: [], cacheTrace: [],
      contributionPage: { clear() {}, suspend() {}, update() {} }, contentEl: { dataset: {} }, status: new ControlElement(), statusSummary: new ControlElement(),
      gpu: { available: false, reason: 'Not probed' }, showGroups() {} });
    views.add(view); return view;
  }
  async function open() {
    const view = makeView(); await view.refreshOnce();
    // These cache cases explicitly exercise note coordinates even on a miss.
    await view.ensureNotesLayout();
    expect(view.contentEl.dataset.state).toBe('ready');
    const layout = view.report.layout;
    return { layout, text: layoutText(layout), boundaries, positions: view.positions as Float32Array, verified: view.contentEl.dataset.verified === 'true', cacheError: view.contentEl.dataset.cacheError, trace: view.cacheTrace.at(-1), binReads: disk.reads.filter(p => p.endsWith('.bin')).length };
  }
  /** Settings adoption as GraphPlugin.apply does it, minus the data.json save. */
  const apply = (next: any) => { plugin.settings = next; plugin.adapter.configure(next.declaration); };
  return { makeView, open, apply, plugin, dispose: () => { plugin.adapter.index.dispose(); pipeline.dispose(); } };
}
const manifests = (disk: MemoryAdapter) => [...disk.files.keys()].filter(p => p.endsWith('/manifest.json'));

test('cold Groups answers members and search before any layout; two Notes clicks start one solve', async () => {
  const disk = new MemoryAdapter(), app = await boot(disk, graph()), view = app.makeView();
  const rpc = app.plugin.pipeline, request = rpc.request.bind(rpc), calls: string[] = [];
  rpc.request = (rev: number, r: any) => { calls.push(r.kind); return request(rev, r); };
  try {
    await view.refresh(); expect(view.contentEl.dataset.state).toBe('ready'); expect(view.positions).toBeUndefined();
    const rev = view.activeRevision, group = view.groupGraph.groups.find((g: any) => g.label === 'A');
    const members: Uint32Array = await rpc.request(rev, { kind: 'members', group: group.id, view: view.viewGeneration });
    expect(Array.from(members, i => renderPath(view.projection, i)).sort()).toEqual(Array.from({ length: N / 2 }, (_, i) => name(2 * i + 1)).sort());
    const hits = await rpc.request(rev, { kind: 'search', query: 'n37', visible: view.visible.slice() });
    expect(renderPath(view.projection, hits[0])).toBe(name(37)); expect(calls).not.toContain('layout'); expect(manifests(disk)).toHaveLength(0);
    const first = view.showDetails(); expect(view.statusText).toBe('Arranging notes'); await view.showDetails();
    // Leave the actual worker running; only stub the renderer for the final adoption.
    view.showDetails = () => {}; await first;
    expect(calls.filter(k => k === 'layout')).toHaveLength(1); expect(view.positions).toHaveLength(N * 2); expect(view.report.layout.cached).toBe(false);
    const again = app.makeView(); await again.refresh(); expect(again.getState().presentation).toBe('groups');
    expect(again.deferredLayout).toBeUndefined(); expect(again.report.layout.cached).toBe(true); expect(again.positions).toEqual(view.positions);
  } finally { app.dispose(); }
});

test('Notes selected during ingestion waits for current detail then starts one layout', async () => {
  const app = await boot(new MemoryAdapter(), graph()), view = app.makeView(), rpc = app.plugin.pipeline;
  const request = rpc.request.bind(rpc), calls: string[] = [];
  let entered!: () => void, resume!: () => void;
  const reading = new Promise<void>(r => { entered = r; }), hold = new Promise<void>(r => { resume = r; });
  rpc.request = async (rev: number, r: any) => { calls.push(r.kind); if (r.kind === 'rows') { entered(); await hold; } return request(rev, r); };
  try {
    const open = view.refresh(); await reading; await view.showDetails(); expect(view.statusText).toBe('Reading notes'); expect(calls).not.toContain('layout');
    view.showDetails = () => {}; resume(); await open;
    expect(calls.filter(k => k === 'layout')).toHaveLength(1); expect(calls.indexOf('layout')).toBeGreaterThan(calls.indexOf('detail')); expect(view.positions).toHaveLength(N * 2);
  } finally { resume(); app.dispose(); }
});

test('replacing a source before deferred dispatch never starts or persists the old layout', async () => {
  const disk = new MemoryAdapter(), app = await boot(disk, graph()), view = app.makeView(), rpc = app.plugin.pipeline;
  const request = rpc.request.bind(rpc), layouts: number[] = [];
  rpc.request = (rev: number, r: any) => { if (r.kind === 'layout') layouts.push(rev); return request(rev, r); };
  try {
    await view.refresh(); const retired = view.activeRevision;
    const pending = view.showDetails(); app.plugin.propertyRevision++; view.invalidateSource(); await pending;
    expect(view.positions).toBeUndefined(); expect(layouts).toEqual([]); expect(manifests(disk)).toHaveLength(0);
    view.showDetails = () => {}; await view.refresh(); expect(layouts).toEqual([view.activeRevision]); expect(view.activeRevision).toBeGreaterThan(retired);
    expect(view.positions).toHaveLength(N * 2);
  } finally { app.dispose(); }
});

/** Keep the worker, save queue and view transitions real; record what reaches the canvas. */
async function transitions(quickClock = false) {
  const disk = new MemoryAdapter(), app = await boot(disk, graph(), settings(s => { s.quickStart = quickClock; }), quickClock), v = app.makeView(), rpc = app.plugin.pipeline;
  const calls: {rev: number; r: any}[] = [], request = rpc.request.bind(rpc), open = v.showDetails.bind(v);
  rpc.request = (rev: number, r: any, dispatched?: () => void) => { calls.push({rev, r}); return request(rev, r, dispatched); };
  Object.assign(v, { panel: new ControlElement(), stage: new ControlElement(),
    showGroups() { v.panel.empty(); v.renderer?.dispose(); v.renderer = { groups: true, dispose() {} }; v.renderRevision++; v.contentEl.dataset.mode = 'groups'; },
    showDetails() { if (!v.positions) return open(); v.rememberPresentation('nodes'); v.detailRenderer = v.renderer = { positions: v.positions, dispose() {} }; v.contentEl.dataset.mode = 'nodes'; },
  });
  app.plugin.saveData = async () => {};
  return { ...app, v, disk, calls, solves: () => calls.filter(({r}) => ['layout','recompute'].includes(r.kind)) };
}
function latch() { let release!: () => void; const wait = new Promise<void>(r => { release = r; }); return { wait, release }; }

test('cold Apply and immediate Notes commit the displayed coordinates with the full budget', async () => {
  const f = await transitions(true), {v} = f;
  try {
    await v.refresh(); const applying = v.applyLayout({iterations: 40}), opening = v.showDetails();
    await Promise.all([applying, opening]); await f.plugin.work;
    expect(v.contentEl.dataset.mode).toBe('nodes'); expect(v.detailRenderer.positions).toBe(v.positions);
    expect(f.solves()).toHaveLength(1); expect(f.solves()[0]!.r.quickStart).toBe(false); expect(v.layoutSettled).toBe(true);
  } finally { f.dispose(); }
});

test('cold Apply saves without solving and Stop ends the requested pass', async () => {
  const f = await transitions(), {v} = f;
  try {
    await v.refresh(); await v.applyLayout({iterations: 40, layoutEngine: 'graphics'});
    expect(f.plugin.settings.layout.iterations).toBe(40); expect(f.plugin.settings.layoutEngine).toBe('graphics');
    expect(f.solves()).toHaveLength(0); expect(manifests(f.disk)).toHaveLength(0);
    // Stop the claimed RPC at dispatch rather than racing a tiny solve's first progress event.
    const rpc = f.plugin.pipeline, request = rpc.request.bind(rpc);
    rpc.request = (rev: number, r: any) => { const work = request(rev,r); if (r.kind === 'layout') v.layoutStop.click(); return work; };
    await v.showDetails(); const config = f.calls.filter(({r}) => r.kind === 'configure').at(-1)!.r.config;
    expect(config.layout.iterations).toBe(40); expect(config.layoutEngine).toBe('graphics');
    expect(f.solves().map(({r}) => r.kind)).toEqual(['layout']); expect(v.layoutSettled).toBe(false); expect(manifests(f.disk)).toHaveLength(0);
  } finally { f.dispose(); }
});

test('cold Notes reacquires worker ownership with the saved physics', async () => {
  const f = await transitions(), {v} = f;
  try {
    await v.refresh(); const old = v.activeRevision; await f.makeView().refresh();
    await v.applyLayout({iterations: 40}); await v.showDetails();
    expect(v.activeRevision).toBeGreaterThan(old); expect(f.solves().map(({rev}) => rev)).toEqual([v.activeRevision]);
    expect(v.detailRenderer.positions).toBe(v.positions); expect(f.plugin.settings.layout.iterations).toBe(40);
  } finally { f.dispose(); }
});

for (const preview of [false,true]) test(`Groups restore paints immediately with preview ${preview}`, async () => {
  const f = await transitions(), {v} = f, base = Object.getPrototypeOf(Object.getPrototypeOf(v)), old = base.setState;
  const { DetailRenderer } = await import('../src/webgl-renderer'), create = DetailRenderer.create;
  const reached = latch(), resume = latch(), rpc = f.plugin.pipeline, request = rpc.request.bind(rpc);
  base.setState = async () => {}; v.gpu = {available:true,reason:'fixture'}; v.renderView = () => ({});
  DetailRenderer.create = async (_stage, _projection, positions) => ({ positions, onLayoutPaint(fn: () => void) { fn(); }, streamPositions(next: Float32Array) { const old = this.positions; this.positions = next; return old; }, dispose() {} } as any);
  rpc.request = async (rev: number, r: any) => {
    const running = request(rev,r); if (r.kind !== 'layout') return running;
    if (preview) { rpc.forwardPositions = true; rpc.onPositions({revision:rev,iteration:2,total:40,positions:new Float32Array(N*2)}); await Promise.resolve(); }
    reached.release(); await resume.wait; return running;
  };
  try {
    await v.refresh(); const solving = v.showDetails(); await reached.wait;
    const hadPreview = !v.renderer.groups;
    await v.setState({presentation:'groups'},{}); const immediate = v.renderer, mode = v.contentEl.dataset.mode; resume.release(); await solving;
    expect(hadPreview).toBe(preview); expect(mode).toBe('groups'); expect(immediate.groups).toBe(true); expect(v.contentEl.dataset.mode).toBe('groups'); expect(v.renderer).toBe(immediate);
  } finally { resume.release(); DetailRenderer.create = create; if (old) base.setState = old; else delete base.setState; f.dispose(); }
});

for (const cached of [false,true]) test(`group drill lists then opens scoped Notes with cache ${cached}`, async () => {
  const f = await transitions(), {v} = f;
  try {
    if (cached) await f.open(); await v.refresh(); const group = v.groupGraph.groups.find((g:any) => g.label === 'A');
    await v.drill(group.id); expect(v.panel.querySelectorAll('.graph-ng-member')).toHaveLength(N/2);
    expect(v.contentEl.dataset.mode).toBe('groups');
    const button = v.panel.querySelectorAll('button').find((b:any) => b.textContent === 'Open this group in Notes'); expect(button).toBeDefined();
    await button.onclick(); expect(v.contentEl.dataset.mode).toBe('nodes');
    expect(Array.from(v.detailVisible(), (bit,i) => bit ? renderPath(v.projection,i) : '').filter(Boolean).sort()).toEqual(Array.from({length:N/2},(_,i) => name(2*i+1)).sort());
  } finally { f.dispose(); }
});

const panelButton = (v: any, text: string) => v.panel.querySelectorAll('button').find((b: ControlElement) => b.textContent === text);

test('member Back withdraws Notes demand before the first layout frame', async () => {
  const f = await transitions(), {v} = f, rpc = f.plugin.pipeline, request = rpc.request.bind(rpc), dispatched = latch();
  rpc.request = (rev: number, r: any) => { const running = request(rev, r); if (r.kind === 'layout') dispatched.release(); return running; };
  try {
    await v.refresh(); await v.drill(v.groupGraph.groups[0].id);
    const opening = panelButton(v, 'Open this group in Notes').onclick(); await dispatched.wait;
    panelButton(v, 'Back to groups').onclick();
    const immediate = [v.contentEl.dataset.mode, v.getState().presentation, f.solves()[0]!.r.preview.wanted];
    await opening;
    expect(immediate).toEqual(['groups', 'groups', false]); expect(v.contentEl.dataset.mode).toBe('groups');
  } finally { f.dispose(); }
});

test('scoped member rows retire when refresh replaces the dictionary', async () => {
  const f = await transitions(), {v} = f, { DetailRenderer } = await import('../src/webgl-renderer'), create = DetailRenderer.create;
  delete v.showDetails; v.gpu = {available: true, reason: 'fixture'}; v.renderView = () => ({});
  DetailRenderer.create = async () => ({ dispose() {}, adoptCamera() { return false; }, fitAll() {}, beginLayout() {}, timings: {} } as any);
  const actions = () => v.panel.querySelectorAll('.graph-ng-member').map((b: ControlElement) => b.getAttribute('aria-label'));
  try {
    await v.refresh(); await v.drill(v.groupGraph.groups.find((g:any) => g.label === 'A').id);
    await panelButton(v, 'Open this group in Notes').onclick(); expect(v.contentEl.dataset.mode).toBe('nodes');
    const path = name(1); expect(actions()).toContain(`Open ${path}`);
    const files = v.app.vault.getMarkdownFiles(); files.splice(files.findIndex((file: FixtureFile) => file.path === path), 1);
    delete v.app.metadataCache.resolvedLinks[path]; f.plugin.adapter.invalidate(); await v.refresh();
    expect(v.contentEl.dataset.mode).toBe('nodes'); expect(v.detailVisible().filter(Boolean)).toHaveLength(N/2 - 1);
    expect(actions()).not.toContain(`Open ${path}`);
  } finally { DetailRenderer.create = create; f.dispose(); }
});

for (const back of [false, true]) test(`detail failure settles only the waiting member selection (Back: ${back})`, async () => {
  const f = await transitions(), {v} = f, rpc = f.plugin.pipeline, request = rpc.request.bind(rpc), reached = latch(), resume = latch();
  rpc.request = async (rev: number, r: any) => { if (r.kind === 'detail') { reached.release(); await resume.wait; throw Error('fixture detail unavailable'); } return request(rev, r); };
  v.contributionPage.fail = () => {};
  try {
    const work = v.refresh(); await reached.wait; await v.drill(v.groupGraph.groups[0].id);
    expect(v.panel.textContent).toContain('Loading members');
    if (back) { panelButton(v, 'Back to groups').onclick(); v.panel.createDiv({text: 'New selection'}); }
    resume.release(); await work; expect(v.membersReady).toBeUndefined(); expect(v.contentEl.dataset.state).toBe('error');
    if (back) expect(v.panel.textContent).toBe('New selection');
    else { expect(v.panel.textContent).toContain('Could not load members'); expect(v.panel.textContent).not.toContain('Loading members'); expect(panelButton(v, 'Back to groups')).toBeDefined(); }
  } finally { resume.release(); f.dispose(); }
});

test('preview demand belongs to one Notes solve, not cold Apply or the next view', async () => {
  const f = await transitions(), {v} = f, rpc = f.plugin.pipeline, request = rpc.request.bind(rpc), dispatched = latch();
  rpc.request = (rev: number, r: any) => { const work = request(rev, r); if (r.kind === 'layout') dispatched.release(); return work; };
  const frame = (revision: number) => rpc.onPositions({revision, iteration: 2, total: 40, positions: new Float32Array(N*2)});
  try {
    await v.refresh(); expect(f.solves()).toHaveLength(0);
    await v.applyLayout({iterations: 40}); expect(f.solves()).toHaveLength(0);
    expect(() => frame(v.activeRevision)).toThrow('Unexpected Groups preview');
    const opening = v.showDetails(); await dispatched.wait; v.toGroups();
    expect(() => frame(v.activeRevision + 1)).toThrow('Unexpected Groups preview');
    expect(frame(v.activeRevision)).toBe(false); await opening;
    expect(() => frame(v.activeRevision)).toThrow('Unexpected Groups preview');
    const quiet = rpc.request(v.activeRevision, {kind: 'layout', preview: {from: 1, wanted: false}});
    expect(() => frame(v.activeRevision)).toThrow('Unexpected Groups preview'); await quiet;
    const next = f.makeView(); await next.refresh(); expect(() => frame(next.activeRevision)).toThrow('Unexpected Groups preview');
  } finally { f.dispose(); }
});

test('promoted cold projection persists its first verified Notes solve', async () => {
  const f = await transitions(), {v} = f, real = f.plugin.adapter.factsComplete.bind(f.plugin.adapter); let promoted = false;
  f.plugin.adapter.factsComplete = () => promoted && real();
  try {
    await v.refresh(); expect(v.provisional).toBe(true); promoted = true; v.promoteProperties(); await v.showDetails();
    expect(v.layoutSettled).toBe(true); expect(manifests(f.disk)).toHaveLength(1);
  } finally { f.dispose(); }
});

test('saved facts warning survives Notes progress and settlement', async () => {
  const f = await transitions(), {v} = f; f.plugin.adapter.saveFacts = async () => { f.plugin.adapter.factError = 'fixture'; };
  try {
    await v.refresh(); expect(v.status.textContent).toContain('Saved facts unavailable');
    const solve = v.showDetails(), during = v.status.textContent; await solve;
    expect(during).toContain('Arranging notes'); expect(during).toContain('Saved facts unavailable'); expect(v.status.textContent).toContain('Saved facts unavailable');
  } finally { f.dispose(); }
});

test('early group click keeps Back and fulfills when detail arrives', async () => {
  const f = await transitions(), {v} = f, rpc = f.plugin.pipeline, request = rpc.request.bind(rpc), reached = latch(), resume = latch();
  rpc.request = async (rev:number,r:any) => { if (r.kind === 'detail') { reached.release(); await resume.wait; } return request(rev,r); };
  try {
    const open = v.refresh(); await reached.wait; const id = v.groupGraph.groups[0].id; await v.drill(id);
    const pending = v.panel.textContent; resume.release(); await open;
    expect(pending).toContain('Loading members'); expect(pending).toContain('Back to groups'); expect(v.panel.querySelectorAll('.graph-ng-member')).toHaveLength(N/2);
  } finally { resume.release(); f.dispose(); }
});

test('successive provisional layouts reuse live coordinates without persisting an incomplete generation', async () => {
  const disk = new MemoryAdapter(), app = await boot(disk, {});
  try {
    const first = await app.open(); expect(first.verified).toBe(false); expect(first.boundaries).toBeGreaterThan(0);
    const next = await app.open(); expect(next.verified).toBe(false); expect(next.layout.reused).toBeUndefined();
    expect(next.positions.every(Number.isFinite)).toBe(true); expect(next.boundaries).toBe(11); expect(disk.files.size).toBe(0);
  } finally { app.dispose(); }
});

test('(a) a second open of an unchanged graph is an exact hit: no layout iterations, no disk read, same positions', async () => {
  const disk = new MemoryAdapter(), app = await boot(disk, graph());
  try {
    const cold = await app.open();
    expect(cold.layout.cached).toBe(false); expect(cold.layout.reused).toBeUndefined(); expect(cold.boundaries).toBe(11);
    expect(cold.text).toMatch(/^Computed layout in \d+\.\d s$/); expect(manifests(disk)).toHaveLength(1);
    const again = await app.open();
    expect(again.layout.cached).toBe(true); expect(again.boundaries).toBe(0); expect(again.text).toBe('Reused saved layout');
    // The worker still holds this exact generation, so the view skips the chunk reads and SHA-256 checks.
    expect(again.binReads).toBe(0); expect(again.positions).toEqual(cold.positions);
  } finally { app.dispose(); }
});

test('(b) Obsidian reload reuses the saved layout, including the provisional build while links are still resolving', async () => {
  const disk = new MemoryAdapter(), links = graph(); let first = await boot(disk, links), cold: Float32Array;
  try { cold = (await first.open()).positions; } finally { first.dispose(); }
  // Reload with metadata complete at the first build: exact hit read from disk.
  let app = await boot(disk, links);
  try {
    const reopened = await app.open();
    expect(reopened.layout.cached).toBe(true); expect(reopened.boundaries).toBe(0); expect(reopened.binReads).toBeGreaterThan(0); expect(reopened.positions).toEqual(cold);
  } finally { app.dispose(); }
  // Reload while the link resolver has only reached half the notes. Previously this ran a full cold
  // layout (and blocked the worker) before the verified build found the exact generation.
  const resolving: Record<string, Record<string, number>> = Object.fromEntries(Object.entries(links).slice(0, N / 2));
  app = await boot(disk, resolving);
  try {
    const provisional = await app.open();
    expect(provisional.verified).toBe(false); expect(provisional.layout.cached).toBe(false);
    expect(provisional.layout.reused).toBe('all'); expect(provisional.boundaries).toBe(0); expect(provisional.text).toBe('Reused saved layout');
    expect(provisional.positions).toEqual(cold);
    expect(manifests(disk)).toHaveLength(1); const before = [...disk.files.keys()].sort();
    Object.assign(resolving, links); app.plugin.adapter.invalidate();
    const verified = await app.open();
    expect(verified.verified).toBe(true); expect(verified.layout.cached).toBe(true); expect(verified.boundaries).toBe(0); expect(verified.positions).toEqual(cold);
    // A provisional build never overwrites the complete persisted generation.
    expect([...disk.files.keys()].sort()).toEqual(before);
  } finally { app.dispose(); }
});

test('(c) a single note edit is a warm start: a short relax, distant notes stay put, and it is persisted', async () => {
  const disk = new MemoryAdapter(), links = graph(), app = await boot(disk, links);
  try {
    const cold = await app.open();
    links[name(10)]![name(30)] = 1; app.plugin.adapter.invalidate();
    const edited = await app.open();
    expect(edited.layout.cached).toBe(false); expect(edited.layout.reused).toBe('some');
    expect(edited.boundaries).toBeLessThanOrEqual(12); expect(edited.boundaries).toBeGreaterThan(0);
    expect(edited.text).toMatch(/^Reused saved layout, adjusted in \d+\.\d s$/);
    // Only the new edge's endpoints and their neighbours move.
    const moved = Array.from({ length: N }, (_, i) => edited.positions[i * 2] !== cold.positions[i * 2] || edited.positions[i * 2 + 1] !== cold.positions[i * 2 + 1]).filter(Boolean).length;
    expect(moved).toBeGreaterThan(0); expect(moved).toBeLessThan(N / 2);
    const after = await app.open(); expect(after.layout.cached).toBe(true); expect(after.positions).toEqual(edited.positions);
  } finally { app.dispose(); }
  const reload = await boot(disk, links);
  try { const r = await reload.open(); expect(r.layout.cached).toBe(true); expect(r.boundaries).toBe(0); } finally { reload.dispose(); }
});

test('(d) appearance and grouping changes keep the layout: exact for presentation, reused positions for grouping', async () => {
  const disk = new MemoryAdapter(), links = graph(), app = await boot(disk, links);
  try {
    const cold = await app.open();
    // Appearance, colors and focus emphasis are presentation-only.
    app.apply(settings(s => {
      Object.assign(s, { nodeSize: 7, edgeSize: 1.5, labelSize: 17 });
      s.declaration.colors = [{ name: 'A notes', color: '#ff0000', predicate: { kind: 'folder', prefix: ['A'] } }];
      s.declaration.hierarchy = { parentProperty: 'parent' }; s.declaration.interest = { property: 'score' }; s.declaration.groupContext = true;
    }));
    const appearance = await app.open();
    expect(appearance.layout.cached).toBe(true); expect(appearance.boundaries).toBe(0); expect(appearance.positions).toEqual(cold.positions);
    // Grouping changes the declaration digest and group level but not the drawn topology. Previously a cold layout.
    app.apply(settings(s => { s.declaration.groups = [{ from: 'folder', depth: 1 }, { from: 'key', key: 'category' }]; s.groupLevel = 1; }));
    const regrouped = await app.open();
    expect(regrouped.layout.cached).toBe(false); expect(regrouped.layout.reused).toBe('all'); expect(regrouped.boundaries).toBe(0);
    expect(regrouped.text).toBe('Reused saved layout'); expect(regrouped.positions).toEqual(cold.positions);
    expect(manifests(disk)).toHaveLength(1);
  } finally { app.dispose(); }
  // The reused positions were persisted under the new declaration: the next reload is exact.
  const reload = await boot(disk, links, settings(s => { s.declaration.groups = [{ from: 'folder', depth: 1 }, { from: 'key', key: 'category' }]; s.groupLevel = 1; }));
  try { const r = await reload.open(); expect(r.layout.cached).toBe(true); expect(r.binReads).toBeGreaterThan(0); } finally { reload.dispose(); }
});

test('(e) layout physics and topology changes invalidate: full computation, never the old positions', async () => {
  const disk = new MemoryAdapter(), links = graph(), app = await boot(disk, links);
  try {
    const cold = await app.open();
    app.apply(settings(s => { s.layout = { ...s.layout, force: { ...s.layout.force, gravity: 2 } }; }));
    const physics = await app.open();
    expect(physics.layout.cached).toBe(false); expect(physics.layout.reused).toBeUndefined(); expect(physics.boundaries).toBe(11);
    expect(physics.text).toMatch(/^Computed layout in/); expect(physics.positions).not.toEqual(cold.positions);
    // A settings change is not damage: no quarantined copy is left in the (possibly synced) plugin folder.
    expect([...disk.files.keys()].some(p => p.includes('.corrupt-'))).toBe(false); expect(manifests(disk)).toHaveLength(1);
    // Same physics, different edges: the producer is a different source of edges.
    app.apply(settings(s => { s.layout = { ...s.layout, force: { ...s.layout.force, gravity: 2 } }; s.declaration.edges = [{ name: 'parents', kind: 'inline', key: 'parent', type: 'parent' }]; }));
    const topology = await app.open();
    expect(topology.layout.cached).toBe(false); expect(topology.layout.reused).toBeUndefined(); expect(topology.boundaries).toBe(11);
  } finally { app.dispose(); }
});

test('changing identity rules cannot move saved positions to other notes that reuse the same ID strings', async () => {
  const disk = new MemoryAdapter(), links = Object.fromEntries(Array.from({ length: N }, (_, i) => [name(i), {}]));
  const app = await boot(disk, links, settings(s => { s.declaration.identity = [{ key: 'uid' }]; }));
  app.plugin.adapter.app.metadataCache.getFileCache = (file: FixtureFile) => {
    const i = Number(file.path.match(/n(\d+)\.md$/)![1]);
    return { frontmatter: { uid: `id-${i}`, alternate: `id-${(i + 1) % N}` } };
  };
  try {
    const cold = await app.open();
    app.apply(settings(s => { s.declaration.identity = [{ key: 'alternate' }]; }));
    const changed = await app.open();
    // Every old string is present and there are no changed edges: neither the membership check
    // nor the >50% heuristic can detect this identity-namespace change.
    expect(changed.layout.reused).toBeUndefined(); expect(changed.boundaries).toBe(11);
    expect(changed.trace.expected).not.toBe(cold.trace.expected); // isolated-ring geometry is deliberately seed-independent
    expect([...disk.files.keys()].some(p => p.includes('.corrupt-'))).toBe(false);
  } finally { app.dispose(); }
});

test('warm starts walk the Barnes-Hut tree only for movable notes, with identical forces for them', async () => {
  const { BarnesHut } = await import('../src/core/barnes-hut');
  const { random } = await import('../src/core/layout');
  const n = 500, rng = random(5), p = Float32Array.from({ length: n * 2 }, () => (rng() - .5) * 100), mass = Float32Array.from({ length: n }, () => 1 + Math.floor(rng() * 4));
  const movable = Uint8Array.from({ length: n }, (_, i) => i % 9 === 0 ? 1 : 0), tree = new BarnesHut(n);
  tree.build(p, mass, 32);
  const all = new Float32Array(n * 2), some = new Float32Array(n * 2);
  tree.repulse(p, mass, all, 2, 1.2); tree.repulse(p, mass, some, 2, 1.2, movable);
  for (let i = 0; i < n; i++) for (const k of [i * 2, i * 2 + 1]) expect(some[k]).toBe(movable[i] ? all[k]! : 0);
});

test('a failed or skipped cache write keeps the drawn graph and is retried by the next open, not left behind by an exact hit', async () => {
  const disk = new MemoryAdapter(), app = await boot(disk, graph()), write = disk.writeBinary.bind(disk);
  disk.writeBinary = async () => { throw new Error('synthetic disk full'); };
  try {
    const first = await app.open(); expect(first.layout.cached).toBe(false); expect(manifests(disk)).toHaveLength(0); expect(first.cacheError).toContain('synthetic disk full');
    disk.writeBinary = write; app.plugin.adapter.invalidate();
    // The worker still holds the exact layout, but it was never committed: the write is retried.
    const second = await app.open(); expect(second.layout.cached).toBe(true); expect(second.boundaries).toBe(0); expect(manifests(disk)).toHaveLength(1);
    const third = await app.open(); expect(third.layout.cached).toBe(true); expect(disk.writes).toBe(0);
  } finally { app.dispose(); }
});

test('a loaded generation rejected by the worker is quarantined and the same key is written again', async () => {
  const disk = new MemoryAdapter(), links = graph(), first = await boot(disk, links);
  let key: string, declarationHash: string;
  try {
    await first.open();
    const path = manifests(disk)[0]!, manifest = JSON.parse(await disk.read(path)); key = manifest.meta.key; declarationHash = manifest.meta.declarationHash;
    const generation = await first.plugin.store.latest(manifest.meta.declarationHash);
    // Valid checksums and layout, but an invalid group summary: rejection happens only after latest() marks it committed.
    generation.files.groups = new TextEncoder().encode('{}'); await first.plugin.store.write(generation);
  } finally { first.dispose(); }
  const app = await boot(disk, links);
  try {
    const rebuilt = await app.open();
    expect(rebuilt.layout.cached).toBe(false); expect(rebuilt.boundaries).toBe(11);
    expect([...disk.files.keys()].some(p => p.includes('.corrupt-'))).toBe(true);
    expect(disk.files.has(`plugin/cache/local/${declarationHash!}/${key!}/manifest.json`)).toBe(true);
    expect(JSON.parse(await disk.read('plugin/cache/local/index.json'))).toEqual([{ declarationHash: declarationHash!, key: key! }]);
    expect(app.plugin.store.committed).toBe(key!);
  } finally { app.dispose(); }
  const reload = await boot(disk, links);
  try { expect((await reload.open()).layout.cached).toBe(true); } finally { reload.dispose(); }
});

test('known miss: deleting or renaming a note recomputes from scratch (ADR-0004 removed-identity refusal)', async () => {
  const disk = new MemoryAdapter(), links = graph(), app = await boot(disk, links);
  try {
    await app.open();
    // Attribute-only edits (no declared input changes) stay exact.
    app.plugin.adapter.invalidate(); expect((await app.open()).layout.cached).toBe(true);
    const files = app.plugin.adapter.app.vault.getMarkdownFiles(); files.splice(5, 1); delete links[name(5)];
    app.plugin.adapter.invalidate();
    const deleted = await app.open();
    expect(deleted.layout.cached).toBe(false); expect(deleted.layout.reused).toBeUndefined(); expect(deleted.boundaries).toBe(11);
    expect(deleted.text).toMatch(/^Computed layout in/);
  } finally { app.dispose(); }
});

test('browser runtime without Node Buffer: the cache writes, and a reload is an exact hit; the plugin never touches Buffer', async () => {
  // Browser-native Obsidian has no Node Buffer. Any access from the store, layout or view code throws.
  const own = Object.getOwnPropertyDescriptor(globalThis, 'Buffer');
  Object.defineProperty(globalThis, 'Buffer', { configurable: true, get() { throw new ReferenceError('Buffer is not defined'); } });
  /** A disk that, like a browser adapter, accepts only a plain ArrayBuffer and returns one. */
  class BrowserDisk extends MemoryAdapter {
    override async writeBinary(p: string, b: ArrayBuffer) { expect(Object.getPrototypeOf(b)).toBe(ArrayBuffer.prototype); return super.writeBinary(p, b); }
  }
  try {
    const disk = new BrowserDisk(), links = graph(); let cold: Float32Array;
    const first = await boot(disk, links);
    try { const r = await first.open(); expect(r.cacheError).toBe(''); expect(r.layout.cached).toBe(false); cold = r.positions; } finally { first.dispose(); }
    expect(manifests(disk)).toHaveLength(1);
    const reload = await boot(disk, links);
    try {
      const r = await reload.open();
      expect(r.text).toBe('Reused saved layout'); expect(r.layout.cached).toBe(true); expect(r.boundaries).toBe(0); expect(r.binReads).toBeGreaterThan(0); expect(r.positions).toEqual(cold);
    } finally { reload.dispose(); }
  } finally { if (own) Object.defineProperty(globalThis, 'Buffer', own); else delete (globalThis as any).Buffer; }
});


test('review: changed vault restart measures verified churn against saved edges, not incomplete interim edges', async () => {
  const disk = new MemoryAdapter(), links = graph(), original = await boot(disk, links);
  try { await original.open(); } finally { original.dispose(); }
  links[name(10)]![name(30)] = 1;
  const directDisk = new MemoryAdapter();
  for (const [path, bytes] of disk.files) directDisk.files.set(path, bytes.slice());
  const direct = await boot(directDisk, links);
  let expected: Float32Array;
  try { const warm = await direct.open(); expected = warm.positions; expect(warm.layout.reused).toBe('some'); }
  finally { direct.dispose(); }
  const resolving = Object.fromEntries(Object.entries(links).slice(0, 1)), reload = await boot(disk, resolving);
  try {
    const partial = await reload.open(); expect(partial.verified).toBe(false);
    Object.assign(resolving, links); reload.plugin.adapter.invalidate();
    const verified = await reload.open();
    expect(verified.layout.reused).toBe('some'); expect(verified.boundaries).toBeLessThanOrEqual(12);
    expect(verified.positions).toEqual(expected!);
    const persisted = await boot(disk, links);
    try { const next = await persisted.open(); expect(next.layout.cached).toBe(true); expect(next.positions).toEqual(expected!); }
    finally { persisted.dispose(); }
  } finally { reload.dispose(); }
});

test('review: exact interim reuse never reports a saved cache hit or stored key', async () => {
  const disk = new MemoryAdapter(), links: Record<string, Record<string, number>> = {}, app = await boot(disk, links);
  try {
    const partial = await app.open(); expect(disk.files.size).toBe(0);
    for (let i = 0; i < N; i++) links[name(i)] = {};
    app.plugin.adapter.invalidate();
    const verified = await app.open();
    expect(verified.verified).toBe(true); expect(verified.positions.every(Number.isFinite)).toBe(true); expect(verified.boundaries).toBe(11);
    expect(verified.layout.cached).toBe(false); expect(verified.layout.reused).toBeUndefined();
    expect(verified.trace.valid).toBe(false); expect(verified.trace.stored).toBeUndefined();
    expect(verified.text).toMatch(/^Computed layout/);
  } finally { app.dispose(); }
});

test('review: a full-budget restart from interim positions reports computation, not a short adjustment', async () => {
  const disk = new MemoryAdapter(), links: Record<string, Record<string, number>> = {}, app = await boot(disk, links);
  try {
    await app.open(); Object.assign(links, graph()); app.plugin.adapter.invalidate();
    const verified = await app.open();
    expect(verified.verified).toBe(true); expect(verified.boundaries).toBe(11);
    expect(verified.layout.cached).toBe(false); expect(verified.layout.reused).toBeUndefined();
    expect(verified.trace.stored).toBeUndefined(); expect(verified.text).toMatch(/^Computed layout in /);
  } finally { app.dispose(); }
});

test('cold Quick start adopts a memory-only draft once, refines on demand and shares settled cache identity', async () => {
  const f = await transitions(true), {v} = f;
  try {
    await v.refresh(); await v.showDetails();
    expect(f.solves().map(({r}) => r.kind)).toEqual(['layout']); expect(v.detailRenderer.positions).toBe(v.positions);
    expect(v.statusSummary.textContent).toContain('Quick start draft'); expect(v.statusSummary.textContent).not.toContain('Layout stopped');
    expect(v.statusSummary.querySelector('.graph-ng-refine')).toBeDefined(); expect(manifests(f.disk)).toHaveLength(0);
    const refusal = await f.plugin.pipeline.request(v.activeRevision, {kind:'encode'}).then(() => '', String);
    expect(refusal).toContain('Layout not settled');
    // Use the real worker adoption and cache paths; the fixture has no GL renderer.
    v.detailRenderer = undefined; await v.applyLayout({}); expect(v.layoutSettled).toBe(true); expect(manifests(f.disk)).toHaveLength(1);
    expect(f.solves().map(({r}) => r.kind)).toEqual(['layout','recompute']);
    f.plugin.settings.quickStart = false; const again = await f.open(); expect(again.layout.cached).toBe(true); expect(again.positions).toEqual(v.positions);
  } finally { f.dispose(); }
});

test('review: an unchanged refresh does not silently refine a Quick start draft', async () => {
  const f = await transitions(true), { v } = f;
  try {
    await v.refresh(); await v.showDetails(); expect(v.budgetDraft).toBe(true);
    const before = v.positions.slice(); v.detailRenderer = undefined; // no GL in this fixture
    await v.refresh(); // no changed facts, settings, or Keep refining
    expect({ draft: v.budgetDraft, same: before.every((n: number, i: number) => n === v.positions[i]), manifests: manifests(f.disk).length }).toEqual({draft:true,same:true,manifests:0});
  } finally { f.dispose(); }
});

test('review: a Graphics trial does not discard the only reusable Auto cache', async () => {
  const f = await transitions(), { v } = f;
  try {
    await v.refresh(); await v.showDetails(); const prior = manifests(f.disk); expect(prior).toHaveLength(1);
    v.detailRenderer = undefined; let dispatched = 0;
    const start = f.calls.length; await v.applyLayout({}, true, () => dispatched++);
    expect(dispatched).toBe(1); expect(f.calls.slice(start).map(({r}) => r.kind)).toEqual(['recompute']);
    const retained = f.disk.files.has(prior[0]!); const sameGraph = await f.open();
    expect({saved:f.plugin.settings.layoutEngine, retained, hit:sameGraph.layout.cached}).toEqual({saved:'auto',retained:true,hit:true});
  } finally { f.dispose(); }
});

test('review: retrying a failed explicit physics pass keeps the requested budget', async () => {
  const f = await transitions(true), { v } = f;
  try {
    v.contributionPage.fail = () => {}; await v.refresh(); await v.applyLayout({ iterations:40 });
    const rpc = f.plugin.pipeline, request = rpc.request.bind(rpc); let once = true; const flags: boolean[] = [];
    rpc.request = (rev: number, r: any) => { if (r.kind === 'layout') { flags.push(r.quickStart); if (once) { once = false; return Promise.reject(Error('synthetic processing deadline')); } } return request(rev,r); };
    await v.showDetails(); expect(v.contentEl.dataset.state).toBe('error'); await v.refresh();
    expect({flags,draft:v.budgetDraft}).toEqual({flags:[false,false],draft:false});
  } finally { f.dispose(); }
});

test('review: a provisional Quick start announces that it is a draft', async () => {
  const f = await transitions(true), { v } = f;
  try {
    f.plugin.adapter.factsComplete = () => false; v.stageAnnouncement = new ControlElement();
    await v.refresh(); await v.showDetails(); expect(v.statusSummary.textContent).toContain('Quick start draft');
    expect(v.stageAnnouncement.textContent).toContain('Quick start draft');
    expect(v.stageAnnouncement.textContent).toContain(v.statusText);
  } finally { f.dispose(); }
});

test('review: a rejected pass preserves the committed graph engine readout', async () => {
  const f = await transitions(true), { v } = f;
  try {
    await v.refresh(); await v.showDetails(); const prior = v.report.engineStatus; expect(prior.engine).toBe('processor');
    const rpc = f.plugin.pipeline, request = rpc.request.bind(rpc); rpc.request = (rev: number,r: any) => r.kind === 'recompute' ? Promise.reject(Error('synthetic failure')) : request(rev,r);
    v.detailRenderer = undefined; await expect(v.applyLayout({},true)).rejects.toThrow('synthetic failure');
    expect(v.report.engineStatus).toEqual(prior);
  } finally { f.dispose(); }
});
