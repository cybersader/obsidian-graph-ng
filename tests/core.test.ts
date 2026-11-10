import { describe, test, expect } from 'bun:test';
import { buildProjection, filterNodes, edgeVisibility, colorGroups, aggregate, storageBytes, NONE, type FactRow } from '../src/core/projection';
import { canonical, digest, validateDeclaration, defaultDeclaration, validatePredicate } from '../src/core/declaration';
import { runLayout, DEFAULT_LAYOUT } from '../src/core/layout';
import { incrementalLayout, warmLayout, edgeKeys } from '../src/core/incremental';
import { generationKey } from '../src/core/generation';
import { groupPages, page } from '../src/core/group-page';
import { contractGroups, validateGroupProjection, resolveCarrier } from '../src/core/group-projection';
import { SpatialGrid } from '../src/core/grid';
import { defaults, validateSettings } from '../src/settings';
import { exampleDeclaration, fixture } from '../scripts/fixture';
const d = structuredClone(exampleDeclaration);
const rows: FactRow[] = [
  { path: 'a/one.md', properties: { id: 'one', family: 'Family 1' } },
  { path: 'a/two.md', properties: { id: 'two', family: 'Family 2' } },
  { path: 'ab/three.md', properties: { id: 'three', family: 'Family 1' } },
  { path: 'edges/m.md', properties: { subject_id: 'one', object_id: 'two', predicate: 'matches' } },
  { path: 'edges/parallel.md', properties: { subject_id: 'one', object_id: 'two', predicate: 'related' } },
];
describe('declarations and identity', () => {
  test('neutral defaults and strict JSON validation', () => {
    validateDeclaration(d); validateDeclaration(defaultDeclaration('source@1'));
    expect(() => validateDeclaration({ ...d, magic: true })).toThrow('Unknown field');
    expect(() => validateDeclaration({ ...d, groups: [{ from: 'community' }] })).toThrow();
    expect(() => validateDeclaration({ ...d, identity: [{ key: '' }] })).toThrow();
    expect(() => validatePredicate({ kind: 'eq', key: 'a', value: {} })).toThrow();
    validateSettings(defaults('source@1'));
    expect(() => validateSettings({ ...defaults('s'), nodeSize: 0 })).toThrow();
    expect(() => validateSettings({ ...defaults('s'), groupCurveSamples: 1.5 })).toThrow();
  });
  test('path order deterministic; duplicate identities quarantined, duplicate paths rejected', () => {
    expect(buildProjection(rows, d)).toEqual(buildProjection([...rows].reverse(), d));
    const duplicate = buildProjection([...rows, { path: 'duplicate.md', properties: { id: 'one' } }], d);
    expect(duplicate.quarantined.map(row => row.path)).toEqual(['a/one.md', 'duplicate.md']);
    expect(duplicate.paths).toEqual(['a/two.md', 'ab/three.md']);
    expect(() => buildProjection([...rows, rows[0]!], d)).toThrow('Duplicate path');
  });
  test('path fallback with ordered identity keys', () => {
    const p = buildProjection([{ path: 'a.md', properties: { alt: 'A' } }, { path: 'b.md', properties: {} }], { ...d, identity: [{ key: 'id' }, { key: 'alt' }] });
    expect(p.identities).toEqual(['A', 'b.md']);
  });
  test('canonical and digest stable across key insertion order', async () => { expect(canonical({ z: 1, a: 2 })).toBe(canonical({ a: 2, z: 1 })); expect(await digest(d)).toHaveLength(64); });
});
describe('columnar projection', () => {
  test('reified typed multiedges preserve carriers; symmetric CSR', () => {
    const p = buildProjection(rows, d);
    expect(p.paths.length).toBe(3); expect(p.source.length).toBe(2); expect(p.targets.length).toBe(4);
    expect([...p.offsets]).toEqual([0, 2, 4, 4]); expect(p.types).toEqual(['matches', 'related']);
    expect(p.carrierPaths[p.carrier[0]!]).toBe('edges/m.md'); expect(storageBytes(p)).toBeGreaterThan(0);
  });
  test('reifiedAsNodes is a two-legged note relation', () => { const p = buildProjection(rows, { ...d, display: { reifiedAsNodes: true } }); expect(p.paths.length).toBe(5); expect(p.source.length).toBe(4); });
  test('inline and pinned producers are declared, unresolved refs dropped', () => {
    const p = buildProjection([{ path: 'a.md', properties: { id: 'a', related: ['b', 'missing'] }, links: { 'source@1': ['b.md'] } }, { path: 'b.md', properties: { id: 'b' } }], { ...d, edges: [{ name: 'inline', kind: 'inline', key: 'related', type: 'inline' }, { name: 'producer', kind: 'producer', producer: 'source@1', type: 'body' }] });
    expect(p.source.length).toBe(2); expect(p.unresolved).toBe(1); expect([...p.carrier]).toEqual([NONE, NONE]);
    const wrong = buildProjection([{ path: 'a.md', properties: {}, links: { 'source@2': ['b.md'] } }], defaultDeclaration('source@1')); expect(wrong.source.length).toBe(0);
  });
  test('exact dictionary predicates, folder boundary ranges, visible edges and ordered colors', () => {
    const p = buildProjection(rows, d);
    expect([...filterNodes(p, { kind: 'eq', key: 'family', value: 'Family 1' })]).toEqual([1, 0, 1]);
    expect([...filterNodes(p, { kind: 'folder', prefix: 'a' })]).toEqual([1, 1, 0]);
    expect([...filterNodes(p, { kind: 'folder', prefix: 'absent' })]).toEqual([0, 0, 0]);
    expect([...edgeVisibility(p, new Uint8Array([1, 0, 1]))]).toEqual([0, 0]);
    expect([...colorGroups(p, d)]).toEqual([0, 1, 0]);
    expect(() => filterNodes(p, { kind: 'eq', key: 'undeclared', value: 1 })).toThrow();
  });
  test('typed equality does not coerce string, numeric and boolean values', () => { const p = buildProjection([1, '1', true].map((value, i) => ({ path: `${i}.md`, properties: { v: value } })), { ...d, columns: ['v'] }); expect([...filterNodes(p, { kind: 'eq', key: 'v', value: 1 })]).toEqual([1, 0, 0]); });
  test('LOD contraction retains sums, type counts, carriers and members', () => {
    const p = buildProjection(rows, d), a = aggregate(p, new Float32Array([0, 0, 2, 2, 4, 4]), filterNodes(p));
    expect([...a.counts]).toEqual([2, 1]);
    const g = contractGroups(p, filterNodes(p)); validateGroupProjection(g.projection);
    expect(g.projection.groupEdges.length).toBe(1); expect(g.projection.groupEdges[0]!.typeCounts).toEqual({ matches: 1, related: 1 });
    expect(g.projection.groupEdges[0]!.carriers.ids.length).toBe(2); expect(g.members.get('0')).toEqual([0, 2]);
  });
  test('precomputed projection rejects duplicate ids, dangling pairs, negative counts', () => {
    validateGroupProjection({ groups: [{ id: 'g', label: 'G', count: 4 }], groupEdges: [] });
    expect(() => validateGroupProjection({ groups: [{ id: 'g', label: 'G', count: -1 }], groupEdges: [] })).toThrow();
    expect(() => validateGroupProjection({ groups: [], groupEdges: [{ a: 'x', b: 'y', total: 0, typeCounts: {}, carriers: { kind: 'opaque', ids: [] } }] })).toThrow();
  });
  test('full synthetic fixture equals direct declared scan', () => {
    const facts = fixture(), p = buildProjection(facts, d);
    expect(facts.length).toBe(60600); expect(p.paths.length).toBe(16000); expect(p.source.length).toBe(44600); expect(p.unresolved).toBe(0);
    const literal = buildProjection(facts, { ...d, display: { reifiedAsNodes: true } }); expect(literal.paths.length).toBe(60600); expect(literal.source.length).toBe(89200);
  });
});
describe('layout, grid and incremental generations', () => {
  test('cold ForceAtlas2 deterministic on same runtime', () => { const p = buildProjection(fixture(100, 300), d); const input = { count: p.paths.length, source: p.source, target: p.target, seed: 33 }; const options = { ...DEFAULT_LAYOUT, iterations: 12 }; expect(runLayout(input, options)).toEqual(runLayout(input, options)); });
  test('incremental attrs/deletes preserve positions, dirty relax pins untouched nodes', () => {
    const p = buildProjection(rows, d), pos = runLayout({ count: 3, source: p.source, target: p.target, seed: 1 }, { ...DEFAULT_LAYOUT, iterations: 10 });
    const updated = rows.map(r => ({ ...r, properties: { ...r.properties, label: 'new' } })); const q = buildProjection(updated, d);
    const inc = incrementalLayout(p, pos, q, 1, DEFAULT_LAYOUT); expect([...inc.movable!]).toEqual([0, 0, 0]); expect(inc.initial).toEqual(pos);
    const edited = rows.map(r => r.path === 'edges/m.md' ? { ...r, properties: { ...r.properties, object_id: 'one' } } : r);
    const next = buildProjection(edited, d), dirty = incrementalLayout(p, pos, next, 1, DEFAULT_LAYOUT);
    const relaxed = runLayout(dirty, DEFAULT_LAYOUT); expect(relaxed[4]).toBe(pos[4]); expect(relaxed[5]).toBe(pos[5]);
    const del = buildProjection(rows.filter(r => r.path !== 'edges/m.md'), d); expect(incrementalLayout(p, pos, del, 1, DEFAULT_LAYOUT).initial).toEqual(pos);
  });
  test('grid finds only nearby nodes', () => { const grid = new SpatialGrid(new Float32Array([0, 0, 1, 1, 20, 20]), 16); expect(grid.query(0, 0, 2)).toEqual([0, 1]); });
});

test('opaque producer carriers resolve only declared unique keys', () => {
  const declaration = { ...d, carrierResolvers: [{ kind: 'opaque', key: 'external' }] };
  const facts = [{ path: 'one.md', properties: { external: 'key:1' } }];
  expect(resolveCarrier(facts, declaration, 'opaque', 'key:1')).toBe('one.md');
  expect(resolveCarrier(facts, declaration, 'other', 'key:1')).toBeNull();
  expect(resolveCarrier([...facts, { path: 'two.md', properties: { external: 'key:1' } }], declaration, 'opaque', 'key:1')).toBeNull();
  const input = { schema: 'graph-projection-v0', producer: { name: 'synthetic', projection: 'example', asOf: '2026-11-10' }, groups: [{ id: 'a', label: 'Alpha', count: 1 }, { id: 'b', label: 'Beta', count: 2 }], groupEdges: [{ a: 'a', b: 'b', total: 3, typeCounts: { related: 3 }, directional: { aToB: { related: 1 }, bToA: { related: 2 } }, carriers: { kind: 'opaque', ids: ['key:1'] } }] };
  validateGroupProjection(input); expect(() => validateGroupProjection({ ...input, groupEdges: [{ ...input.groupEdges[0], total: 4 }] })).toThrow('total');
});
test('missing property and explicit null are different exact matches', () => {
  const p = buildProjection([{ path: 'a.md', properties: {} }, { path: 'b.md', properties: { nullable: null } }], { ...d, columns: ['nullable'] });
  expect([...filterNodes(p, { kind: 'eq', key: 'nullable', value: null })]).toEqual([0, 1]);
});

describe('independent review probes A–F', () => {
  test('A undeclared properties/producer maps do not invalidate keys or cold positions', async () => {
    const base = fixture(100, 300), edited = base.map((row, i) => i ? row : { ...row, properties: { ...row.properties, unrelated_timestamp: 'changed' }, links: { 'unused@1': ['nowhere.md'] } });
    const first = await generationKey(base, d, DEFAULT_LAYOUT, 'fa2@1'), second = await generationKey(edited, d, DEFAULT_LAYOUT, 'fa2@1');
    expect(first).toBe(second);
    const p = buildProjection(base, d), options = { ...DEFAULT_LAYOUT, iterations: 20 };
    expect(runLayout({ count: p.paths.length, source: p.source, target: p.target, seed: parseInt(first.slice(0, 8), 16) }, options)).toEqual(runLayout({ count: p.paths.length, source: p.source, target: p.target, seed: parseInt(second.slice(0, 8), 16) }, options));
    const changed = base.map((row, i) => i ? row : { ...row, properties: { ...row.properties, family: 'other' } });
    expect(await generationKey(changed, d, DEFAULT_LAYOUT, 'fa2@1')).not.toBe(first);
  });
  test('B declared link array order does not reseed a cold generation', async () => {
    const declaration = defaultDeclaration('p@1');
    const first = [{ path: 'a.md', properties: {}, links: { 'p@1': ['b.md', 'c.md'] } }, { path: 'b.md', properties: {} }, { path: 'c.md', properties: {} }];
    const second = [{ ...first[0]!, links: { 'p@1': ['c.md', 'b.md'] } }, first[1]!, first[2]!];
    expect(await generationKey(first, declaration, DEFAULT_LAYOUT, 'fa2@1')).toBe(await generationKey(second, declaration, DEFAULT_LAYOUT, 'fa2@1'));
    expect(buildProjection(first, declaration)).toEqual(buildProjection(second, declaration));
  });
  test('saved generation key misses preserve untouched positions and place new nodes', () => {
    const declaration = { ...d, edges: [] }, previous = buildProjection([{ path: 'a.md', properties: { id: 'a' } }, { path: 'b.md', properties: { id: 'b' } }], declaration);
    const saved = JSON.parse(JSON.stringify({ identities: previous.identities, positions: [10, 20, 30, 40], edgeKeys: edgeKeys(previous) }));
    const current = buildProjection([{ path: 'a.md', properties: { id: 'a' } }, { path: 'b.md', properties: { id: 'b' } }, { path: 'c.md', properties: { id: 'c' } }], declaration);
    const input = warmLayout(saved, current, 42, DEFAULT_LAYOUT), result = runLayout(input, { ...DEFAULT_LAYOUT, iterations: 10 });
    expect([...input.movable!]).toEqual([0, 0, 1]); expect([...result.slice(0, 4)]).toEqual([10, 20, 30, 40]); expect([...result]).toHaveLength(6); expect([...result].every(Number.isFinite)).toBe(true);
  });
  test('C constructor type is an own key, not an inherited directional count', () => {
    validateGroupProjection(JSON.parse('{"groups":[{"id":"a","label":"A","count":1},{"id":"b","label":"B","count":1}],"groupEdges":[{"a":"a","b":"b","total":1,"typeCounts":{"constructor":1},"directional":{"aToB":{"constructor":1},"bToA":{}},"carriers":{"kind":"k","ids":[]}}]}'));
    expect(true).toBe(true);
  });
  test('D duplicate identities quarantine every conflicting note; unrelated graph works', () => {
    const facts = [{ path: 'a.md', properties: { id: 'same' } }, { path: 'b.md', properties: { id: 'same' } }, { path: 'c.md', properties: { id: 'c', relation: 'd' } }, { path: 'd.md', properties: { id: 'd' } }];
    const p = buildProjection(facts, { ...d, edges: [{ name: 'inline', kind: 'inline', key: 'relation', type: 'related' }] });
    expect(p.quarantined).toEqual([{ path: 'a.md', id: 'same' }, { path: 'b.md', id: 'same' }]); expect(p.paths).toEqual(['c.md', 'd.md']); expect(p.source.length).toBe(1);
    const collision = buildProjection([{ path: 'a.md', properties: { id: 'b.md' } }, { path: 'b.md', properties: { id: 'other' } }], d); expect(collision.quarantined).toHaveLength(2);
  });
  test('E 16k groups / 44.6k pairs build only a bounded first page within 500ms', () => {
    const p = buildProjection(fixture(), { ...d, groups: [{ from: 'key', key: 'id' }] });
    const { projection } = contractGroups(p, new Uint8Array(p.paths.length).fill(1)), start = performance.now();
    const pages = groupPages(projection, 6), canvas = pages.canvas(0), groups = page(projection.groups, 0, 25), pairs = page(projection.groupEdges, 0, 25);
    expect(projection.groups).toHaveLength(16000); expect(projection.groupEdges.length).toBeGreaterThan(44000);
    expect(groups).toHaveLength(25); expect(pairs).toHaveLength(25); expect(canvas.groups).toHaveLength(6); expect(canvas.groupEdges.length).toBeLessThanOrEqual(21);
    expect(performance.now() - start).toBeLessThan(500);
    expect(page(projection.groups, 1, 25)[0]!.id).toBe(projection.groups[25]!.id);
  });
  test('F a literal folder beginning with a quote is never parsed as JSON', () => {
    const p = buildProjection([{ path: '"q/x.md', properties: {} }], { ...d, edges: [], groups: [{ from: 'folder', depth: 1 }] });
    expect(contractGroups(p, new Uint8Array([1])).projection.groups[0]!.label).toBe('"q');
    const quoted = buildProjection([{ path: '"valid"/x.md', properties: {} }], { ...d, edges: [], groups: [{ from: 'folder', depth: 1 }] });
    expect(contractGroups(quoted, new Uint8Array([1])).projection.groups[0]!.label).toBe('"valid"');
  });
  test('configurable aggregate limits reject only the explicitly configured envelope', () => {
    const projection = { groups: [{ id: 'a', label: 'A', count: 1 }], groupEdges: [{ a: 'a', b: 'a', total: 2, typeCounts: { t: 2 }, carriers: { kind: 'id', ids: ['1', '2'] } }] };
    validateGroupProjection(projection);
    expect(() => validateGroupProjection(projection, { groups: 0, pairs: 0, carriers: 1 })).toThrow('carrier limit');
    expect(() => validateGroupProjection({ ...projection, groups: [...projection.groups, { id: 'b', label: 'B', count: 1 }] }, { groups: 1, pairs: 0, carriers: 0 })).toThrow('group limit');
    expect(() => validateGroupProjection({ ...projection, groupEdges: [...projection.groupEdges, ...projection.groupEdges] }, { groups: 0, pairs: 1, carriers: 0 })).toThrow('pair limit');
  });
});
