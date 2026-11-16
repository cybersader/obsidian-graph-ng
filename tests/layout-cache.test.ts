import { test, expect } from 'bun:test';
import { FixtureFile } from './support/obsidian-fixture';
import { ControlElement } from './support/controls-dom';
import { MemoryAdapter } from './support/memory-adapter';
import { WorkerPipeline, type Transport } from '../src/pipeline';
import { BinaryLayoutStore } from '../src/core/binary-layout';
import { defaultDeclaration } from '../src/core/declaration';
import { defaults } from '../src/settings';
import { layoutText } from '../src/graph-information';

/** The real view refresh, layout worker and binary store over a disk that survives a simulated
 * Obsidian reload. Only Obsidian itself (vault, metadata cache) and the renderer are fixtures. */
const N = 48, name = (i: number) => `${i % 2 ? 'A' : 'B'}/n${i}.md`;
const graph = () => { const links: Record<string, Record<string, number>> = {}; for (let i = 0; i < N; i++) links[name(i)] = { [name((i + 1) % N)]: 1, [name((i * 7 + 3) % N)]: 1 }; return links; };
const declaration = defaultDeclaration('p@1');
function settings(change: (s: any) => void = () => {}) {
  const s: any = { ...defaults('p@1'), declaration: structuredClone(declaration), persistLayout: true, streamEveryIterations: 1 };
  s.layout = { ...s.layout, iterations: 60, relaxIterations: 12 }; change(s); return s;
}
async function boot(disk: MemoryAdapter, resolved: Record<string, Record<string, number>>, initial = settings()) {
  const { default: GraphPlugin } = await import('../src/main');
  const { LocalAdapter } = await import('../src/adapter/local');
  const files = Array.from({ length: N }, (_, i) => new FixtureFile(name(i)));
  const app: any = { vault: { getMarkdownFiles: () => files, getAbstractFileByPath: (p: string) => files.find(f => f.path === p), on() {}, read() { throw Error('no bodies'); } },
    metadataCache: { getFileCache: () => ({ frontmatter: {} }), resolvedLinks: resolved, on() {} } };
  const pipeline = new WorkerPipeline(new Worker(new URL('../src/layout-worker.ts', import.meta.url).href) as unknown as Transport, () => 20000);
  let streamed = 0, inner: any;
  Object.defineProperty(pipeline, 'onPositions', { get: () => (e: any) => { streamed++; inner?.(e); }, set: fn => { inner = fn; } });
  const plugin: any = Object.create(GraphPlugin.prototype);
  Object.assign(plugin, { settings: initial, propertyRevision: 0, nextRevision: 0, linkProducer: 'p@1', pipeline, generations: Object.create(null), writes: Promise.resolve(),
    ingestedHash: '', viewIdentity: 'local', store: new BinaryLayoutStore(disk, { ...initial.cache, directory: 'plugin/cache/local', cachedDeclarations: initial.cachedDeclarations }) });
  plugin.adapter = new LocalAdapter(app, { register() {}, registerEvent() {} } as any, 'p@1', 1, () => {}, true, initial.declaration);
  const { GraphView } = await import('../src/main');
  /** One view open (or one refresh after a change): returns what the user would see. */
  async function open() {
    const view: any = Object.create(GraphView.prototype); streamed = 0; disk.reads = []; disk.writes = 0;
    Object.assign(view, { plugin, app, revision: 0, renderRevision: 0, closed: false, members: new Map(), contributions: new Map(), startupTrace: [], cacheTrace: [],
      contributionPage: { clear() {}, suspend() {}, update() {} }, contentEl: { dataset: {} }, status: new ControlElement(), statusSummary: new ControlElement(),
      gpu: { available: false, reason: 'Not probed' }, showGroups() {} });
    await view.refreshOnce();
    expect(view.contentEl.dataset.state).toBe('ready');
    const layout = view.report.layout;
    return { layout, text: layoutText(layout), streamed, positions: view.positions as Float32Array, verified: view.contentEl.dataset.verified === 'true', cacheError: view.contentEl.dataset.cacheError, trace: view.cacheTrace.at(-1), binReads: disk.reads.filter(p => p.endsWith('.bin')).length };
  }
  /** Settings adoption as GraphPlugin.apply does it, minus the data.json save. */
  const apply = (next: any) => { plugin.settings = next; plugin.adapter.configure(next.declaration); };
  return { open, apply, plugin, dispose: () => { plugin.adapter.index.dispose(); pipeline.dispose(); } };
}
const manifests = (disk: MemoryAdapter) => [...disk.files.keys()].filter(p => p.endsWith('/manifest.json'));

test('successive provisional layouts reuse live coordinates without persisting an incomplete generation', async () => {
  const disk = new MemoryAdapter(), app = await boot(disk, {});
  try {
    const first = await app.open(); expect(first.verified).toBe(false); expect(first.streamed).toBeGreaterThan(0);
    const next = await app.open(); expect(next.verified).toBe(false); expect(next.layout.reused).toBe('interim');
    expect(next.positions).toEqual(first.positions); expect(next.streamed).toBe(0); expect(disk.files.size).toBe(0);
  } finally { app.dispose(); }
});

test('(a) a second open of an unchanged graph is an exact hit: no layout iterations, no disk read, same positions', async () => {
  const disk = new MemoryAdapter(), app = await boot(disk, graph());
  try {
    const cold = await app.open();
    expect(cold.layout.cached).toBe(false); expect(cold.layout.reused).toBeUndefined(); expect(cold.streamed).toBe(59);
    expect(cold.text).toMatch(/^Computed layout in \d+\.\d s$/); expect(manifests(disk)).toHaveLength(1);
    const again = await app.open();
    expect(again.layout.cached).toBe(true); expect(again.streamed).toBe(0); expect(again.text).toBe('Reused saved layout');
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
    expect(reopened.layout.cached).toBe(true); expect(reopened.streamed).toBe(0); expect(reopened.binReads).toBeGreaterThan(0); expect(reopened.positions).toEqual(cold);
  } finally { app.dispose(); }
  // Reload while the link resolver has only reached half the notes. Previously this ran a full cold
  // layout (and blocked the worker) before the verified build found the exact generation.
  const resolving: Record<string, Record<string, number>> = Object.fromEntries(Object.entries(links).slice(0, N / 2));
  app = await boot(disk, resolving);
  try {
    const provisional = await app.open();
    expect(provisional.verified).toBe(false); expect(provisional.layout.cached).toBe(false);
    expect(provisional.layout.reused).toBe('all'); expect(provisional.streamed).toBe(0); expect(provisional.text).toBe('Reused saved layout');
    expect(provisional.positions).toEqual(cold);
    expect(manifests(disk)).toHaveLength(1); const before = [...disk.files.keys()].sort();
    Object.assign(resolving, links); app.plugin.adapter.invalidate();
    const verified = await app.open();
    expect(verified.verified).toBe(true); expect(verified.layout.cached).toBe(true); expect(verified.streamed).toBe(0); expect(verified.positions).toEqual(cold);
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
    expect(edited.streamed).toBeLessThanOrEqual(12); expect(edited.streamed).toBeGreaterThan(0);
    expect(edited.text).toMatch(/^Reused saved layout, adjusted in \d+\.\d s$/);
    // Only the new edge's endpoints and their neighbours move.
    const moved = Array.from({ length: N }, (_, i) => edited.positions[i * 2] !== cold.positions[i * 2] || edited.positions[i * 2 + 1] !== cold.positions[i * 2 + 1]).filter(Boolean).length;
    expect(moved).toBeGreaterThan(0); expect(moved).toBeLessThan(N / 2);
    const after = await app.open(); expect(after.layout.cached).toBe(true); expect(after.positions).toEqual(edited.positions);
  } finally { app.dispose(); }
  const reload = await boot(disk, links);
  try { const r = await reload.open(); expect(r.layout.cached).toBe(true); expect(r.streamed).toBe(0); } finally { reload.dispose(); }
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
    expect(appearance.layout.cached).toBe(true); expect(appearance.streamed).toBe(0); expect(appearance.positions).toEqual(cold.positions);
    // Grouping changes the declaration digest and group level but not the drawn topology. Previously a cold layout.
    app.apply(settings(s => { s.declaration.groups = [{ from: 'folder', depth: 1 }, { from: 'key', key: 'category' }]; s.groupLevel = 1; }));
    const regrouped = await app.open();
    expect(regrouped.layout.cached).toBe(false); expect(regrouped.layout.reused).toBe('all'); expect(regrouped.streamed).toBe(0);
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
    expect(physics.layout.cached).toBe(false); expect(physics.layout.reused).toBeUndefined(); expect(physics.streamed).toBe(59);
    expect(physics.text).toMatch(/^Computed layout in/); expect(physics.positions).not.toEqual(cold.positions);
    // A settings change is not damage: no quarantined copy is left in the (possibly synced) plugin folder.
    expect([...disk.files.keys()].some(p => p.includes('.corrupt-'))).toBe(false); expect(manifests(disk)).toHaveLength(1);
    // Same physics, different edges: the producer is a different source of edges.
    app.apply(settings(s => { s.layout = { ...s.layout, force: { ...s.layout.force, gravity: 2 } }; s.declaration.edges = [{ name: 'parents', kind: 'inline', key: 'parent', type: 'parent' }]; }));
    const topology = await app.open();
    expect(topology.layout.cached).toBe(false); expect(topology.layout.reused).toBeUndefined(); expect(topology.streamed).toBe(59);
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
    expect(changed.layout.reused).toBeUndefined(); expect(changed.streamed).toBe(59);
    expect(changed.positions).not.toEqual(cold.positions);
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
    const second = await app.open(); expect(second.layout.cached).toBe(true); expect(second.streamed).toBe(0); expect(manifests(disk)).toHaveLength(1);
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
    expect(rebuilt.layout.cached).toBe(false); expect(rebuilt.streamed).toBe(59);
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
    expect(deleted.layout.cached).toBe(false); expect(deleted.layout.reused).toBeUndefined(); expect(deleted.streamed).toBe(59);
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
      expect(r.text).toBe('Reused saved layout'); expect(r.layout.cached).toBe(true); expect(r.streamed).toBe(0); expect(r.binReads).toBeGreaterThan(0); expect(r.positions).toEqual(cold);
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
    expect(verified.layout.reused).toBe('some'); expect(verified.streamed).toBeLessThanOrEqual(12);
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
    expect(verified.verified).toBe(true); expect(verified.positions).toEqual(partial.positions); expect(verified.streamed).toBe(0);
    expect(verified.layout.cached).toBe(false); expect(verified.layout.reused).toBe('interim');
    expect(verified.trace.valid).toBe(false); expect(verified.trace.stored).toBeUndefined();
    expect(verified.text).toBe('Reused provisional layout');
  } finally { app.dispose(); }
});

test('review: a full-budget restart from interim positions reports computation, not a short adjustment', async () => {
  const disk = new MemoryAdapter(), links: Record<string, Record<string, number>> = {}, app = await boot(disk, links);
  try {
    await app.open(); Object.assign(links, graph()); app.plugin.adapter.invalidate();
    const verified = await app.open();
    expect(verified.verified).toBe(true); expect(verified.streamed).toBe(59);
    expect(verified.layout.cached).toBe(false); expect(verified.layout.reused).toBeUndefined();
    expect(verified.trace.stored).toBeUndefined(); expect(verified.text).toMatch(/^Computed layout in /);
  } finally { app.dispose(); }
});
