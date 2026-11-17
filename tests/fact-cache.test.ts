import { test, expect } from 'bun:test';
import { defaults } from '../src/settings';
import { FixtureFile } from './support/obsidian-fixture';
import { MemoryAdapter } from './support/memory-adapter';
import { FactCache, factKey } from '../src/adapter/fact-cache';
import { LocalAdapter, type PropertySource } from '../src/adapter/local';
import { defaultDeclaration } from '../src/core/declaration';
import { unpackRows } from '../src/core/columns';
import { buildProjection, type FactRow } from '../src/core/projection';

function fixture(source?: PropertySource) {
  const files = ['a.md', 'b.md'].map(path => { const f = new FixtureFile(path); Object.assign(f.stat, { mtime: 100 }); return f; });
  const caches = new Map<string, any>(), events = new Map<string, ((...args: any[]) => any)[]>(), cleanup: (() => void)[] = [];
  const on = (name: string, fn: (...args: any[]) => any) => events.set(name, [...events.get(name) ?? [], fn]);
  const declaration = { ...defaultDeclaration('native@1'), columns: ['id', 'category'], identity: [{ key: 'id' }], edges: [] };
  const app: any = { vault: { getFiles: () => files, getMarkdownFiles: () => files.filter(f => f.extension === 'md'), getAbstractFileByPath: (p: string) => files.find(f => f.path === p), on: (n: string, f: any) => on('vault:' + n, f), read() { throw Error('body read forbidden'); } }, metadataCache: { getFileCache: (f: FixtureFile) => caches.get(f.path) ?? null, resolvedLinks: {}, on } };
  const adapter = new LocalAdapter(app, { register(fn: () => void) { cleanup.push(fn); }, registerEvent() {} } as any, 'native@1', 10000, () => {}, true, declaration, source);
  const rows = async (reset = true) => { const all: FactRow[] = []; for await (const b of adapter.columns(reset, { chunkRows: 1, budgetMs: 8 })) all.push(...unpackRows(b.columns)); return all; };
  return { adapter, rows, files, caches, declaration, emit: (name: string, ...args: any[]) => events.get(name)?.forEach(fn => fn(...args)), dispose: () => cleanup.forEach(fn => fn()) };
}
const derived: PropertySource = { get: p => ({ source: 'derived', state: 'current', verified: false, frontmatter: { id: p, category: 'Derived' } }) };
async function savedFixture() {
  const disk = new MemoryAdapter(), first = fixture();
  const store = new FactCache(disk, 'plugin/saved-facts'); first.adapter.attachFactCache(store, 'local');
  for (const file of first.files) first.caches.set(file.path, { frontmatter: { id: file.path, category: 'Saved', undeclared: 'Not part of the saved declaration' } });
  const rows = await first.rows(); expect(first.adapter.factsComplete()).toBe(true);
  expect(rows.every(row => !Object.hasOwn(row.properties, 'undeclared'))).toBe(true);
  await first.adapter.saveFacts(); expect(first.adapter.cacheStatus).toBe('saved'); first.dispose();
  const boot = (source?: PropertySource, identity = 'local') => { const f = fixture(source); f.adapter.attachFactCache(new FactCache(disk, 'plugin/saved-facts'), identity); return f; };
  return { disk, rows, boot };
}

test('cold adapter restores provisional graph before host completion; host disagreement wins', async () => {
  const saved = await savedFixture(), f = saved.boot();
  try {
    const rows = await f.rows(); expect(rows).toEqual(saved.rows); expect(f.adapter.cacheStatus).toBe('restored');
    expect(buildProjection(rows, f.declaration).paths.length).toBe(2);
    expect(f.adapter.factsComplete()).toBe(false); expect(f.adapter.coverage().indexed).toBe(0);
    for (const file of f.files) { f.caches.set(file.path, { frontmatter: { id: file.path, category: 'Host wins' } }); f.emit('changed', file); }
    f.adapter.index.flush(); const live = await f.rows(false);
    expect(live.map(r => r.properties.category)).toEqual(['Host wins', 'Host wins']);
    expect(f.adapter.factsComplete()).toBe(true); expect(f.adapter.savedCopy).toBe(false);
  } finally { f.dispose(); }
});

test('saved native facts never override selected derived verified:false or persist them', async () => {
  const saved = await savedFixture(), f = saved.boot(derived);
  try {
    const writes = saved.disk.writes, rows = await f.rows();
    expect(rows[0]!.properties.category).toBe('Derived'); expect(f.adapter.factsComplete()).toBe(false);
    await f.adapter.saveFacts(); expect(saved.disk.writes).toBe(writes); expect(f.adapter.savedCopy).toBe(false);
  } finally { f.dispose(); }
});

test('source, declaration, file stamps and whole-vault namespace mismatches refuse cache', async () => {
  for (const kind of ['source', 'declaration', 'mtime', 'size', 'namespace']) {
    const saved = await savedFixture(), f = saved.boot(undefined, kind === 'source' ? 'other' : 'local');
    try {
      if (kind === 'declaration') f.adapter.configure({ ...f.declaration, columns: ['other'] });
      if (kind === 'mtime') Object.assign(f.files[0]!.stat, { mtime: 101 });
      if (kind === 'size') f.files[0]!.stat.size++;
      if (kind === 'namespace') { const file = new FixtureFile('outside/image.png'); file.extension = 'png'; Object.assign(file.stat, { mtime: 100 }); f.files.push(file); }
      expect((await f.rows()).every(r => Object.keys(r.properties).length === 0)).toBe(true);
      expect(f.adapter.cacheStatus).toBe('miss'); expect(f.adapter.factsComplete()).toBe(false);
    } finally { f.dispose(); }
  }
});

test('corrupt, oversized and version-mismatched cache safely falls back', async () => {
  for (const kind of ['corrupt', 'version', 'oversized', 'malformed']) {
    const saved = await savedFixture(), path = 'plugin/saved-facts/manifest.json';
    if (kind === 'corrupt') saved.disk.files.set('plugin/saved-facts/0.bin', new TextEncoder().encode('bad'));
    if (kind === 'malformed') saved.disk.files.set(path, new TextEncoder().encode('{bad'));
    if (kind === 'version' || kind === 'oversized') { const m = JSON.parse(await saved.disk.read(path)); if (kind === 'version') m.format++; else m.parts[0].bytes = 2 ** 30; await saved.disk.write(path, JSON.stringify(m)); }
    const f = saved.boot();
    try { expect((await f.rows()).every(r => !r.properties.id)).toBe(true); expect(f.adapter.factsComplete()).toBe(false); expect(f.adapter.cacheStatus).toBe(kind === 'version' ? 'miss' : 'unavailable'); }
    finally { f.dispose(); }
  }
});

test('edits, source swaps and clear during restore cancel adoption before debounce', async () => {
  for (const kind of ['edit', 'source', 'clear']) {
    const saved = await savedFixture(), f = saved.boot();
    let release!: () => void, started!: () => void;
    const waiting = new Promise<void>(r => started = r), held = new Promise<void>(r => release = r), read = saved.disk.readBinary.bind(saved.disk);
    saved.disk.readBinary = async path => { started(); await held; return read(path); };
    const rows = f.rows(); await waiting;
    let clearing: Promise<void> | undefined;
    if (kind === 'edit') f.emit('vault:modify', f.files[0]);
    if (kind === 'source') f.adapter.setPropertySource(derived);
    if (kind === 'clear') clearing = f.adapter.clearFacts();
    release();
    try { const result = await rows; await clearing; expect(f.adapter.savedCopy).toBe(false); expect(f.adapter.factsComplete()).toBe(false); expect(result[0]!.properties.category).toBe(kind === 'source' ? 'Derived' : undefined); }
    finally { f.dispose(); }
  }
});

test('clear removes disk/live fallback, queues reconciliation and pauses saves', async () => {
  const saved = await savedFixture(), f = saved.boot();
  try {
    await f.rows(); await f.adapter.clearFacts(); f.adapter.index.flush();
    expect(saved.disk.files.size).toBe(0); expect((await f.rows(false)).every(r => !r.properties.id)).toBe(true);
    for (const file of f.files) f.caches.set(file.path, { frontmatter: { id: file.path } });
    await f.rows(); await f.adapter.saveFacts(); expect(saved.disk.files.size).toBe(0);
  } finally { f.dispose(); }
});

test('edits during save never leave a loadable partial generation', async () => {
  const f = fixture(), disk = new MemoryAdapter(), store = new FactCache(disk, 'plugin/saved-facts', async () => { f.emit('vault:modify', f.files[0]); });
  f.adapter.attachFactCache(store, 'local'); for (const file of f.files) f.caches.set(file.path, { frontmatter: { id: file.path } });
  try { await f.rows(); await f.adapter.saveFacts(); expect(await disk.exists('plugin/saved-facts/manifest.json')).toBe(false); }
  finally { f.dispose(); }
});

test('deadlines retain serialization until a pending host IO finishes', async () => {
  const disk = new MemoryAdapter(); let release!: () => void, started!: () => void;
  const startedIO = new Promise<void>(r => started = r), held = new Promise<boolean>(r => release = () => r(false));
  disk.exists = async () => { started(); return held; };
  const store = new FactCache(disk, 'plugin/saved-facts', async () => {}, 15);
  const load = store.load('key', () => true); await startedIO; await expect(load).rejects.toThrow('deadline');
  const clear = store.clear(true); release(); await clear; expect(store.paused).toBe(true);
});

test('quota failure is disposable and does not alter verified host rows', async () => {
  const f = fixture(), disk = new MemoryAdapter();
  disk.writeBinary = async () => { throw new DOMException('Synthetic quota exceeded', 'QuotaExceededError'); };
  f.adapter.attachFactCache(new FactCache(disk, 'plugin/cache/startup-facts'), 'local');
  for (const file of f.files) f.caches.set(file.path, { frontmatter: { id: file.path } });
  try {
    await f.rows(); await f.adapter.saveFacts();
    expect(f.adapter.cacheStatus).toBe('unavailable'); expect(f.adapter.factError).toContain('QuotaExceededError');
    expect(f.adapter.factsComplete()).toBe(true); expect(await disk.exists('plugin/cache/startup-facts/manifest.json')).toBe(false);
    expect((await f.rows()).map(r => r.properties.id)).toEqual(['a.md', 'b.md']);
  } finally { f.dispose(); }
});

test('device namespace is reused or acknowledged before persistence; failed save leaves none', async () => {
  const { default: GraphPlugin } = await import('../src/main');
  for (const mode of ['existing', 'new', 'failure']) {
    const plugin: any = Object.create(GraphPlugin.prototype); let writes = 0, acknowledged: string | undefined;
    const existing = '0123456789abcdef0123456789abcdef';
    plugin.settings = defaults('native@1');
    plugin.deviceNamespace = mode === 'existing' ? existing : undefined;
    plugin.save = async () => { writes++; if (mode === 'failure') throw Error('Synthetic storage failure'); acknowledged = plugin.deviceNamespace; };
    const result = await plugin.ensureDeviceNamespace();
    expect(writes).toBe(mode === 'existing' ? 0 : 1);
    if (mode === 'failure') { expect(result).toBeUndefined(); expect(plugin.deviceNamespace).toBeUndefined(); }
    else { expect(result).toMatch(/^[0-9a-f]{32}$/); expect(result).toBe(mode === 'existing' ? existing : acknowledged); expect(await plugin.ensureDeviceNamespace()).toBe(result); }
  }
});

test('namespace fingerprint is path-order independent and covers non-Markdown files', async () => {
  const files = [{ path: 'a.md', stat: { mtime: 1, size: 2 } }, { path: 'x.png', stat: { mtime: 2, size: 3 } }];
  const key = await factKey(files, ['native@1'], () => true);
  expect(await factKey([...files].reverse(), ['native@1'], () => true)).toBe(key);
  files[1]!.stat.mtime++; expect(await factKey(files, ['native@1'], () => true)).not.toBe(key);
});

test('namespace admission rejects invalid settings and joins an unacknowledged save', async () => {
  const { default: GraphPlugin } = await import('../src/main');
  const plugin: any = Object.create(GraphPlugin.prototype); let writes = 0, release!: () => void;
  plugin.settings = {};
  plugin.save = async () => { writes++; await new Promise<void>(r => release = r); };
  expect(await plugin.ensureDeviceNamespace()).toBeUndefined(); expect(writes).toBe(0);
  plugin.settings = defaults('native@1');
  const first = plugin.ensureDeviceNamespace(); let finished = false;
  const second = plugin.ensureDeviceNamespace().then((id: string) => { finished = true; return id; });
  await Promise.resolve(); expect(finished).toBe(false); expect(writes).toBe(1);
  release(); expect(await second).toBe(await first);
});

test('provisional rows retain the ordinary duplicate-ID quarantine', async () => {
  const disk = new MemoryAdapter(), first = fixture(), cold = fixture();
  first.adapter.attachFactCache(new FactCache(disk, 'plugin/cache/startup-facts'), 'local');
  cold.adapter.attachFactCache(new FactCache(disk, 'plugin/cache/startup-facts'), 'local');
  try {
    for (const file of first.files) first.caches.set(file.path, { frontmatter: { id: 'same' } });
    await first.rows(); await first.adapter.saveFacts();
    const projected = buildProjection(await cold.rows(), cold.declaration);
    expect(projected.paths).toEqual([]); expect(projected.quarantined.map(row => row.path)).toEqual(['a.md', 'b.md']);
    expect(cold.adapter.factsComplete()).toBe(false);
  } finally { first.dispose(); cold.dispose(); }
});
