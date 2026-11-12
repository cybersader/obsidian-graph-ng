import { test, expect } from 'bun:test';
import { WorkerPipeline, LAYOUT_PRODUCER, currentDetailGeneration, type Transport, type ProjectResult, type LayoutResult, type DetailResult } from '../src/pipeline';
import { defaultDeclaration, digest } from '../src/core/declaration';
import { DEFAULT_LAYOUT } from '../src/core/layout';
import { packRows, unpackRows, transferables, encodeStrings, decodeStrings } from '../src/core/columns';
import { buildProjection, type FactRow } from '../src/core/projection';
import { sliced } from '../src/core/scheduler';
import { CACHE_FORMAT, BinaryLayoutStore, encodeLayout, decodeLayout, type BinaryAdapter, type BinaryGeneration, type GenerationMeta } from '../src/core/binary-layout';
const declaration = defaultDeclaration('fixture@1');
const layout = { ...DEFAULT_LAYOUT, iterations: 2, relaxIterations: 2 };
const config = { declaration, layout, source: 'obsidian-links@1/local', groupLevel: 0, streamEveryIterations: 1 };
function pipeline() { return new WorkerPipeline(new Worker(new URL('../src/layout-worker.ts', import.meta.url).href) as unknown as Transport, () => 10000); }
class MemoryAdapter implements BinaryAdapter {
  files = new Map<string, Uint8Array>(); dirs = new Set<string>(); reads: string[] = [];
  async exists(p: string) { return this.files.has(p) || this.dirs.has(p); }
  async mkdir(p: string) { this.dirs.add(p); }
  async read(p: string) { this.reads.push(p); const b = this.files.get(p); if (!b) throw new Error('absent'); return new TextDecoder().decode(b); }
  async write(p: string, s: string) { this.files.set(p, new TextEncoder().encode(s)); }
  async readBinary(p: string) { this.reads.push(p); const b = this.files.get(p); if (!b) throw new Error('absent'); return b.slice().buffer; }
  async writeBinary(p: string, b: ArrayBuffer) { this.files.set(p, new Uint8Array(b).slice()); }
  async stat(p: string) { const b = this.files.get(p); return b ? { size: b.length } : null; }
  async rename(from: string, to: string) { for (const [p, b] of [...this.files]) if (p === from || p.startsWith(from + '/')) { this.files.set(to + p.slice(from.length), b); this.files.delete(p); } for (const p of [...this.dirs]) if (p === from || p.startsWith(from + '/')) { this.dirs.add(to + p.slice(from.length)); this.dirs.delete(p); } }
  async rmdir(p: string) { for (const k of this.files.keys()) if (k.startsWith(p + '/')) this.files.delete(k); for (const k of [...this.dirs]) if (k === p || k.startsWith(p + '/')) this.dirs.delete(k); }
  async remove(p: string) { this.files.delete(p); }
  async list(p: string) { const direct = (s: string) => s.startsWith(p + '/') && !s.slice(p.length + 1).includes('/'); return { files: [...this.files.keys()].filter(direct), folders: [...this.dirs].filter(direct) }; }
}
async function generation(n = 1, declarationHash = 'a'.repeat(64), key = 'b'.repeat(64)): Promise<BinaryGeneration> {
  const meta: GenerationMeta = { format: CACHE_FORMAT, declarationHash, key, layoutHash: await digest({ layout, streamEveryIterations: 1 }), layout, source: config.source, groupLevel: config.groupLevel, streamEveryIterations: config.streamEveryIterations, producer: LAYOUT_PRODUCER };
  return encodeLayout({ meta, identities: Array.from({ length: n }, (_, i) => `path:${i}.md`), positions: Float32Array.from({ length: n * 2 }, (_, i) => i / 2), edgeKeys: new Uint32Array(), groups: { groups: [], groupEdges: [] } });
}
const options = { directory: 'plugin/cache/local', chunkBytes: 64, maxGenerationBytes: 1024 * 1024 * 8, cachedDeclarations: 1 };
test('columnar round trips preserve object projection across seeded scalar/list/missing rows', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const rows: FactRow[] = Array.from({ length: 30 }, (_, i) => ({ path: `${i}.md`, properties: { id: `${seed}:${i}`, group: i % 3, unused: 'not shipped' }, links: { 'fixture@1': [`${(i + seed) % 30}.md`] } }));
    const columns = packRows(rows, declaration), restored = unpackRows(columns);
    expect(restored.every(r => !Object.hasOwn(r.properties, 'unused'))).toBe(true);
    expect(buildProjection(restored, declaration)).toEqual(buildProjection(rows, declaration));
    const transferred = structuredClone(columns, { transfer: transferables(columns) });
    expect(columns.paths.bytes.byteLength).toBe(0); expect(unpackRows(transferred)).toEqual(restored);
  }
});
test('UTF-8 dictionaries preserve empty, multibyte and supplementary strings with exact buffers', () => {
  const strings = ['', 'é', '中文', '📚', 'plain']; const dictionary = encodeStrings(strings);
  expect(decodeStrings(dictionary)).toEqual(strings); expect(dictionary.bytes.buffer.byteLength).toBe(dictionary.bytes.byteLength);
});
test('ingestion yields at least once per chunk, including a short final chunk', async () => {
  let yields = 0, consumed = 0;
  await sliced(Array.from({ length: 11 }, (_, i) => i), { chunkRows: 3, budgetMs: 8 }, () => consumed++, async () => { yields++; });
  expect(consumed).toBe(11); expect(yields).toBe(4);
});
test('binary generations round trip chunked without JSON positions and retain bounded LRU', async () => {
  const adapter = new MemoryAdapter(), store = new BinaryLayoutStore(adapter, options), first = await generation(100);
  await store.write(first); const loaded = await store.latest(first.meta.declarationHash);
  expect(decodeLayout(loaded!).positions).toEqual(decodeLayout(first).positions);
  expect([...adapter.files].filter(([p]) => p.endsWith('.bin')).every(([, b]) => b.length <= 64)).toBe(true);
  const next = await generation(10, 'c'.repeat(64), 'd'.repeat(64)); await store.write(next);
  expect(await store.latest(first.meta.declarationHash)).toBeUndefined();
  expect(store.trace.some(t => t.action === 'removed')).toBe(true); expect(store.trace.some(t => t.action === 'kept')).toBe(true);
});
test('truncated, oversized and malformed generation chunks are quarantined', async () => {
  for (const mode of ['truncated', 'oversized', 'malformed']) {
    const adapter = new MemoryAdapter(), store = new BinaryLayoutStore(adapter, options), g = await generation(); await store.write(g);
    const root = `${options.directory}/${g.meta.declarationHash}/${g.meta.key}`;
    if (mode === 'malformed') await adapter.write(`${root}/manifest.json`, '{broken');
    else adapter.files.set(`${root}/positions.0.bin`, new Uint8Array(mode === 'truncated' ? 1 : 1048577));
    expect(await store.latest(g.meta.declarationHash)).toBeUndefined(); expect(store.trace.at(-1)?.action).toBe('quarantined');
    expect([...adapter.files.keys()].some(p => p.includes('.corrupt-'))).toBe(true);
  }
});
test('NaN/invalid dictionary generations fail decode and can be quarantined without a repair command', async () => {
  const adapter = new MemoryAdapter(), store = new BinaryLayoutStore(adapter, options), g = await generation();
  new Float32Array(g.files.positions!.buffer)[0] = NaN; await store.write(g);
  const candidate = await store.latest(g.meta.declarationHash);
  expect(() => decodeLayout(candidate!)).toThrow('Invalid binary layout'); await store.quarantine(g.meta);
  expect(await store.latest(g.meta.declarationHash)).toBeUndefined();
  const bad = await generation(); bad.files.offsets = new Uint8Array(3); expect(() => decodeLayout(bad)).toThrow('Truncated');
});
test('source/view mismatch never loads or warm seeds; format and layout mismatch also refuse', async () => {
  const p = pipeline();
  try {
    const hashes = await p.request<{ declarationHash: string }>(1, { kind: 'configure', config });
    for (const mismatch of ['source', 'layoutHash', 'producer']) {
      const g = await generation(1, hashes.declarationHash); g.meta[mismatch as 'source'] = 'different';
      expect(await p.request(1, { kind: 'load', generation: g })).toBeUndefined();
    }
    for (const format of [2, 99]) {
      const g = await generation(1, hashes.declarationHash); g.meta.format = format;
      await expect(p.request(1, { kind: 'load', generation: g })).rejects.toThrow('Invalid binary layout');
      const store = new BinaryLayoutStore(new MemoryAdapter(), options); await store.write(g);
      expect(await store.latest(g.meta.declarationHash)).toBeUndefined();
      expect(store.trace.at(-1)?.action).toBe('quarantined');
    }
  } finally { p.dispose(); }
});
test('worker builds/groups first, transfers detail buffers, reuses exact cache and rejects foreign identities', async () => {
  const p = pipeline(), events: string[] = [];
  p.onGroups = () => events.push('groups'); p.onPositions = e => { expect(e.positions.every(Number.isFinite)).toBe(true); events.push('positions'); };
  try {
    await p.request(7, { kind: 'configure', config });
    await p.request(7, { kind: 'rows', reset: true, columns: packRows([{ path: '0.md', properties: {} }, { path: '1.md', properties: {} }], declaration) });
    const built = await p.request<ProjectResult>(7, { kind: 'project' }); expect(events[0]).toBe('groups');
    const first = await p.request<LayoutResult>(7, { kind: 'layout' }); expect(first.cached).toBe(false);
    const encoded = await p.request<BinaryGeneration>(7, { kind: 'encode' });
    expect(decodeLayout(encoded).positions).toEqual(first.positions); expect(built.nodes).toBe(2);
    await p.request(8, { kind: 'load', generation: structuredClone(encoded) }); await p.request(8, { kind: 'project' });
    expect((await p.request<LayoutResult>(8, { kind: 'layout' })).cached).toBe(true);
    const corrupt = decodeLayout(encoded); corrupt.identities[0] = 'hidden-foreign';
    await p.request(9, { kind: 'load', generation: encodeLayout(corrupt) });
    expect((await p.request<ProjectResult>(9, { kind: 'project' })).invalidSaved?.key).toBe(built.meta.key);
    expect((await p.request<LayoutResult>(9, { kind: 'layout' })).cached).toBe(false);
  } finally { p.dispose(); }
});
test('view namespace discard removes all old view artifacts', async () => {
  const adapter = new MemoryAdapter(), store = new BinaryLayoutStore(adapter, options); await store.write(await generation()); await store.discard();
  expect([...adapter.files.keys()].some(p => p.startsWith(options.directory + '/'))).toBe(false);
});
test('worker protocol ignores mismatched revision responses and disposes all pending requests', async () => {
  const transport: Transport = { onmessage: null, onerror: null, postMessage() {}, terminate() {} }, p = new WorkerPipeline(transport, () => 10000);
  const promise = p.request<number>(11, { kind: 'project' });
  transport.onmessage!({ data: { id: 1, revision: 10, result: 10 } } as MessageEvent);
  transport.onmessage!({ data: { id: 1, revision: 11, result: 11 } } as MessageEvent); expect(await promise).toBe(11);
  const pending = p.request(12, { kind: 'project' }); p.dispose(); await expect(pending).rejects.toThrow('closed');
});
test('legacy slice-1 positions migrate as hints and are reverified, never exact old-format hits', async () => {
  const p = pipeline();
  try {
    const hashes = await p.request<{ declarationHash: string }>(1, { kind: 'configure', config });
    const old = { key: '1'.repeat(64), identities: ['0.md'], positions: [3, 4], producer: 'graphology-fa2@0.10.1', layoutHash: await digest(layout), edgeKeys: [] };
    const binary = await p.request<BinaryGeneration>(1, { kind: 'migrate', declarationHash: hashes.declarationHash, generation: old });
    expect(binary.meta.format).toBe(CACHE_FORMAT); expect(decodeLayout(binary).positions).toEqual(new Float32Array([3, 4]));
    await p.request(1, { kind: 'load', generation: binary }); await p.request(1, { kind: 'rows', reset: true, columns: packRows([{ path: '0.md', properties: {} }], declaration) }); await p.request(1, { kind: 'project' });
    const restored = await p.request<LayoutResult>(1, { kind: 'layout' }); expect(restored.cached).toBe(false); expect(restored.positions).toEqual(new Float32Array([3, 4]));
  } finally { p.dispose(); }
});
test('foreign-view manifest refuses before any binary chunk is read', async () => {
  const adapter = new MemoryAdapter(), store = new BinaryLayoutStore(adapter, options), g = await generation(); await store.write(g); adapter.reads = [];
  expect(await store.latest(g.meta.declarationHash, { source: 'different/view', layoutHash: g.meta.layoutHash, producer: g.meta.producer })).toBeUndefined();
  expect(adapter.reads.some(p => p.endsWith('.bin'))).toBe(false); expect(store.trace.at(-1)?.action).toBe('quarantined');
});
test('interrupted chunk writes resume matching chunks and stay uncommitted until complete', async () => {
  const adapter = new MemoryAdapter(), store = new BinaryLayoutStore(adapter, options), g = await generation(100);
  const original = adapter.writeBinary.bind(adapter); let writes = 0, fail = true;
  adapter.writeBinary = async (path, bytes) => { writes++; if (fail && writes === 2) throw new Error('synthetic interruption'); await original(path, bytes); };
  await expect(store.write(g)).rejects.toThrow('synthetic interruption'); expect(await store.latest(g.meta.declarationHash)).toBeUndefined();
  const retained = [...adapter.files.keys()].find(p => p.endsWith('.bin'))!, completed: string[] = []; fail = false;
  adapter.writeBinary = async (path, bytes) => { completed.push(path); await original(path, bytes); };
  await store.write(g); expect(completed).not.toContain(retained); expect(decodeLayout((await store.latest(g.meta.declarationHash))!).positions).toEqual(decodeLayout(g).positions);
});
test('partial public metadata never invalidates or overwrites a complete saved generation', async () => {
  const p = pipeline();
  try {
    await p.request(1, { kind: 'configure', config });
    const rows = [{ path: '0.md', properties: {} }, { path: '1.md', properties: {} }];
    await p.request(1, { kind: 'rows', reset: true, columns: packRows(rows, declaration) }); await p.request(1, { kind: 'project' }); await p.request(1, { kind: 'layout' });
    const saved = await p.request<BinaryGeneration>(1, { kind: 'encode' }); await p.request(2, { kind: 'load', generation: saved });
    await p.request(2, { kind: 'rows', reset: true, columns: packRows(rows.slice(0, 1), declaration) });
    expect((await p.request<ProjectResult>(2, { kind: 'project', complete: false })).invalidSaved).toBeUndefined(); await p.request(2, { kind: 'layout' });
    await p.request(3, { kind: 'rows', reset: true, columns: packRows(rows, declaration) }); await p.request(3, { kind: 'project', complete: true });
    expect((await p.request<LayoutResult>(3, { kind: 'layout' })).cached).toBe(true);
  } finally { p.dispose(); }
});
test('worker aggregate byte caps precede parse and malformed projections refuse', async () => {
  const p = pipeline();
  try {
    await expect(p.request(1, { kind: 'external', bytes: new TextEncoder().encode('{malformed'), maxBytes: 1, limits: { groups: 1, pairs: 1, carriers: 1 } })).rejects.toThrow('byte limit');
    await expect(p.request(1, { kind: 'external', bytes: new TextEncoder().encode('{malformed'), maxBytes: 100, limits: { groups: 1, pairs: 1, carriers: 1 } })).rejects.toThrow();
    await expect(p.request(1, { kind: 'external', bytes: new TextEncoder().encode('{"groups":[{"id":"a","label":"A","count":1},{"id":"b","label":"B","count":1}],"groupEdges":[]}'), maxBytes: 1024, limits: { groups: 1, pairs: 1, carriers: 1 } })).rejects.toThrow('group limit');
  } finally { p.dispose(); }
});
function fakeTransport() {
  const sent: any[] = [];
  const transport: Transport = { onmessage: null, onerror: null, postMessage(message) { sent.push(message); }, terminate() {} };
  const emit = (message: object) => transport.onmessage?.({ data: message } as MessageEvent);
  return { transport, sent, emit };
}
test('queued RPCs consume no processing timeout and begin their own budget on acknowledgement', async () => {
  const fake = fakeTransport(), p = new WorkerPipeline(fake.transport, () => 200);
  try {
    const first = p.request(1, { kind: 'project' }), second = p.request(2, { kind: 'project' });
    expect(fake.sent).toHaveLength(1); fake.emit({ kind: 'started', id: 1, revision: 1 });
    await new Promise(resolve => setTimeout(resolve, 120)); fake.emit({ id: 1, revision: 1, result: 'first' }); expect(await first).toBe('first');
    expect(fake.sent).toHaveLength(2); fake.emit({ kind: 'started', id: 2, revision: 2 });
    await new Promise(resolve => setTimeout(resolve, 120)); fake.emit({ id: 2, revision: 2, result: 'second' }); expect(await second).toBe('second');
  } finally { p.dispose(); }
});
test('worker timeout/error restarts are bounded, reject old queue, and permit fresh ingestion', async () => {
  for (const failure of ['timeout', 'error']) {
    const old = fakeTransport(), fresh = fakeTransport(); let restarted = 0;
    const p = new WorkerPipeline(old.transport, () => 25, () => {}, { restart: () => { restarted++; return fresh.transport; }, maxRestarts: () => 1 });
    const first = p.request(1, { kind: 'project' }), queued = p.request(2, { kind: 'project' });
    const rejected = Promise.all([first.catch(e => String(e)), queued.catch(e => String(e))]);
    old.emit({ kind: 'started', id: 1, revision: 1 });
    if (failure === 'error') old.transport.onerror?.({ message: 'synthetic crash' } as ErrorEvent);
    expect((await rejected).every(e => String(e).includes(failure === 'error' ? 'synthetic crash' : 'timed out'))).toBe(true);
    expect(restarted).toBe(1); expect(old.sent).toHaveLength(1);
    const configured = p.request(3, { kind: 'configure', config }); fresh.emit({ kind: 'started', id: 3, revision: 3 }); fresh.emit({ id: 3, revision: 3, result: 'fresh' }); expect(await configured).toBe('fresh');
    const final = p.request(4, { kind: 'project' }); const failed = final.catch(e => String(e)); fresh.transport.onerror?.({ message: 'second crash' } as ErrorEvent);
    expect(await failed).toContain('second crash'); expect(restarted).toBe(1); await expect(p.request(5, { kind: 'project' })).rejects.toThrow('closed'); p.dispose();
  }
});
test('member/contribution reads are queued and bound to their projection revision', async () => {
  const p = pipeline();
  try {
    await p.request(1, { kind: 'configure', config }); await p.request(1, { kind: 'rows', reset: true, columns: packRows([{ path: '0.md', properties: {} }], declaration) }); await p.request(1, { kind: 'project' });
    const newer = p.request(2, { kind: 'project' });
    const stale = p.request(1, { kind: 'members', group: 'anything', view: 1 }).catch(e => String(e));
    await newer; expect(await stale).toContain('generation changed');
    const stalePage = await p.request(1, { kind: 'contributions', pair: 'anything', offset: 0, count: 1, view: 1 }).catch(String); expect(stalePage).toContain('generation changed');
    const { view } = await p.request<DetailResult>(2, { kind: 'detail' });
    expect(await p.request<Uint32Array>(2, { kind: 'members', group: 'anything', view })).toEqual(new Uint32Array());
  } finally { p.dispose(); }
});
test('review probe: a same-revision regroup gets its own view generation; reads from the old grouping are refused', async () => {
  const p = pipeline();
  try {
    const rows = [{ path: 'A/x.md', properties: { kind: 'Alpha' } }, { path: 'B/y.md', properties: { kind: 'Beta' } }, { path: 'B/z.md', properties: { kind: 'Alpha' } }];
    const d = { ...declaration, columns: ['kind'] };
    await p.request(1, { kind: 'configure', config: { ...config, declaration: d } }); await p.request(1, { kind: 'rows', reset: true, columns: packRows(rows, d) }); await p.request(1, { kind: 'project' });
    const detail = await p.request<DetailResult>(1, { kind: 'detail' });
    const byFolder = await p.request<Uint32Array>(1, { kind: 'members', group: '1', view: detail.view });
    // Regroup by property in the same projection revision: the dictionary changes.
    const regrouped = await p.request<{ view: number; explore: { groupKeys: string[] } }>(1, { kind: 'explore', view: { query: '', filters: [], group: { from: 'key', key: 'kind' }, hiddenGroups: [], collapsedGroups: [], hiddenColors: [], hiddenTypes: [] }, facetValues: 10 });
    expect(regrouped.view).toBeGreaterThan(detail.view);
    // A click captured on the old canvas (old view generation) can never read the new dictionary.
    expect(await p.request(1, { kind: 'members', group: '1', view: detail.view }).catch(String)).toContain('View generation changed');
    expect(await p.request(1, { kind: 'contributions', pair: '[0,1]', offset: 0, count: 5, view: detail.view }).catch(String)).toContain('View generation changed');
    const byKind = await p.request<Uint32Array>(1, { kind: 'members', group: '1', view: regrouped.view });
    expect([...byFolder]).not.toEqual([...byKind]);
    // A filter-only change is a new generation too.
    const filtered = await p.request<{ view: number }>(1, { kind: 'explore', view: { query: 'x', filters: [], group: { from: 'key', key: 'kind' }, hiddenGroups: [], collapsedGroups: [], hiddenColors: [], hiddenTypes: [] }, facetValues: 10 });
    expect(filtered.view).toBe(regrouped.view + 1);
    expect(await p.request(1, { kind: 'members', group: '1', view: regrouped.view }).catch(String)).toContain('View generation changed');
  } finally { p.dispose(); }
});
test('legacy hints are never relabelled with a nonlocal view identity', async () => {
  const p = pipeline();
  try {
    const hashes = await p.request<{ declarationHash: string }>(1, { kind: 'configure', config: { ...config, source: 'obsidian-links@1/opaque-other-view' } });
    expect(await p.request(1, { kind: 'migrate', declarationHash: hashes.declarationHash, generation: { key: '1'.repeat(64), identities: ['0.md'], positions: [3, 4], producer: 'graphology-fa2@0.10.1', layoutHash: await digest(layout) } })).toBeUndefined();
  } finally { p.dispose(); }
});
test('cache quarantine/failed partial artifacts obey count and byte caps without touching source paths', async () => {
  const adapter = new MemoryAdapter(), store = new BinaryLayoutStore(adapter, { ...options, retainedArtifacts: 1, maxRetainedBytes: 1024 * 1024 });
  await adapter.write('Notes/source.md', 'source'); await adapter.write('plugin/data.json.corrupt-1', 'settings backup');
  for (let i = 1; i <= 3; i++) {
    const g = await generation(1, 'a'.repeat(64), i.toString().repeat(64)); await store.write(g); await store.quarantine(g.meta);
  }
  expect([...adapter.dirs].filter(p => /\.corrupt-\d+$/.test(p))).toHaveLength(1);
  const original = adapter.writeBinary.bind(adapter); adapter.writeBinary = async (p, b) => { await original(p, b); throw new Error('interrupted'); };
  for (let i = 4; i <= 6; i++) await expect(store.write(await generation(1, 'a'.repeat(64), i.toString().repeat(64)))).rejects.toThrow('interrupted');
  const artifacts = [...adapter.dirs].filter(p => p.startsWith(options.directory + '/') && /^[a-f0-9]{64}(?:\.corrupt-\d+)?$/.test(p.split('/').at(-1)!) && p.split('/').length === options.directory.split('/').length + 2);
  expect(artifacts).toHaveLength(1);
  await new BinaryLayoutStore(adapter, { ...options, retainedArtifacts: 5, maxRetainedBytes: 0 }).pruneArtifacts();
  expect([...adapter.files.keys()].some(p => p.endsWith('.bin'))).toBe(false);
  expect(await adapter.read('Notes/source.md')).toBe('source'); expect(await adapter.read('plugin/data.json.corrupt-1')).toBe('settings backup');
});
test('member indices cannot use an old detail dictionary during the group-before-detail window', async () => {
  const fake = fakeTransport(), p = new WorkerPipeline(fake.transport, () => 1000);
  let active = 1, detail = 1; const retainedDictionary = ['old-note.md'];
  try {
    const requested = active, members = p.request<Uint32Array>(requested, { kind: 'members', group: 'g', view: 1 });
    // New groups become active while the old detail object is deliberately retained.
    active = 2; expect(currentDetailGeneration(active, active, detail)).toBe(false);
    fake.emit({ id: 1, revision: requested, result: new Uint32Array([0]) }); await members;
    expect(retainedDictionary[0]).toBe('old-note.md');
    expect(currentDetailGeneration(requested, active, detail)).toBe(false);
    detail = 2; expect(currentDetailGeneration(2, active, detail)).toBe(true);
  } finally { p.dispose(); }
});

test('ASCII and Unicode dictionaries preserve cell boundaries, controls and isolated surrogate replacement', () => {
  for (const strings of [['', 'a\0b', '\r\n', 'x'], ['\ud83d', '\udcda', 'é', '中文', '📚']]) {
    const expected = strings.map(s => new TextDecoder().decode(new TextEncoder().encode(s)));
    expect(decodeStrings(encodeStrings(strings))).toEqual(expected);
  }
  expect(() => decodeStrings({ bytes: new Uint8Array([0xc3, 0xa9]), offsets: new Uint32Array([0, 1, 2]) })).toThrow();
  expect(() => decodeStrings({ bytes: new Uint8Array([0xff]), offsets: new Uint32Array([0, 1]) })).toThrow();
});
test('render-only detail transfers packed paths without facts, identities or membership codes', async () => {
  const { renderPath } = await import('../src/render-projection');
  const p = pipeline();
  try {
    await p.request(1, { kind: 'configure', config });
    const rows = [{ path: 'A/é📚.md', properties: {} }, { path: 'B/中文.md', properties: {} }];
    await p.request(1, { kind: 'rows', reset: true, columns: packRows(rows, declaration) });
    await p.request(1, { kind: 'project' });
    const detail = await p.request<DetailResult>(1, { kind: 'detail' });
    expect(detail.projection.nodeCount).toBe(2);
    expect([renderPath(detail.projection, 0), renderPath(detail.projection, 1)]).toEqual(rows.map(r => r.path));
    expect(Object.keys(detail.projection).sort()).toEqual(['carrier', 'carrierNodes', 'groups', 'nodeCount', 'offsets', 'paths', 'quarantined', 'source', 'target', 'type', 'types']);
    expect(detail.projection.groups.every(g => Object.keys(g).join() === 'values')).toBe(true);
    for (const index of [-1, 2, .5, NaN]) expect(() => renderPath(detail.projection, index)).toThrow('RENDER_PATH_INDEX');
    // Detail transfer never detaches the worker authority or its membership data.
    expect((await p.request<DetailResult>(1, { kind: 'detail' })).projection.nodeCount).toBe(2);
    expect((await p.request<LayoutResult>(1, { kind: 'layout' })).positions.length).toBe(4);
  } finally { p.dispose(); }
});
test('worker GPU probe exposes unsupported OffscreenCanvas without fabricating availability', async () => {
  const p = pipeline(); try { expect(await p.request(1, { kind: 'gpu' })).toBeUndefined(); } finally { p.dispose(); }
});

test('cooperatively built carrier lookup keeps the synchronous duplicate-quarantine result', async () => {
  const { carrierIndexer, indexCarriers } = await import('../src/core/group-projection');
  const d = { ...declaration, carrierResolvers: [{ kind: 'opaque', key: 'id' }, { kind: 'path', key: '$path' }] };
  const rows = Array.from({ length: 100 }, (_, i) => ({ path: `${i}.md`, properties: { id: `opaque:${i % 90}` } }));
  const index = carrierIndexer(d); let yields = 0;
  await sliced(rows, { chunkRows: 7, budgetMs: 8 }, index.add, async () => { yields++; });
  expect(index.lookup).toEqual(indexCarriers(rows, d)); expect(yields).toBe(15);
  expect(index.lookup.get('opaque')!.get('opaque:0')).toBeNull();
});


test('cross-kind preview and members preserve active explore, same-kind requests cancel it', async () => {
  const fake = fakeTransport(), p = new WorkerPipeline(fake.transport, () => 10000);
  try {
    const applied = p.request(1, { kind: 'explore', view: {} as any, facetValues: 5 });
    fake.emit({ kind: 'started', id: 1, revision: 1 });
    const count = p.request(1, { kind: 'expression-count', expr: 'true', context: 'filter' });
    const members = p.request(1, { kind: 'members', group: 'g', view: 2 });
    expect(fake.sent.map(m => m.kind)).toEqual(['explore']);
    fake.emit({ id: 1, revision: 1, result: 'paint applied' }); expect(await applied).toBe('paint applied');
    fake.emit({ id: 2, revision: 1, result: 'count' }); expect(await count).toBe('count');
    fake.emit({ id: 3, revision: 1, result: 'members' }); expect(await members).toBe('members');
    const old = p.request(1, { kind: 'explore', view: {} as any, facetValues: 5 }).catch(String);
    const latest = p.request(1, { kind: 'explore', view: {} as any, facetValues: 5 });
    expect(fake.sent.at(-1)).toEqual({ kind: 'cancel-evaluation', id: 4 });
    fake.emit({ id: 4, revision: 1, error: 'Expression superseded' }); expect(await old).toContain('superseded');
    fake.emit({ id: 5, revision: 1, result: 'paint latest' }); expect(await latest).toBe('paint latest');
  } finally { p.dispose(); }
});
