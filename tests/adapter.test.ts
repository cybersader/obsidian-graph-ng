import { test, expect, mock } from 'bun:test';
import type { App, Plugin } from 'obsidian';
import { IncrementalIndex } from '../src/adapter/index';
import type { FactRow } from '../src/core/projection';
test('debounced file changes, rename and delete patch only changed rows', () => {
  const rows = new Map<string, FactRow>([['a.md', { path: 'a.md', properties: { id: 'a' } }]]), events: Set<string>[] = [];
  let reads = 0; const index = new IncrementalIndex(path => { reads++; return rows.get(path); }, paths => events.push(paths), 5000);
  index.seed(['a.md']); rows.set('b.md', { path: 'b.md', properties: {} }); index.change('b.md'); index.change('b.md');
  expect(events.length).toBe(0); index.flush(); expect([...events[0]!]).toEqual(['b.md']); expect(index.snapshot().length).toBe(2); expect(reads).toBe(3);
  rows.set('c.md', { path: 'c.md', properties: {} }); rows.delete('b.md'); index.rename('b.md', 'c.md'); index.remove('a.md'); index.flush();
  expect(index.snapshot().map(r => r.path)).toEqual(['c.md']); expect([...events[1]!]).toEqual(['b.md', 'c.md', 'a.md']); index.dispose();
});
test('startup snapshots reseed once metadata becomes complete before its debounced event', async () => {
  class FixtureFile { extension = 'md'; constructor(readonly path: string) {} }
  mock.module('obsidian', () => ({ TFile: FixtureFile }));
  const { LocalAdapter } = await import('../src/adapter/local');
  const files = [new FixtureFile('a.md'), new FixtureFile('b.md')];
  const caches = new Map<string, { frontmatter: Record<string, unknown> }>();
  const app = { vault: { getMarkdownFiles: () => files, getAbstractFileByPath: (path: string) => files.find(f => f.path === path), on: () => ({}) },
    metadataCache: { getFileCache: (file: FixtureFile) => caches.get(file.path) ?? null, resolvedLinks: {}, on: () => ({}) } } as unknown as App;
  const plugin = { registerEvent: () => {}, register: () => {} } as unknown as Plugin;
  const adapter = new LocalAdapter(app, plugin, 'source@1', 5000, () => {});
  expect(adapter.index.snapshot()[0]!.properties).toEqual({});
  caches.set('a.md', { frontmatter: { id: 'alpha' } }); caches.set('b.md', { frontmatter: { id: 'beta' } });
  expect(adapter.coverage()).toEqual({ indexed: 2, listed: 2 });
  expect(adapter.snapshot().map(r => r.properties.id)).toEqual(['alpha', 'beta']);
  caches.set('a.md', { frontmatter: { id: 'changed-but-no-event' } });
  expect(adapter.snapshot()[0]!.properties.id).toBe('alpha'); // Later updates remain event-driven, not full rescans.
  adapter.index.dispose();
});
