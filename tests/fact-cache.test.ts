import { test, expect, spyOn } from 'bun:test';
import { defaults } from '../src/settings';
import { FixtureFile } from './support/obsidian-fixture';
import { MemoryAdapter } from './support/memory-adapter';
import { FactCache, factKey } from '../src/adapter/fact-cache';
import { LocalAdapter, type PropertySource } from '../src/adapter/local';
import { defaultDeclaration, digest } from '../src/core/declaration';
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
    expect(saved.disk.files.size).toBe(0);
  } finally { f.dispose(); }
});

// Drive public room discovery and window events, including a cold plugin restart.
const directory = 'plugin/cache/startup-facts';
const roomDir = async (id: string) => `${directory}/${await digest(id)}`;
async function contractFixture(disk = new MemoryAdapter(), firstId = 'ocpf1:room-a', missing?: 'rooms' | 'roomFor') {
  const { default: GraphPlugin } = await import('../src/main');
  const a = { cacheIdentity: firstId as string | undefined, generation: 1, complete: true, verifiedComplete: true }, b = { ...a, cacheIdentity: 'ocpf1:room-b' };
  const handles = [a, b];
  const live = new Map<string, { category: string; verified: boolean }>();
  const source: PropertySource = { rooms: () => handles, roomFor: path => path === 'a.md' ? a : path === 'b.md' ? b : undefined, get(path) {
    const row = live.get(path);
    return row && { source: 'derived', state: 'current', verified: row.verified, frontmatter: { id: path, category: row.category } };
  } };
  if (missing) delete source[missing];
  const f = fixture(), cleanup: (() => void)[] = [], host = Object.assign(new EventTarget(), { openclast: { propertyFacts: source } });
  const unmounted = new FixtureFile('unmounted.md'); Object.assign(unmounted.stat, { mtime: 100 }); f.files.push(unmounted);
  const plugin = Object.assign(Object.create(GraphPlugin.prototype), { adapter: f.adapter, settings: { debounceMs: 5, ingest: { chunkRows: 1, budgetMs: 8 } },
    app: { workspace: { getLeavesOfType: () => [] } }, register: (fn: () => void) => cleanup.push(fn), notify() {} });
  f.adapter.attachFactCache(new FactCache(disk, directory), 'device'); plugin.watchProperties(host);
  const send = (event: string, detail?: unknown) => host.dispatchEvent(new CustomEvent(event, { detail }));
  let settledWork: ReturnType<LocalAdapter['onRoomSettled']> | undefined; const record = f.adapter.onRoomSettled.bind(f.adapter);
  f.adapter.onRoomSettled = (...args) => settledWork = record(...args);
  const settle = async (h = a) => { settledWork = undefined; send('oc:property-facts-settled', { generation: h.generation, cacheIdentity: h.cacheIdentity }); await settledWork; };
  const fill = (path: string) => live.set(path, { category: `Saved ${path}`, verified: true });
  return { ...f, a, b, handles, source, fill, live, disk, settle, send, close() { cleanup.forEach(fn => fn()); f.dispose(); } };
}
async function savedContract() {
  const f = await contractFixture();
  try { f.fill('a.md'); f.fill('b.md'); await f.rows(); await f.settle(f.a); await f.settle(f.b); expect(f.disk.writes).toBe(2); return f.disk; }
  finally { f.close(); }
}
test('a room settlement saves only its own routed paths even with incomplete siblings', async () => {
  const f = await contractFixture();
  try {
    f.fill('a.md'); f.fill('unmounted.md'); await f.rows(); expect(f.adapter.factsComplete()).toBe(false);
    await f.settle(f.a); expect(f.disk.files.size).toBe(2);
    const dir = await roomDir(f.a.cacheIdentity!); expect(await f.disk.exists(`${dir}/manifest.json`)).toBe(true);
    expect(JSON.parse(await f.disk.read(`${dir}/0.bin`)).map((r: FactRow) => r.path)).toEqual(['a.md']);
    expect([...f.disk.files.keys()].every(path => !path.includes('ocpf1:'))).toBe(true);
    expect(await f.disk.exists(await roomDir(f.b.cacheIdentity))).toBe(false);
  } finally { f.close(); }
});
test('cold replay stays provisional across routed rooms, and live host facts always win', async () => {
  const f = await contractFixture(await savedContract());
  try {
    f.a.verifiedComplete = f.b.verifiedComplete = false;
    expect((await f.rows()).map(r => r.properties.category)).toEqual(['Saved a.md', 'Saved b.md', undefined]);
    expect(f.adapter.savedCopy).toBe(true); expect(f.adapter.coverage().indexed).toBe(0); expect(f.adapter.factsComplete()).toBe(false);
    f.live.set('a.md', { category: 'Host now', verified: false }); f.caches.set('b.md', { frontmatter: { category: 'Native now' } });
    expect((await f.rows()).map(r => r.properties.category)).toEqual(['Host now', 'Native now', undefined]);
    expect(f.adapter.savedCopy).toBe(false); expect(f.adapter.factsComplete()).toBe(false);
  } finally { f.close(); }
});
test('cold identity mismatch purges the orphan partition without reading it or removing siblings', async () => {
  const disk = await savedContract(), reads = disk.reads.length, f = await contractFixture(disk, 'ocpf1:new');
  try {
    expect((await f.rows()).map(r => r.properties.category)).toEqual([undefined, 'Saved b.md', undefined]);
    const old = await roomDir('ocpf1:room-a'); expect(await disk.exists(old)).toBe(false); expect(disk.reads.slice(reads)).not.toContain(`${old}/0.bin`);
  } finally { f.close(); }
});
for (const missing of ['rooms', 'roomFor'] as const) test(`old host with no ${missing} cannot replay or save`, async () => {
  const f = await contractFixture(await savedContract(), 'ocpf1:room-a', missing);
  try { expect((await f.rows()).every(r => !r.properties.id)).toBe(true); f.fill('a.md'); await f.rows(); await f.settle(f.a); await f.adapter.saveFacts(); expect(f.disk.files.size).toBe(0); }
  finally { f.close(); }
});
test('stale events, transport completion and metadata settlement cannot authorize writes', async () => {
  const f = await contractFixture();
  try {
    f.fill('a.md'); f.fill('b.md'); await f.rows(); f.send('oc:metadata-index-settled', { files: 3, resolvedFiles: 3 });
    await f.settle({ ...f.a, generation: 0 }); await f.settle({ ...f.a, cacheIdentity: 'ocpf1:other' }); await f.adapter.saveFacts(); expect(f.disk.files.size).toBe(0);
    f.a.verifiedComplete = false; await f.settle(f.a); await f.adapter.saveFacts(); expect(f.disk.files.size).toBe(0);
    f.a.verifiedComplete = true; f.a.generation++; await f.adapter.saveFacts(); expect(f.disk.files.size).toBe(0);
    await f.settle(f.a); expect(f.disk.writes).toBe(1); expect(await f.disk.exists(await roomDir(f.b.cacheIdentity))).toBe(false);
  } finally { f.close(); }
});
for (const replacement of ['ocpf1:replacement', undefined]) test(`live room ${replacement ? 'replacement' : 'inactivity'} retires only its own partition`, async () => {
  const f = await contractFixture(await savedContract()), old = await roomDir(f.a.cacheIdentity!);
  try {
    await f.rows(); f.a.cacheIdentity = replacement; f.send('oc:property-facts-changed', { invalidated: false });
    expect((await f.rows()).map(r => r.properties.category)).toEqual([undefined, 'Saved b.md', undefined]);
    // Queue barrier only; no manifest is loaded or purged by this check.
    await new FactCache(f.disk, directory).dropPartition('ocpf1:unused');
    expect(await f.disk.exists(old)).toBe(false); expect(await f.disk.exists(await roomDir(f.b.cacheIdentity))).toBe(true);
  } finally { f.close(); }
});
for (const during of ['chunk', 'manifest']) for (const change of ['generation', 'identity', 'verification']) test(`room save drops ${change} change during ${during} write`, async () => {
  const f = await contractFixture(), disk = f.disk, dir = await roomDir(f.a.cacheIdentity!);
  try {
    f.fill('a.md'); await f.rows();
    let moved = false; const move = () => { moved = true; if (change === 'generation') f.a.generation++; else if (change === 'identity') f.a.cacheIdentity = 'ocpf1:other'; else f.a.verifiedComplete = false; };
    if (during === 'chunk') { const write = disk.writeBinary.bind(disk); disk.writeBinary = async (p, b) => { await write(p, b); move(); }; }
    else { const write = disk.write.bind(disk); disk.write = async (p, s) => { await write(p, s); move(); }; }
    await f.settle(f.a); expect(moved).toBe(true); expect(await disk.exists(`${dir}/manifest.json`)).toBe(false); expect(f.adapter.cacheStatus).not.toBe('saved');
  } finally { f.close(); }
});

test('a generation change during load prevents adoption only for that room', async () => {
  const disk = await savedContract(), f = await contractFixture(disk), own = await roomDir(f.a.cacheIdentity!);
  const read = disk.readBinary.bind(disk);
  disk.readBinary = async path => { const bytes = await read(path); if (path.startsWith(own + '/')) f.a.generation++; return bytes; };
  try { expect((await f.rows()).map(r => r.properties.category)).toEqual([undefined, 'Saved b.md', undefined]); }
  finally { f.close(); }
});
test('a present handle with no valid identity never supplies or saves a partition', async () => {
  const f = await contractFixture(await savedContract(), 'old-format');
  try {
    expect((await f.rows()).map(r => r.properties.category)).toEqual([undefined, 'Saved b.md', undefined]);
    f.fill('a.md'); await f.rows(); const writes = f.disk.writes; await f.settle(f.a); expect(f.disk.writes).toBe(writes);
  } finally { f.close(); }
});
test('moving a path to another active mount never replays its previous owner’s row', async () => {
  const f = await contractFixture(await savedContract());
  try {
    await f.rows(); f.source.roomFor = () => f.b;
    expect((await f.rows()).map(r => r.properties.category)).toEqual([undefined, 'Saved b.md', undefined]);
  } finally { f.close(); }
});
test('sibling chunks consume the same bounded byte allowance before a partition can commit', async () => {
  const disk = new MemoryAdapter(), store = new FactCache(disk, directory), a = 'ocpf1:a', b = 'ocpf1:b';
  const row = { path: 'note.md', properties: { id: 'x' } };
  await store.save('one', [row], () => true, () => true, a);
  const other = await roomDir(a), stat = disk.stat.bind(disk);
  disk.stat = async path => path === other + '/0.bin' ? { size: 32 * 1024 * 1024 } : stat(path);
  await expect(store.save('two', [row], () => true, () => true, b)).rejects.toThrow('over limit');
  expect(await disk.exists(`${other}/manifest.json`)).toBe(true); expect(await disk.exists(`${await roomDir(b)}/manifest.json`)).toBe(false);
});

test('source, declaration, file stamps and whole-vault namespace mismatches refuse cache', async () => {
  for (const kind of ['source', 'device namespace', 'plugin version', 'producer', 'declaration', 'mtime', 'size', 'namespace']) {
    const saved = await savedFixture(), f = saved.boot(undefined, ['source', 'device namespace', 'plugin version'].includes(kind) ? `other-${kind}` : 'local');
    try {
      if (kind === 'producer') (f.adapter as any).producer = 'native@2';
      if (kind === 'declaration') f.adapter.configure({ ...f.declaration, columns: ['other'] });
      if (kind === 'mtime') Object.assign(f.files[0]!.stat, { mtime: 101 });
      if (kind === 'size') f.files[0]!.stat.size++;
      if (kind === 'namespace') { const file = new FixtureFile('outside/image.png'); file.extension = 'png'; Object.assign(file.stat, { mtime: 100 }); f.files.push(file); }
      expect((await f.rows()).every(r => Object.keys(r.properties).length === 0)).toBe(true);
      expect(f.adapter.cacheStatus).toBe('miss'); expect(f.adapter.factsComplete()).toBe(false);
      expect(saved.disk.files.size).toBe(0);
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

test('byte-aware chunks accept large declared values and count UTF-8 bytes', async () => {
  const disk = new MemoryAdapter(), store = new FactCache(disk, 'plugin/cache/startup-facts');
  const rows = Array.from({ length: 256 }, (_, i) => ({ path: `synthetic-${i}.md`, properties: { id: String(i), description: '界'.repeat(1800) } }));
  await store.save('key', rows, () => true);
  const manifest = JSON.parse(await disk.read('plugin/cache/startup-facts/manifest.json'));
  expect(manifest.parts.length).toBe(2);
  for (const part of manifest.parts) expect(part.bytes).toBeLessThanOrEqual(1024 * 1024);
  expect([...(await store.load('key', () => true))!.values()]).toEqual(rows);
  await expect(store.save('key', [{ path: 'large.md', properties: { id: 'x'.repeat(1024 * 1024) } }], () => true)).rejects.toThrow('over limit');
  expect(await disk.exists('plugin/cache/startup-facts/manifest.json')).toBe(false);
});

test('missing manifest skips namespace work and key work shares the storage deadline', async () => {
  const disk = new MemoryAdapter(), store = new FactCache(disk, 'plugin/cache/startup-facts', async () => {}, 20);
  let prepared = 0;
  expect(await store.load(async () => { prepared++; return 'key'; }, () => true)).toBeUndefined();
  expect(prepared).toBe(0);
  for (const operation of ['load', 'save'] as const) {
    await disk.write('plugin/cache/startup-facts/manifest.json', '{}');
    let release!: () => void;
    const key = async (check: () => void) => { await new Promise<void>(r => release = r); check(); return 'key'; };
    const pending = operation === 'load' ? store.load(key, () => true) : store.save(key, [], () => true);
    await expect(pending).rejects.toThrow('deadline'); release();
    await new FactCache(disk, 'plugin/cache/startup-facts').clear();
  }
  const key = async (check: () => void) => { const end = performance.now() + 25; while (performance.now() < end) {} check(); return 'key'; };
  await expect(store.save(key, [], () => true)).rejects.toThrow('deadline');
});

test('namespace preparation yields before reading the whole vault and bounds merge work', async () => {
  let reads = 0, active = true, state = 42;
  const files = Array.from({ length: 100000 }, (_, i) => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    const path = `${state.toString(16).padStart(8, '0')}/synthetic-${i}.md`;
    return { get path() { reads++; return path; }, stat: { mtime: 100, size: 10 } };
  });
  const start = performance.now(), pending = factKey(files, ['synthetic'], () => { if (!active) throw Error('cancelled'); });
  const synchronousMs = performance.now() - start;
  expect(reads).toBe(256); active = false; await expect(pending).rejects.toThrow('cancelled');
  console.log('100k namespace pre-yield', JSON.stringify({ files: files.length, collected: reads, synchronousMs, scope: 'unit runtime, not native app timing' }));
  await expect(factKey([...files, files[0]!], [], () => {})).rejects.toThrow('over limit');
  const subset = files.slice(0, 1200), ordered = subset.map(f => [f.path, f.stat.mtime, f.stat.size] as const).sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0), parts = [];
  for (let i = 0; i < ordered.length; i += 256) parts.push(await digest(ordered.slice(i, i + 256)));
  const key = await factKey(subset, [], () => {});
  expect(key).toBe(await digest({ format: 1, scope: [], parts }));
  expect(await factKey([...subset].reverse(), [], () => {})).toBe(key);
});

test('entropy failure disables optional namespace without rejecting startup', async () => {
  const { default: GraphPlugin } = await import('../src/main');
  const plugin: any = Object.create(GraphPlugin.prototype); plugin.settings = defaults('native@1');
  plugin.save = async () => { throw Error('must not save'); };
  const entropy = spyOn(crypto, 'getRandomValues').mockImplementation(() => { throw Error('Synthetic entropy unavailable'); });
  try { expect(await plugin.ensureDeviceNamespace()).toBeUndefined(); expect(plugin.deviceNamespace).toBeUndefined(); }
  finally { entropy.mockRestore(); }
});

test('checksummed deep, nonfinite and excessive-value payloads fall back and are discarded', async () => {
  const { hashBytes } = await import('../src/core/binary-layout');
  for (const value of ['['.repeat(20000) + '0' + ']'.repeat(20000), '1e999', '[' + Array(65537).fill('0').join(',') + ']']) {
    const saved = await savedFixture(), path = 'plugin/saved-facts/manifest.json';
    const manifest = JSON.parse(await saved.disk.read(path));
    const bytes = new TextEncoder().encode('[{"path":"a.md","properties":{"id":' + value + '}}]');
    await saved.disk.writeBinary('plugin/saved-facts/0.bin', bytes.buffer);
    manifest.parts = [{ bytes: bytes.length, hash: await hashBytes(bytes) }]; await saved.disk.write(path, JSON.stringify(manifest));
    const f = saved.boot();
    try {
      expect((await f.rows()).every(row => !row.properties.id)).toBe(true);
      expect(f.adapter.cacheStatus).toBe('unavailable'); expect(f.adapter.factsComplete()).toBe(false);
      await new FactCache(saved.disk, 'plugin/saved-facts').load('barrier', () => true);
      expect(await saved.disk.exists(path)).toBe(false);
    } finally { f.dispose(); }
  }
});

test('unexpected replay serialization failure resets partial worker input and retries native', async () => {
  const saved = await savedFixture(), f = saved.boot();
  const stamp = (f.adapter as any).stamp.bind(f.adapter); let failed = false;
  (f.adapter as any).stamp = (row: FactRow) => {
    if (!failed && row.path === 'b.md' && row.properties.category === 'Saved') { failed = true; throw Error('Synthetic replay serialization failure'); }
    return stamp(row);
  };
  try {
    const batches = []; for await (const b of f.adapter.columns(true, { chunkRows: 1, budgetMs: 8 })) batches.push(b);
    expect(failed).toBe(true); expect(batches.map(b => b.reset)).toEqual([true, true, false]);
    expect(batches.slice(1).flatMap(b => unpackRows(b.columns)).every(row => !row.properties.id)).toBe(true);
    expect(f.adapter.cacheStatus).toBe('unavailable'); expect(f.adapter.savedCopy).toBe(false);
    await new FactCache(saved.disk, 'plugin/saved-facts').load('barrier', () => true);
    expect(saved.disk.files.size).toBe(0);
  } finally { f.dispose(); }
});

test('module reload clear and replacement save wait for uncancellable old writes', async () => {
  for (const action of ['clear', 'save']) {
    const disk = new MemoryAdapter(), directory = 'plugin/cache/startup-facts';
    let release!: () => void, started!: () => void, active = true, finished = false;
    const held = new Promise<void>(r => release = r), waiting = new Promise<void>(r => started = r), write = disk.writeBinary.bind(disk);
    disk.writeBinary = async (path, bytes) => { started(); await held; await write(path, bytes); };
    const old = new FactCache(disk, directory), saving = old.save('old', [{ path: 'old.md', properties: { id: 'old' } }], () => active).catch(String);
    await waiting; active = false;
    const modulePath = '../src/adapter/fact-cache.ts?reload-regression';
    const reloadedModule = await import(modulePath);
    const fresh = new reloadedModule.FactCache(disk, directory);
    const next = (action === 'clear' ? fresh.clear(true) : fresh.save('new', [{ path: 'new.md', properties: { id: 'new' } }], () => true)).then(() => { finished = true; });
    await Promise.resolve(); await Promise.resolve(); expect(finished).toBe(false);
    release(); expect(await saving).toContain('cancelled'); await next;
    if (action === 'clear') expect(disk.files.size).toBe(0);
    else expect([...(await fresh.load('new', () => true))!.keys()]).toEqual(['new.md']);
  }
});

test('onload retains purge when namespace persistence fails and clear reports deletion failures', async () => {
  const { default: GraphPlugin } = await import('../src/main');
  const previousWorker = globalThis.Worker, previousSource = (globalThis as any).__LAYOUT_WORKER_SOURCE__;
  (globalThis as any).Worker = class { onmessage = null; postMessage() {} terminate() {} };
  (globalThis as any).__LAYOUT_WORKER_SOURCE__ = '';
  try {
    for (const failure of [false, true]) {
      const disk = new MemoryAdapter(), directory = 'plugin/cache/startup-facts', f = fixture();
      const cleanup: (() => void)[] = [], commands = new Map<string, () => void>(); let notifications = 0;
      await new FactCache(disk, directory).save('old', [{ path: 'a.md', properties: { id: 'plaintext' } }], () => true);
      await disk.write('plugin/data.json', JSON.stringify({ settings: defaults('obsidian-links@test') }));
      const plugin: any = new GraphPlugin(f.adapter.app, { dir: 'plugin', id: 'graph-ng', name: 'Graph NG', description: 'Synthetic test', version: '0.5.2', minAppVersion: '1.0.0', author: 'test' }); plugin.app = f.adapter.app; plugin.app.vault.adapter = disk;
      plugin.manifest = { dir: 'plugin', id: 'graph-ng', version: '0.5.2' };
      plugin.register = (fn: () => void) => cleanup.push(fn); plugin.registerEvent = plugin.registerView = plugin.addRibbonIcon = plugin.addSettingTab = plugin.watchProperties = () => {};
      plugin.addCommand = (command: any) => commands.set(command.id, command.callback);
      plugin.save = async () => { throw Error('Synthetic namespace save failure'); }; plugin.notify = () => { notifications++; };
      try {
        await plugin.onload(); expect(plugin.deviceNamespace).toBeUndefined(); expect(plugin.factStore.paused).toBe(true);
        for await (const _ of plugin.adapter.columns(true, { chunkRows: 1, budgetMs: 8 })) {}
        expect(disk.reads.some(path => path.startsWith(directory))).toBe(false);
        const clear = plugin.adapter.clearFacts.bind(plugin.adapter); let clearing!: Promise<void>;
        plugin.adapter.clearFacts = () => clearing = clear();
        if (failure) disk.rmdir = async () => { throw Error('Synthetic deletion failure'); };
        notifications = 0; commands.get('clear-saved-facts')!();
        if (failure) { await expect(clearing).rejects.toThrow('deletion failure'); expect(plugin.adapter.cacheStatus).not.toBe('cleared'); expect(notifications).toBe(0); }
        else { await clearing; expect(await disk.exists(`${directory}/manifest.json`)).toBe(false); expect(notifications).toBe(1); }
      } finally { cleanup.reverse().forEach(fn => fn()); f.dispose(); }
    }
  } finally { globalThis.Worker = previousWorker; (globalThis as any).__LAYOUT_WORKER_SOURCE__ = previousSource; }
});

test('live provider and declaration changes purge an already restored generation', async () => {
  for (const change of ['provider', 'declaration']) {
    const saved = await savedFixture(), f = saved.boot();
    try {
      await f.rows(); expect(f.adapter.savedCopy).toBe(true);
      if (change === 'provider') f.adapter.setPropertySource(derived);
      else f.adapter.configure({ ...f.declaration, columns: ['other'] });
      let existsAtNextOperation = true;
      const diskExists = saved.disk.exists.bind(saved.disk);
      saved.disk.exists = async path => { const exists = await diskExists(path); if (path.endsWith('/manifest.json')) existsAtNextOperation = exists; return exists; };
      await new FactCache(saved.disk, 'plugin/saved-facts').load('barrier', () => true);
      expect(existsAtNextOperation).toBe(false); expect(saved.disk.files.size).toBe(0); expect(f.adapter.savedCopy).toBe(false);
    } finally { f.dispose(); }
  }
});

test('mismatched generation purge is deadline bounded and deletion failures are not success', async () => {
  for (const mode of ['failure', 'deadline']) {
    const disk = new MemoryAdapter(), directory = 'plugin/cache/startup-facts';
    await new FactCache(disk, directory).save('old', [{ path: 'a.md', properties: { id: 'old' } }], () => true);
    const remove = disk.rmdir.bind(disk); let release!: () => void;
    disk.rmdir = async path => { if (mode === 'failure') throw Error('Synthetic purge failure'); await new Promise<void>(r => release = r); await remove(path); };
    const store = new FactCache(disk, directory, async () => {}, 20);
    await expect(store.load('new', () => true)).rejects.toThrow(mode === 'failure' ? 'purge failure' : 'deadline');
    expect(disk.reads.some(path => path.endsWith('.bin'))).toBe(false);
    disk.rmdir = remove; if (mode === 'deadline') release();
    await new FactCache(disk, directory).clear(); expect(disk.files.size).toBe(0);
  }
});

test('concurrent purges are independent across vault adapters and cache directories', async () => {
  for (const sameAdapter of [false, true]) {
    const a = new MemoryAdapter(), b = sameAdapter ? a : new MemoryAdapter();
    const aDir = 'plugin/cache/startup-facts', bDir = sameAdapter ? 'other/cache/startup-facts' : aDir;
    const A = new FactCache(a, aDir), B = new FactCache(b, bDir);
    await A.save('a', [{ path: 'a.md', properties: { id: 'a' } }], () => true);
    await B.save('b', [{ path: 'b.md', properties: { id: 'b' } }], () => true);
    await Promise.all([A.clear(), B.clear()]);
    expect(await a.exists(`${aDir}/0.bin`)).toBe(false); expect(await b.exists(`${bDir}/0.bin`)).toBe(false);
    expect(a.files.size).toBe(0); expect(b.files.size).toBe(0);
  }
});

test('uncancellable IO in one storage target does not block another target purge', async () => {
  for (const sameAdapter of [false, true]) {
    const a = new MemoryAdapter(), b = sameAdapter ? a : new MemoryAdapter();
    const aDir = 'plugin/cache/startup-facts', bDir = sameAdapter ? 'other/cache/startup-facts' : aDir;
    const A = new FactCache(a, aDir), B = new FactCache(b, bDir, async () => {}, 100);
    await B.save('b', [{ path: 'b.md', properties: { id: 'plaintext' } }], () => true);
    let started!: () => void, release!: () => void;
    const waiting = new Promise<void>(r => started = r), held = new Promise<void>(r => release = r), exists = a.exists.bind(a);
    a.exists = async path => { if (path.startsWith(aDir + '/')) { started(); await held; } return exists(path); };
    const loading = A.load('a', () => true); await waiting;
    try { await B.clear(); expect(b.files.size).toBe(0); }
    finally { release(); await loading; }
  }
});

test('value-aware chunks roundtrip moderate arrays that exceed one chunk value budget', async () => {
  const disk = new MemoryAdapter(), directory = 'plugin/cache/startup-facts', store = new FactCache(disk, directory);
  const rows = Array.from({ length: 256 }, (_, i) => ({ path: `synthetic-${i}.md`, properties: { id: String(i), values: Array.from({ length: 260 }, (_, j) => j) } }));
  await store.save('key', rows, () => true);
  const manifest = JSON.parse(await disk.read(`${directory}/manifest.json`)); expect(manifest.parts.length).toBe(2);
  for (let i = 0; i < manifest.parts.length; i++) {
    const batch = JSON.parse(new TextDecoder().decode(await disk.readBinary(`${directory}/${i}.bin`)));
    expect(batch.length).toBeLessThanOrEqual(256); expect(manifest.parts[i].bytes).toBeLessThanOrEqual(1024 * 1024);
    const pending: unknown[] = [batch]; let count = 0;
    while (pending.length) { const value = pending.pop(); if (value && typeof value === 'object') { const children = Object.values(value); count += children.length; pending.push(...children); } }
    expect(count).toBeLessThanOrEqual(65536);
  }
  expect([...(await store.load('key', () => true))!.values()]).toEqual(rows);
});

test('save and replay agree at exact child-value and depth boundaries', async () => {
  const disk = new MemoryAdapter(), directory = 'plugin/cache/startup-facts', store = new FactCache(disk, directory);
  const row = { path: 'boundary.md', properties: { id: 'boundary', values: Array(65531).fill(0) } };
  await store.save('key', [row], () => true); expect((await store.load('key', () => true))!.get(row.path)).toEqual(row);
  row.properties.values.push(0);
  await expect(store.save('key', [row], () => true)).rejects.toThrow('over limit'); expect(await disk.exists(`${directory}/manifest.json`)).toBe(false);
  let value: unknown = 0; for (let i = 0; i < 61; i++) value = [value];
  await store.save('depth', [{ path: 'depth.md', properties: { id: value } }], () => true);
  expect((await store.load('depth', () => true))!.size).toBe(1);
  await expect(store.save('depth', [{ path: 'depth.md', properties: { id: [value] } }], () => true)).rejects.toThrow('over limit');
  expect(await disk.exists(`${directory}/manifest.json`)).toBe(false);
});

test('save rejects nonfinite and cyclic rows before committing a manifest', async () => {
  const disk = new MemoryAdapter(), directory = 'plugin/cache/startup-facts', store = new FactCache(disk, directory);
  const cycle: unknown[] = []; cycle.push(cycle);
  for (const value of [NaN, Infinity, -Infinity, cycle, Array(65537).fill(0)]) {
    await expect(store.save('key', [{ path: 'invalid.md', properties: { id: value } }], () => true)).rejects.toThrow('over limit');
    expect(await disk.exists(`${directory}/manifest.json`)).toBe(false);
  }
});

test('value batching counts sparse arrays as their persisted null entries', async () => {
  const disk = new MemoryAdapter(), directory = 'plugin/cache/startup-facts', store = new FactCache(disk, directory);
  const rows = ['a.md', 'b.md'].map(path => ({ path, properties: { id: path, values: new Array(40000) } }));
  await store.save('key', rows, () => true);
  expect(JSON.parse(await disk.read(`${directory}/manifest.json`)).parts.length).toBe(2);
  expect([...(await store.load('key', () => true))!.values()]).toEqual(JSON.parse(JSON.stringify(rows)));
});
