import { test, expect } from 'bun:test';
import { readdir, readFile } from 'node:fs/promises';
import { migrateDeclaration, defaultDeclaration, validatePredicate } from '../src/core/declaration';
import { buildProjection, filterNodes } from '../src/core/projection';
import { defaults, validateSettings } from '../src/settings';
import { compatibilityIssues, credentialShapedField, opaqueHighEntropy } from './support/settings-compatibility';
test('v1 declarations migrate to v2 property names and always serialize without legacy fields', () => {
  const legacy = { ...defaultDeclaration('p@1'), version: 1, edges: [{ name: 'reference', kind: 'reified', sourceKey: 'from_id', targetKey: 'to_id', typeKey: 'relation' }] };
  const migrated = migrateDeclaration(legacy);
  expect(migrated.version).toBe(2); expect(migrated.edges[0]).toEqual({ name: 'reference', kind: 'reified', sourceProperty: 'from_id', targetProperty: 'to_id', typeProperty: 'relation' });
  expect(JSON.stringify(migrated)).not.toMatch(/sourceKey|targetKey|typeKey/); expect(legacy.version).toBe(1);
  expect(() => migrateDeclaration({ ...legacy, edges: [{ ...legacy.edges[0], sourceProperty: 'ambiguous' }] })).toThrow('Ambiguous');
});
test('folder predicates and anchored groups accept path segments with exact boundary semantics', () => {
  const declaration = { ...defaultDeclaration('p@1'), groups: [{ from: 'folder' as const, depth: 1, prefix: ['Top', 'Nested'] }] };
  const p = buildProjection([{ path: 'Top/Nested/A/a.md', properties: {} }, { path: 'Top/Nested/B/b.md', properties: {} }, { path: 'Top/NestedElsewhere/c.md', properties: {} }], declaration);
  expect([...filterNodes(p, { kind: 'folder', prefix: ['Top', 'Nested'] })]).toEqual([1, 1, 0]);
  expect(filterNodes(p, { kind: 'folder', prefix: ['Top', 'Nested'] })).toEqual(filterNodes(p, { kind: 'folder', prefix: 'Top/Nested' }));
  expect(p.groups[0]?.values).toContain('A'); expect(p.groups[0]?.values).toContain('(outside prefix)');
  expect(() => validatePredicate({ kind: 'folder', prefix: ['Top', '..'] })).toThrow();
  expect(() => validatePredicate({ kind: 'folder', prefix: ['Top/Nested'] })).toThrow();
});
test('all example declarations/settings and a generated large declaration pass reported sharing rules', async () => {
  for (const name of (await readdir(new URL('../examples/', import.meta.url))).filter(n => /(?:settings|declaration)\.json$/.test(n))) {
    const example = JSON.parse(await readFile(new URL(`../examples/${name}`, import.meta.url), 'utf8'));
    expect(compatibilityIssues(example)).toEqual([]);
    if (name.endsWith('settings.json')) validateSettings(example);
  }
  const settings = defaults('obsidian-links@1.13.7');
  settings.declaration.edges.push({ kind: 'reified', name: 'reference', sourceProperty: 'subject_id', targetProperty: 'object_id', typeProperty: 'relation' });
  settings.declaration.colors = Array.from({ length: 250 }, (_, i) => ({ name: `Folder ${i}`, color: '#123456', predicate: { kind: 'folder', prefix: ['Research', `Category-${i}`, 'Source-Material', 'References', 'Examples'] } }));
  settings.declaration.groups.push({ from: 'folder', depth: 2, prefix: ['Research', 'Source-Material', 'References'] });
  expect(compatibilityIssues(settings)).toEqual([]);
  expect(credentialShapedField('sourceKey')).toBe(true); expect(credentialShapedField('key')).toBe(false); expect(credentialShapedField('sourceProperty')).toBe(false);
  expect(opaqueHighEntropy('Abcdefghijklmnopqrstuvwxyz0123456789')).toBe(true);
  expect(opaqueHighEntropy('Research/Category-1/Source-Material/References/Examples')).toBe(true);
});
test('default projection limits and byte budgets are finite and positive', () => {
  const s = defaults('p@1');
  for (const n of [s.maxProjectionGroups, s.maxProjectionPairs, s.maxProjectionCarriers, s.maxProjectionBytes, s.maxSettingsBytes]) expect(n > 0 && Number.isFinite(n)).toBe(true);
});
test('v1 prefix migration normalizes host separators/current-folder segments, rejects parent traversal', () => {
  const legacy = { ...defaultDeclaration('p@1'), version: 1, groups: [{ from: 'folder', depth: 1, prefix: '.\\Research\\.\\Notes\\' }], colors: [{ name: 'Notes', color: '#123456', predicate: { kind: 'folder', prefix: './Research/./Notes/' } }] };
  const upgraded = migrateDeclaration(legacy);
  expect(upgraded.groups[0]).toEqual({ from: 'folder', depth: 1, prefix: ['Research', 'Notes'] });
  expect(upgraded.colors[0]!.predicate).toEqual({ kind: 'folder', prefix: ['Research', 'Notes'] });
  expect(legacy.groups[0]!.prefix).toBe('.\\Research\\.\\Notes\\');
  for (const prefix of ['../Notes', 'Research/../Notes', 'C:\\Notes', '\\Notes']) expect(() => migrateDeclaration({ ...legacy, groups: [{ from: 'folder', depth: 1, prefix }] })).toThrow('legacy folder prefix');
});
test('settings upgrade records finite defaults once and confines cache paths to plugin cache', async () => {
  const { upgradeSettings } = await import('../src/settings');
  const old: any = defaults('p@1'); delete old.settingsVersion;
  old.maxProjectionGroups = old.maxProjectionPairs = old.maxProjectionCarriers = 0;
  const upgraded = upgradeSettings(old, 'p@1'); expect(upgraded.settingsVersion).toBe(2);
  expect(upgraded.maxProjectionGroups).toBe(20000); expect(upgraded.maxProjectionPairs).toBe(200000); expect(upgraded.maxProjectionCarriers).toBe(1000000);
  upgraded.maxProjectionGroups = 0; expect(upgradeSettings(upgraded, 'p@1').maxProjectionGroups).toBe(0);
  for (const directory of ['Notes', 'cache/../Notes', '/tmp/cache', 'cache//nested', 'cache\\nested']) expect(() => validateSettings({ ...upgraded, cache: { ...upgraded.cache, directory } })).toThrow('plugin-owned');
  validateSettings({ ...upgraded, cache: { ...upgraded.cache, directory: 'cache/nested' } });
});
test('invalid settings originals are copied before defaults; copy failure forbids fallback saves', async () => {
  const { loadSettings } = await import('../src/settings');
  for (const text of ['{broken', JSON.stringify({ settings: { ...defaults('p@1'), workerTimeoutMs: -1 } }), JSON.stringify({ settings: { ...defaults('p@1'), declaration: { version: 99 } } })]) {
    const copies: string[] = [], notices: string[] = [];
    const disk = { stat: async () => ({ size: text.length }), read: async () => text, copy: async (_from: string, to: string) => { copies.push(to); } };
    const loaded = await loadSettings(disk, 'plugin/data.json', 'p@1', m => notices.push(m));
    expect(copies).toHaveLength(1); expect(copies[0]).toMatch(/^plugin\/data\.json\.corrupt-\d+$/); expect(notices).toHaveLength(1);
    expect(loaded.data).toBeUndefined(); expect(loaded.settings).toEqual(defaults('p@1')); expect(loaded.persist).toBe(true);
    await expect(loadSettings({ ...disk, copy: async () => { throw new Error('copy failed'); } }, 'plugin/data.json', 'p@1', () => {})).rejects.toThrow('copy failed');
  }
  let read = false, copied = false;
  const loaded = await loadSettings({ stat: async () => ({ size: 16777217 }), read: async () => { read = true; return ''; }, copy: async () => { copied = true; } }, 'plugin/data.json', 'p@1', () => {});
  expect(read).toBe(false); expect(copied).toBe(true); expect(loaded.persist).toBe(true);
});
