import { test, expect, mock } from 'bun:test';
import type { App, Plugin } from 'obsidian';
import { IncrementalIndex } from '../src/adapter/index';
import type { FactRow } from '../src/core/projection';
class FixtureFile { extension = 'md'; constructor(public path: string) {} }
mock.module('obsidian', () => ({ TFile: FixtureFile }));
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
  // A newer event for a yielded path must survive acknowledgement of its previous value.
  values.set('a.md', 'first'); events.get('changed')!(files[0]); adapter.index.flush();
  const active = adapter.columns(false, { chunkRows: 1, budgetMs: 8 }); await active.next();
  values.set('a.md', 'second'); events.get('changed')!(files[0]); adapter.index.flush();
  while (!(await active.next()).done) {}
  const next: FactRow[] = []; for await (const b of adapter.columns(false, { chunkRows: 1, budgetMs: 8 })) next.push(...unpackRows(b.columns));
  expect(next.map(r => r.properties.id)).toEqual(['second']); adapter.index.dispose();
});
