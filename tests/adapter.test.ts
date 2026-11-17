import { test, expect } from 'bun:test';
import { FixtureFile } from './support/obsidian-fixture';
import type { App, Plugin } from 'obsidian';
import { IncrementalIndex } from '../src/adapter/index';
import type { FactRow } from '../src/core/projection';
import type { PropertySource } from '../src/adapter/local';
import { defaultDeclaration } from '../src/core/declaration';
import { unpackRows } from '../src/core/columns';
import { buildProjection } from '../src/core/projection';
import { contractGroups } from '../src/core/group-projection';
import { explore, emptyView } from '../src/core/explore';

async function propertyFixture(source?: PropertySource, edges = false, onChange = () => {}, count = 2, debounceMs = 1) {
  const { LocalAdapter } = await import('../src/adapter/local');
  const files = Array.from({ length: count }, (_, i) => new FixtureFile(['a.md', 'b.md'][i] ?? `note-${i}.md`));
  const caches = new Map<string, any>(), links: Record<string, Record<string, number>> = {};
  const events = new Map<string, (...args: any[]) => any>();
  const declaration = { ...defaultDeclaration('native@1'), columns: ['id', 'category'], identity: [{ key: 'id' }], groups: [{ from: 'key' as const, key: 'category' }], ...(edges ? {} : { edges: [] }) };
  const app = { vault: { getMarkdownFiles: () => files, getAbstractFileByPath: (p: string) => files.find(f => f.path === p), on() {}, read() { throw new Error('body read forbidden'); } },
    metadataCache: { getFileCache: (f: FixtureFile) => caches.get(f.path) ?? null, resolvedLinks: links, on: (name: string, fn: (...args: any[]) => void) => events.set(name, fn) } } as unknown as App;
  const cleanup: (() => void)[] = [];
  const adapter = new LocalAdapter(app, { register(fn: () => void) { cleanup.push(fn); }, registerEvent() {} } as unknown as Plugin, 'native@1', debounceMs, onChange, true, declaration, source);
  const rows = async (reset = true) => { const all: FactRow[] = []; for await (const b of adapter.columns(reset, { chunkRows: 1, budgetMs: 8 })) all.push(...unpackRows(b.columns)); return all; };
  return { adapter, rows, files, caches, links, events, declaration, dispose: () => cleanup.forEach(fn => fn()) };
}
const fact = (id: string, extra = {}) => ({ source: 'derived', state: 'current', verified: false, frontmatter: { id, category: 'Category A' }, ...extra });

test('current property facts form declared groups with empty native metadata and no body reads', async () => {
  const f = await propertyFixture({ get: p => fact(p) }, true), original = JSON.stringify(f.declaration);
  try {
    const rows = await f.rows(), projection = buildProjection(rows, f.declaration);
    const groups = contractGroups(projection, new Uint8Array(projection.paths.length).fill(1), 0).projection;
    expect(groups.groups.map(g => [g.label, g.count])).toEqual([['Category A', 2]]);
    expect(projection.source.length).toBe(0); expect(f.adapter.coverage()).toEqual({ indexed: 2, listed: 2 });
    expect(f.adapter.factsComplete()).toBe(false); expect(f.adapter.linksPending()).toBe(true);
    f.events.get('resolved')!(); expect(f.adapter.linksResolved).toBe(false);
    expect(JSON.stringify(f.declaration)).toBe(original);
    const filtered = explore(projection, f.declaration, { ...emptyView(), filters: [{ kind: 'eq', key: 'id', value: 'a.md' }], group: { from: 'key', key: 'id' } }, new Uint32Array(projection.paths.length), 0, { facetValues: 10 });
    expect(filtered.visible.reduce((n, b) => n + b, 0)).toBe(1); expect(filtered.groupKeys).toContain(JSON.stringify('a.md'));
  } finally { f.adapter.index.dispose(); }
});

test('empty/absent YAML is valid; parse errors, truncation and absent facts use available native fallback only', async () => {
  for (const value of [fact('a', { frontmatter: {} }), fact('a', { frontmatter: undefined }), fact('a', { parseError: 'yaml_syntax' }), fact('a', { truncated: { droppedKeys: 1 } }), undefined]) {
    const usable = value !== undefined && !(value as any).parseError && !(value as any).truncated;
    const f = await propertyFixture({ get: () => value });
    try {
      expect((await f.rows())[0]!.properties).toEqual({});
      expect(f.adapter.coverage().indexed).toBe(usable ? 2 : 0); expect(f.adapter.factsComplete()).toBe(false);
      f.caches.set('a.md', { frontmatter: { id: 'native-a' } }); f.caches.set('b.md', { frontmatter: { id: 'native-b' } });
      const rows = await f.rows();
      expect(rows[0]!.properties).toEqual(usable ? {} : { id: 'native-a' });
      expect(f.adapter.factsComplete()).toBe(!usable);
    } finally { f.adapter.index.dispose(); }
  }
});

test('resolved bursts share one audit and visit only maintained unresolved paths', async () => {
  const reads: string[] = []; let during: (() => void) | undefined;
  const f = await propertyFixture({ get: p => { reads.push(p); const next = during; during = undefined; next?.(); return fact(p, { verified: p !== 'a.md' }); } }, false, () => {}, 260);
  try {
    await f.rows(); expect(f.adapter.pendingProperties()).toBe(1); reads.length = 0;
    const scan = f.events.get('resolved')!();
    for (let i = 0; i < 50; i++) expect(f.events.get('resolved')!()).toBe(scan);
    during = () => { for (let i = 0; i < 50; i++) expect(f.events.get('resolved')!()).toBe(scan); };
    await scan; f.adapter.index.flush();
    expect(reads).toEqual(['a.md', 'a.md']); expect(f.adapter.pendingProperties()).toBe(1);
    const stale = f.adapter.verifyProperties({ chunkRows: 1, budgetMs: 8 });
    f.adapter.invalidate(); expect(await stale).toBe(false);
  } finally { f.adapter.index.dispose(); }
});

test('native audit passes yield a debounce interval, while explicit verification and disposal wake them', async () => {
  let during: (() => void) | undefined;
  const reads: number[] = [];
  const f = await propertyFixture({ get: p => { reads.push(performance.now()); const next = during; during = undefined; next?.(); return fact(p); } }, false, () => {}, 2, 25);
  try {
    await f.rows(); reads.length = 0;
    const start = performance.now(), scan = f.events.get('resolved')!();
    await Promise.resolve(); expect(reads).toEqual([]);
    during = () => { expect(f.events.get('resolved')!()).toBe(scan); };
    await scan;
    expect(reads.length).toBe(4);
    expect(reads[0]! - start).toBeGreaterThanOrEqual(20);
    expect(reads[2]! - reads[1]!).toBeGreaterThanOrEqual(20);
    reads.length = 0;
    const waiting = f.events.get('resolved')!(); await Promise.resolve();
    expect(reads).toEqual([]);
    expect(f.adapter.verifyProperties({ chunkRows: 2, budgetMs: 8 })).toBe(waiting);
    await waiting; expect(reads.length).toBe(2);
    const disposed = f.events.get('resolved')!(); await Promise.resolve();
    f.dispose(); expect(await disposed).toBe(false); expect(reads.length).toBe(2);
  } finally { f.dispose(); }
});

test('late-cache resolver bursts cost a small multiple of rows, not rows times events', async () => {
  const count = 260, f = await propertyFixture(undefined, false, () => {}, count, 25);
  let reads = 0;
  const native = f.adapter.app.metadataCache.getFileCache;
  f.adapter.app.metadataCache.getFileCache = file => { reads++; return native(file); };
  try {
    await f.rows(); reads = 0;
    const scans = [];
    for (const file of f.files) {
      f.caches.set(file.path, { frontmatter: { id: file.path } });
      f.events.get('changed')!(file);
      for (let i = 0; i < 4; i++) scans.push(f.events.get('resolved')!());
    }
    expect(new Set(scans).size).toBe(1);
    await scans[0];
    const queuedReads = reads;
    for (let i = 0; i < 100; i++) scans.push(f.events.get('resolved')!());
    await scans.at(-1);
    // One debounced index flush may read the queued rows, but another audit
    // must not stamp or enqueue the same pending worker updates again.
    expect(reads - queuedReads).toBeLessThanOrEqual(count);
    f.adapter.index.flush();
    expect((await f.rows(false)).length).toBe(count);
    expect(f.adapter.pendingProperties()).toBe(0);
    expect(reads).toBeLessThanOrEqual(count * 4);
    const completedReads = reads;
    for (let i = 0; i < 100; i++) scans.push(f.events.get('resolved')!());
    await scans.at(-1); f.adapter.index.flush();
    expect(reads).toBe(completedReads);
  } finally { f.dispose(); }
});

test('resolver audits leave queued native changes to their existing ingestion batch', async () => {
  const count = 260, f = await propertyFixture(undefined, false, () => {}, count, 5000);
  try {
    await f.rows();
    let reads = 0, changes = 0;
    const read = (f.adapter as any).read.bind(f.adapter), change = f.adapter.index.change.bind(f.adapter.index);
    (f.adapter as any).read = (path: string) => { reads++; return read(path); };
    f.adapter.index.change = path => { changes++; change(path); };
    for (const file of f.files) {
      f.caches.set(file.path, { frontmatter: { id: file.path } });
      f.events.get('changed')!(file);
    }
    const scan = f.events.get('resolved')!();
    for (let i = 0; i < 100; i++) expect(f.events.get('resolved')!()).toBe(scan);
    await scan;
    // The native event already owns the debounce slot. An audit must neither
    // duplicate its row read/stamp nor reschedule that same pending update.
    expect(reads).toBe(0); expect(changes).toBe(count);
    expect(f.adapter.pendingProperties()).toBe(count);
    f.adapter.index.flush();
    expect((await f.rows(false)).length).toBe(count);
    expect(reads).toBe(count * 2); expect(f.adapter.pendingProperties()).toBe(0);
    expect(f.adapter.factsComplete()).toBe(true);
  } finally { f.dispose(); }
});

test('native resolver audits do not construct rows for caches that are still missing', async () => {
  const f = await propertyFixture(undefined, false, () => {}, 260, 25);
  try {
    await f.rows();
    const paths: string[] = [], original = (f.adapter as any).read.bind(f.adapter);
    (f.adapter as any).read = (path: string) => { paths.push(path); return original(path); };
    const scan = f.events.get('resolved')!();
    for (let i = 0; i < 100; i++) f.events.get('resolved')!();
    await scan; expect(paths).toEqual([]);
    f.caches.set('a.md', { frontmatter: {} });
    await f.events.get('resolved')!(); f.adapter.index.flush(); await f.rows(false);
    expect(paths).toEqual(['a.md', 'a.md', 'a.md']);
    expect(f.adapter.pendingProperties()).toBe(259);
    paths.length = 0;
    await f.events.get('resolved')!(); expect(paths).toEqual([]);
  } finally { f.dispose(); }
});

test('unverified derived facts stay provisional even when native metadata exists, then promote on verification', async () => {
  let verified = false;
  const f = await propertyFixture({ get: p => fact(p, { verified }) });
  try {
    f.caches.set('a.md', { frontmatter: {} }); f.caches.set('b.md', { frontmatter: {} });
    await f.rows();
    await f.events.get('resolved')!(); f.adapter.index.flush();
    expect(f.adapter.pendingProperties()).toBe(2); expect(f.adapter.factsComplete()).toBe(false);
    expect(await f.rows(false)).toEqual([]);
    verified = true;
    await f.adapter.verifyProperties({ chunkRows: 1, budgetMs: 8 });
    expect(f.adapter.pendingProperties()).toBe(0); expect(f.adapter.factsComplete()).toBe(true);
  } finally { f.adapter.index.dispose(); }
});

test('resolved or verification events recover never-indexed properties through ingestion, not coverage promotion', async () => {
  for (const resolved of [true, false]) {
    let notifications = 0;
    const f = await propertyFixture(undefined, false, () => notifications++);
    try {
      await f.rows(); expect(f.adapter.coverage().indexed).toBe(0);
      await f.events.get('resolved')!(); f.adapter.index.flush();
      expect(f.adapter.pendingProperties()).toBe(2); expect(notifications).toBe(0);
      f.caches.set('a.md', { frontmatter: { id: 'later-a' } });
      if (resolved) await f.events.get('resolved')!();
      else await f.adapter.verifyProperties({ chunkRows: 1, budgetMs: 8 });
      expect(f.adapter.pendingProperties()).toBe(2);
      f.adapter.index.flush(); expect(notifications).toBe(1);
      const rows = await f.rows(false);
      expect(rows.map(r => [r.path, r.properties.id])).toEqual([['a.md', 'later-a']]);
      expect(f.adapter.pendingProperties()).toBe(1);
      f.caches.set('b.md', { frontmatter: { id: 'later-b' } });
      f.events.get('changed')!(f.files[1]); f.adapter.index.flush(); await f.rows(false);
      expect(f.adapter.pendingProperties()).toBe(0); expect(f.adapter.factsComplete()).toBe(true);
    } finally { f.adapter.index.dispose(); }
  }
});

test('a cache appearing after an unchanged audit is ingested within one changed or resolved cycle', async () => {
  for (const event of ['changed', 'resolved']) for (const frontmatter of [{}, { id: 'late-a' }]) {
    let notifications = 0;
    const f = await propertyFixture(undefined, false, () => notifications++);
    try {
      await f.rows();
      // A no-cache event is equal to the acknowledged provisional row. It must
      // not discard the path from future verification, including empty YAML.
      f.events.get('changed')!(f.files[0]); f.adapter.index.flush();
      await f.events.get('resolved')!(); f.adapter.index.flush();
      expect(notifications).toBe(0); expect(f.adapter.pendingProperties()).toBe(2);
      f.caches.set('a.md', { frontmatter });
      if (event === 'changed') f.events.get(event)!(f.files[0]);
      else await f.events.get(event)!();
      f.adapter.index.flush(); expect(notifications).toBe(1);
      expect((await f.rows(false)).map(r => [r.path, r.properties])).toEqual([['a.md', frontmatter]]);
      expect(f.adapter.coverage()).toEqual({ indexed: 1, listed: 2 });
      expect(f.adapter.pendingProperties()).toBe(1);
      expect(await f.rows(false)).toEqual([]);
      await f.events.get('resolved')!(); f.adapter.index.flush();
      expect(f.adapter.pendingProperties()).toBe(1); expect(notifications).toBe(1);
    } finally { f.adapter.index.dispose(); }
  }
});

test('property verification cannot complete a declared native-edge graph; native readiness later upgrades it', async () => {
  const f = await propertyFixture({ get: p => fact(p, { verified: true }) }, true);
  try {
    const held = new Map((await f.rows()).map(row => [row.path, row])); expect(f.adapter.factsComplete()).toBe(false);
    f.links['a.md'] = { 'b.md': 1 }; f.links['b.md'] = {};
    f.events.get('resolve')!(f.files[0]); f.events.get('resolve')!(f.files[1]); f.adapter.index.flush();
    for (const row of await f.rows(false)) held.set(row.path, row);
    const p = buildProjection([...held.values()], f.declaration);
    expect(p.source.length).toBe(1); expect(f.adapter.linksPending()).toBe(false); expect(f.adapter.factsComplete()).toBe(true);
  } finally { f.adapter.index.dispose(); }
});

test('source replacement/drop rejects suspended batches and reacquires rows without keeping a fact cache', async () => {
  const f = await propertyFixture({ get: p => fact(p) });
  try {
    const old = f.adapter.columns(true, { chunkRows: 1, budgetMs: 8 }); await old.next();
    f.adapter.setPropertySource({ get: () => undefined });
    await expect(old.next()).rejects.toThrow('Property source changed');
    expect(f.adapter.coverage().indexed).toBe(0); expect(f.adapter.factsComplete()).toBe(false);
    await f.rows(false); expect(f.adapter.coverage().indexed).toBe(0);
    f.adapter.setPropertySource({ get: p => fact(p, { verified: true }) });
    await f.rows(false); expect(f.adapter.factsComplete()).toBe(true);
  } finally { f.adapter.index.dispose(); }
});
test('debounced file changes, rename and delete patch only changed rows', () => {
  const rows = new Map<string, FactRow>([['a.md', { path: 'a.md', properties: { id: 'a' } }]]), events: Set<string>[] = [];
  let reads = 0; const index = new IncrementalIndex(path => { reads++; return rows.get(path); }, paths => events.push(paths), 5000);
  index.seed(['a.md']); rows.set('b.md', { path: 'b.md', properties: {} }); index.change('b.md'); index.change('b.md');
  expect(events.length).toBe(0); index.flush(); expect([...events[0]!]).toEqual(['b.md']); expect(index.snapshot().length).toBe(2); expect(reads).toBe(2);
  rows.set('c.md', { path: 'c.md', properties: {} }); rows.delete('b.md'); index.rename('b.md', 'c.md'); index.remove('a.md'); index.flush();
  expect(index.snapshot().map(r => r.path)).toEqual(['c.md']); expect([...events[1]!]).toEqual(['b.md', 'c.md', 'a.md']); index.dispose();
});
test('startup snapshots reseed once metadata becomes complete before its debounced event', async () => {
  const { LocalAdapter } = await import('../src/adapter/local');
  const files = [new FixtureFile('a.md'), new FixtureFile('b.md')];
  const caches = new Map<string, { frontmatter: Record<string, unknown> }>();
  const app = { vault: { getMarkdownFiles: () => files, getAbstractFileByPath: (path: string) => files.find(f => f.path === path), on: () => ({}) },
    metadataCache: { getFileCache: (file: FixtureFile) => caches.get(file.path) ?? null, resolvedLinks: {}, on: () => ({}) } } as unknown as App;
  const plugin = { registerEvent: () => {}, register: () => {} } as unknown as Plugin;
  const adapter = new LocalAdapter(app, plugin, 'source@1', 5000, () => {});
  expect(adapter.index.snapshot()[0]!.properties).toEqual({});
  caches.set('a.md', { frontmatter: { id: 'alpha' } }); caches.set('b.md', { frontmatter: { id: 'beta' } });
  expect(adapter.snapshot().map(r => r.properties.id)).toEqual(['alpha', 'beta']);
  expect(adapter.coverage()).toEqual({ indexed: 2, listed: 2 });
  caches.set('a.md', { frontmatter: { id: 'changed-but-no-event' } });
  expect(adapter.snapshot()[0]!.properties.id).toBe('alpha'); // Later updates remain event-driven, not full rescans.
  adapter.index.dispose();
});
test('B2 folder rename/modify/delete/resolved bursts read only k affected notes once', async () => {
  const { LocalAdapter } = await import('../src/adapter/local');
  const k = 7, files = Array.from({ length: 1000 }, (_, i) => new FixtureFile(`${i < k ? 'from' : 'other'}/${i}.md`));
  const byPath = new Map(files.map(file => [file.path, file])), vaultEvents = new Map<string, (...args: any[]) => void>(), cacheEvents = new Map<string, (...args: any[]) => void>();
  let reads = 0, listings = 0, emits = 0;
  const app = { vault: { getMarkdownFiles: () => { listings++; return [...byPath.values()]; }, getAbstractFileByPath: (path: string) => byPath.get(path), on: (name: string, fn: (...args: any[]) => void) => vaultEvents.set(name, fn) },
    metadataCache: { getFileCache: (file: FixtureFile) => { reads++; return { frontmatter: { id: file.path } }; }, resolvedLinks: Object.fromEntries(files.map(file => [file.path, {}])), on: (name: string, fn: (...args: any[]) => void) => cacheEvents.set(name, fn) } } as unknown as App;
  const plugin = { registerEvent: () => {}, register: () => {} } as unknown as Plugin;
  const adapter = new LocalAdapter(app, plugin, 'source@1', 37, () => { emits++; });
  expect(adapter.index.debounceMs).toBe(37); reads = 0; listings = 0;
  const moved = files.slice(0, k);
  for (const file of moved) { byPath.delete(file.path); file.path = file.path.replace('from/', 'to/'); byPath.set(file.path, file); }
  const folder = { path: 'to', children: moved };
  vaultEvents.get('rename')!(folder, 'from'); vaultEvents.get('rename')!(folder, 'from');
  for (const file of moved) { vaultEvents.get('rename')!(file, file.path.replace('to/', 'from/')); cacheEvents.get('resolve')!(file); }
  cacheEvents.get('resolved')!(); expect(reads).toBe(0); adapter.index.flush();
  expect(reads).toBe(k); expect(listings).toBe(0); expect(emits).toBe(1);
  expect(adapter.snapshot().filter(row => row.path.startsWith('to/'))).toHaveLength(k);
  expect(adapter.coverage()).toEqual({ indexed: 1000, listed: 1000 });
  reads = 0; const untouched = files[k]!;
  vaultEvents.get('modify')!(untouched); vaultEvents.get('modify')!(untouched); cacheEvents.get('changed')!(untouched);
  expect(adapter.linksResolved).toBe(false); cacheEvents.get('resolve')!(untouched); cacheEvents.get('resolved')!(); adapter.index.flush();
  expect(adapter.linksResolved).toBe(true); expect(reads).toBe(1); expect(listings).toBe(0);
  reads = 0; vaultEvents.get('delete')!(folder); for (const file of moved) byPath.delete(file.path);
  cacheEvents.get('resolved')!(); adapter.index.flush(); expect(reads).toBe(0); expect(listings).toBe(0);
  expect(adapter.coverage()).toEqual({ indexed: 1000 - k, listed: 1000 - k });
  const old = untouched.path; byPath.delete(old); untouched.path = old.replace(/\.md$/, '.txt'); untouched.extension = 'txt'; byPath.set(untouched.path, untouched);
  vaultEvents.get('rename')!(untouched, old); adapter.index.flush();
  expect(reads).toBe(0); expect(adapter.snapshot().some(row => row.path === old)).toBe(false);
  expect(adapter.coverage()).toEqual({ indexed: 999 - k, listed: 999 - k });
  const text = untouched.path; byPath.delete(text); untouched.path = old; untouched.extension = 'md'; byPath.set(old, untouched);
  vaultEvents.get('rename')!(untouched, text); adapter.index.flush();
  expect(reads).toBe(1); expect(listings).toBe(0); expect(adapter.coverage()).toEqual({ indexed: 1000 - k, listed: 1000 - k }); adapter.index.dispose();
});
test('streaming runtime reads only declared properties and repeated resolved events cannot imply readiness', async () => {
  const { LocalAdapter } = await import('../src/adapter/local'); const { defaultDeclaration } = await import('../src/core/declaration'); const { unpackRows } = await import('../src/core/columns');
  const files = [new FixtureFile('a.md'), new FixtureFile('b.md')], events = new Map<string, (...args: any[]) => void>();
  const caches = new Map<string, any>([['a.md', { frontmatter: { id: 'a', private_unused: 'not copied' } }]]);
  const app = { vault: { getMarkdownFiles: () => files, getAbstractFileByPath: (path: string) => files.find(f => f.path === path), on: () => ({}) }, metadataCache: { getFileCache: (file: FixtureFile) => caches.get(file.path) ?? null, resolvedLinks: {}, on: (name: string, fn: (...args: any[]) => void) => events.set(name, fn) } } as unknown as App;
  const declaration = { ...defaultDeclaration('p@1'), identity: [{ key: 'id' }] }, plugin = { registerEvent() {}, register() {} } as unknown as Plugin;
  const adapter = new LocalAdapter(app, plugin, 'p@1', 10, () => {}, true, declaration);
  expect(adapter.index.snapshot()).toEqual([]); events.get('resolved')!(); events.get('resolved')!(); expect(adapter.linksResolved).toBe(false);
  const rows: FactRow[] = []; for await (const b of adapter.columns(true, { chunkRows: 1, budgetMs: 8 })) rows.push(...unpackRows(b.columns));
  expect(rows[0]?.properties).toEqual({ id: 'a' }); expect(adapter.coverage()).toEqual({ indexed: 1, listed: 2 }); expect(adapter.index.snapshot()).toEqual([]);
  caches.set('b.md', { frontmatter: { id: 'b', private_unused: 'also not copied' } });
  for await (const _ of adapter.columns(true, { chunkRows: 1, budgetMs: 8 })) { /* count progressively */ }
  expect(adapter.coverage()).toEqual({ indexed: 2, listed: 2 }); events.get('resolved')!(); expect(adapter.linksResolved).toBe(true); adapter.index.dispose();
});
test('cancelled streaming batches remain pending, invalidate coverage, and force a full reload', async () => {
  const { LocalAdapter } = await import('../src/adapter/local'); const { defaultDeclaration } = await import('../src/core/declaration'); const { unpackRows } = await import('../src/core/columns');
  const files = ['a.md', 'b.md', 'c.md'].map(path => new FixtureFile(path)), events = new Map<string, (...args: any[]) => void>();
  const values = new Map(files.map(f => [f.path, f.path]));
  const app = { vault: { getMarkdownFiles: () => files, getAbstractFileByPath: (path: string) => files.find(f => f.path === path), on: () => ({}) }, metadataCache: { getFileCache: (file: FixtureFile) => ({ frontmatter: { id: values.get(file.path) } }), resolvedLinks: Object.fromEntries(files.map(f => [f.path, {}])), on: (name: string, fn: (...args: any[]) => void) => events.set(name, fn) } } as unknown as App;
  const adapter = new LocalAdapter(app, { registerEvent() {}, register() {} } as unknown as Plugin, 'p@1', 10, () => {}, true, { ...defaultDeclaration('p@1'), identity: [{ key: 'id' }] });
  for await (const _ of adapter.columns(true, { chunkRows: 1, budgetMs: 8 })) {}
  expect(adapter.coverage()).toEqual({ indexed: 3, listed: 3 });
  values.set('a.md', 'changed-a'); values.set('b.md', 'changed-b'); events.get('changed')!(files[0]); events.get('changed')!(files[1]); adapter.index.flush();
  const cancelled = adapter.columns(false, { chunkRows: 1, budgetMs: 8 }); expect((await cancelled.next()).value?.reset).toBe(false);
  await cancelled.return(undefined); expect(adapter.coverage()).toEqual({ indexed: 0, listed: 3 }); expect(adapter.linksResolved).toBe(false);
  const rows: FactRow[] = []; let reset = false;
  for await (const batch of adapter.columns(false, { chunkRows: 1, budgetMs: 8 })) { reset ||= batch.reset; rows.push(...unpackRows(batch.columns)); }
  expect(reset).toBe(true); expect(rows.map(r => r.properties.id)).toEqual(['changed-a', 'changed-b', 'c.md']); expect(adapter.coverage()).toEqual({ indexed: 3, listed: 3 });
  // Even a reversion to the last acknowledged value must survive an in-flight newer batch.
  values.set('a.md', 'first'); events.get('changed')!(files[0]); adapter.index.flush();
  const active = adapter.columns(false, { chunkRows: 1, budgetMs: 8 }); await active.next();
  values.set('a.md', 'changed-a'); events.get('changed')!(files[0]); adapter.index.flush();
  while (!(await active.next()).done) {}
  const next: FactRow[] = []; for await (const b of adapter.columns(false, { chunkRows: 1, budgetMs: 8 })) next.push(...unpackRows(b.columns));
  expect(next.map(r => r.properties.id)).toEqual(['changed-a']); adapter.index.dispose();
});

test('property-only streaming declarations never extract unused producer targets', async () => {
  const { LocalAdapter } = await import('../src/adapter/local');
  const { defaultDeclaration } = await import('../src/core/declaration');
  const files = [new FixtureFile('a.md')], resolved = Object.create(null);
  Object.defineProperty(resolved, 'a.md', { enumerable: true, get() { throw new Error('unused link extraction'); } });
  const app = { vault: { getMarkdownFiles: () => files, getAbstractFileByPath: () => files[0], on() {} }, metadataCache: { resolvedLinks: resolved, getFileCache: () => ({ frontmatter: { id: 'a' } }), on() {} } } as unknown as App;
  const plugin = { registerEvent() {}, register() {} } as unknown as Plugin;
  const adapter = new LocalAdapter(app, plugin, 'fixture@1', 1, () => {}, true, { ...defaultDeclaration('fixture@1'), edges: [] });
  try { let count = 0; for await (const batch of adapter.columns(true, { chunkRows: 1, budgetMs: 1 })) { count++; expect(batch.columns.producers).toEqual([]); } expect(count).toBe(1); }
  finally { adapter.index.dispose(); }
});

test('declared excluded folders never enter rows, coverage or identity, so archive copies cannot quarantine live notes', async () => {
  const { LocalAdapter } = await import('../src/adapter/local');
  const files = ['live/a.md', '_archive/old/a.md', '_archived.md'].map(p => new FixtureFile(p));
  const ids: Record<string, string> = { 'live/a.md': 'x:1', '_archive/old/a.md': 'x:1', '_archived.md': 'x:2' };
  const app = { vault: { getMarkdownFiles: () => files, getAbstractFileByPath: (p: string) => files.find(f => f.path === p), on() {}, read() { throw new Error('body read forbidden'); } },
    metadataCache: { getFileCache: (f: FixtureFile) => ({ frontmatter: { curie: ids[f.path] } }), resolvedLinks: {}, on() {} } } as unknown as App;
  const base = { ...defaultDeclaration('n@1'), identity: [{ key: 'curie' }], columns: ['curie'], edges: [] };
  const adapter = new LocalAdapter(app, { register() {}, registerEvent() {} } as unknown as Plugin, 'n@1', 1, () => {}, true, base);
  const rows = async () => { const all: FactRow[] = []; for await (const b of adapter.columns(true, { chunkRows: 8, budgetMs: 8 })) all.push(...unpackRows(b.columns)); return all; };
  try {
    expect(buildProjection(await rows(), base).quarantined.length).toBe(2);
    const excluding = { ...base, exclude: [['_archive']] }; adapter.configure(excluding);
    const kept = await rows(), p = buildProjection(kept, excluding);
    expect(kept.map(r => r.path).sort()).toEqual(['_archived.md', 'live/a.md']); expect(p.quarantined).toEqual([]); expect(adapter.coverage()).toEqual({ indexed: 2, listed: 2 });
  } finally { adapter.index.dispose(); }
});

test('relationship accounting splits drawn, missing-endpoint and duplicate-ID drops (endpoint or relationship note) per rule', () => {
  const d = { ...defaultDeclaration('n@1'), identity: [{ key: 'curie' }], columns: ['curie'], edges: [{ name: 'crosswalk', kind: 'reified' as const, sourceProperty: 's', targetProperty: 'o' }] };
  const row = (path: string, properties: Record<string, unknown>) => ({ path, properties, links: {} });
  const p = buildProjection([
    row('a.md', { curie: 'x:a' }), row('b.md', { curie: 'x:b' }), row('d1.md', { curie: 'x:d' }), row('d2.md', { curie: 'x:d' }),
    row('m1.md', { curie: 'm:1', s: 'x:a', o: 'x:b' }), row('m2.md', { curie: 'm:2', s: 'x:a', o: 'x:zz' }), row('m3.md', { curie: 'm:3', s: 'x:a', o: 'x:d' }),
    row('m4.md', { curie: 'm:4', s: 'x:b', o: 'x:a' }), row('_old/m4.md', { curie: 'm:4', s: 'x:b', o: 'x:a' }),
  ], d);
  expect(p.dropped!.crosswalk).toEqual({ drawn: 1, missing: 1, excluded: 3, lines: 0 }); // each duplicate relationship note loses its one relationship
  expect(p.unresolved).toBe(2); expect(p.source.length).toBe(1);
});

test('duplicate-ID sources count their lost inline and producer relationships as excluded, once each', () => {
  const d = { ...defaultDeclaration('n@1'), identity: [{ key: 'curie' }], columns: ['curie'], edges: [{ name: 'see', kind: 'inline' as const, key: 'see', type: 'see' }, { name: 'links', kind: 'producer' as const, producer: 'links', type: 'link' }] };
  const row = (path: string, properties: Record<string, unknown>, links: string[] = []) => ({ path, properties, links: { links } });
  const p = buildProjection([
    row('c.md', { curie: 'x:c' }), row('d1.md', { curie: 'x:d', see: 'x:c' }, ['c.md']), row('d2.md', { curie: 'x:d', see: ['x:c', 'x:d'] }, ['c.md', 'd1.md']),
  ], d as any);
  expect(p.quarantined.length).toBe(2); expect(p.source.length).toBe(0);
  // d1 and d2 each lose their links to c; d2's self/sibling references (destination also excluded) count once, not twice.
  expect(p.dropped!.see).toEqual({ drawn: 0, missing: 0, excluded: 3, lines: 0 });
  expect(p.dropped!.links).toEqual({ drawn: 0, missing: 0, excluded: 3, lines: 0 });
});

test('an excluded note resolving after the initial load never enters rows or coverage', async () => {
  const { LocalAdapter } = await import('../src/adapter/local');
  const files = ['live/a.md', '_archive/a.md'].map(p => new FixtureFile(p)), events = new Map<string, (...a: any[]) => void>();
  const app = { vault: { getMarkdownFiles: () => files, getAbstractFileByPath: (p: string) => files.find(f => f.path === p), on() {}, read() { throw new Error('body read forbidden'); } },
    metadataCache: { getFileCache: () => ({ frontmatter: { curie: 'x:1' } }), resolvedLinks: {}, on: (n: string, fn: (...a: any[]) => void) => events.set(n, fn) } } as unknown as App;
  const d = { ...defaultDeclaration('n@1'), identity: [{ key: 'curie' }], columns: ['curie'], edges: [], exclude: [['_archive']] };
  const adapter = new LocalAdapter(app, { register() {}, registerEvent() {} } as unknown as Plugin, 'n@1', 1, () => {}, true, d);
  const rows = async (reset: boolean) => { const all: FactRow[] = []; for await (const b of adapter.columns(reset, { chunkRows: 8, budgetMs: 8 })) all.push(...unpackRows(b.columns)); return all; };
  try {
    await rows(true); events.get('resolve')!(files[1]); events.get('changed')!(files[1]);
    expect((await rows(false)).map(r => r.path)).toEqual([]); expect(adapter.coverage()).toEqual({ indexed: 1, listed: 1 });
  } finally { adapter.index.dispose(); }
});


test('review: acknowledged input stamps stay compact and distinguish equal-length declared edits', async () => {
  let value = 'a'.repeat(20000);
  const f = await propertyFixture({ get: p => fact(p, { verified: true, frontmatter: { id: p, category: value } }) });
  try {
    await f.rows();
    const stamps = (f.adapter as any).sent as Map<string, string>;
    const first = stamps.get('a.md')!;
    expect(first.length).toBeLessThan(40); expect(first).not.toContain(value);
    f.events.get('resolve')!(f.files[0]); f.adapter.index.flush(); expect(await f.rows(false)).toEqual([]);
    value = 'b' + value.slice(1);
    f.events.get('resolve')!(f.files[0]); f.adapter.index.flush();
    expect((await f.rows(false))[0]!.properties.category).toBe(value); expect(stamps.get('a.md')).not.toBe(first);
    const changed = stamps.get('a.md')!; value += 'x';
    f.events.get('resolve')!(f.files[0]); f.adapter.index.flush();
    expect((await f.rows(false))[0]!.properties.category).toBe(value); expect(stamps.get('a.md')).not.toBe(changed);
    f.adapter.invalidate(); expect(stamps.size).toBe(0);
  } finally { f.adapter.index.dispose(); }
});

test('identical hydration during an unacknowledged batch does not restart the switch', async () => {
  let notified = 0;
  const f = await propertyFixture(undefined, false, () => notified++);
  f.caches.set('a.md', { frontmatter: { id: 'a' } }); f.caches.set('b.md', { frontmatter: { id: 'b' } });
  try {
    await f.rows();
    const batches = f.adapter.columns(true, { chunkRows: 1, budgetMs: 8 });
    await batches.next(); f.events.get('changed')!(f.files[0]); f.adapter.index.flush();
    expect(notified).toBe(0);
    while (!(await batches.next()).done) {}
    expect(notified).toBe(0); expect(f.adapter.factsComplete()).toBe(true);
    expect(await f.rows(false)).toEqual([]);
  } finally { f.adapter.index.dispose(); }
});

test('a mid-batch revert is compared with acknowledged input, not an old stamp', async () => {
  let notified = 0;
  const f = await propertyFixture(undefined, false, () => notified++);
  f.caches.set('a.md', { frontmatter: { id: 'old' } }); f.caches.set('b.md', { frontmatter: { id: 'b' } });
  try {
    await f.rows(); f.caches.set('a.md', { frontmatter: { id: 'new' } });
    const batches = f.adapter.columns(true, { chunkRows: 1, budgetMs: 8 });
    expect(unpackRows((await batches.next()).value!.columns)[0]!.properties.id).toBe('new');
    f.caches.set('a.md', { frontmatter: { id: 'old' } }); f.events.get('changed')!(f.files[0]); f.adapter.index.flush();
    expect(notified).toBe(0);
    while (!(await batches.next()).done) {}
    expect(notified).toBe(1);
    expect((await f.rows(false))[0]!.properties.id).toBe('old');
  } finally { f.adapter.index.dispose(); }
});
