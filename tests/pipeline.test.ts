import { test, expect } from 'bun:test';
import { WorkerPipeline, LAYOUT_PRODUCER, currentDetailGeneration, type Transport, type ProjectResult, type LayoutResult, type DetailResult } from '../src/pipeline';
import { defaultDeclaration, digest } from '../src/core/declaration';
import { generationKey } from '../src/core/generation';
import { layoutIdentity } from '../src/core/layout-options';
import { DEFAULT_LAYOUT, initialPositions } from '../src/core/layout';
import { packRows, unpackRows, transferables, encodeStrings, decodeStrings } from '../src/core/columns';
import { buildProjection, type FactRow } from '../src/core/projection';
import { sliced } from '../src/core/scheduler';
import { CACHE_FORMAT, BinaryLayoutStore, encodeLayout, decodeLayout, type BinaryAdapter, type BinaryGeneration, type GenerationMeta } from '../src/core/binary-layout';
const declaration = defaultDeclaration('fixture@1');
const layout = { ...DEFAULT_LAYOUT, iterations: 2, relaxIterations: 2, convergenceThreshold: 1e20, convergenceIterations: 2 };
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
  const meta: GenerationMeta = { format: CACHE_FORMAT, declarationHash, key, layoutHash: await digest({ layout: layoutIdentity(layout), streamEveryIterations: 1 }), layout, source: config.source, groupLevel: config.groupLevel, streamEveryIterations: config.streamEveryIterations, producer: LAYOUT_PRODUCER };
  return encodeLayout({ meta, identities: Array.from({ length: n }, (_, i) => `path:${i}.md`), positions: Float32Array.from({ length: n * 2 }, (_, i) => i / 2), edgeKeys: new Uint32Array(), groups: { groups: [], groupEdges: [] } });
}
const options = { directory: 'plugin/cache/local', chunkBytes: 64, maxGenerationBytes: 1024 * 1024 * 8, cachedDeclarations: 1 };
test('intact old Auto producer is a compatibility miss, but damaged bytes still quarantine', async () => {
  for (const damaged of [false, true]) {
    const disk = new MemoryAdapter(), store = new BinaryLayoutStore(disk, options), old = await generation();
    const current = await generation(1, old.meta.declarationHash, 'c'.repeat(64)); old.meta.producer = 'graph-ng-fa2@4-webgpu';
    await store.write(old); const files = new Map(disk.files);
    if (damaged) { const bytes = disk.files.get([...files.keys()].find(p => p.endsWith('/positions.0.bin'))!)!; bytes[0] = bytes[0]! ^ 1; }
    expect(await store.latest(old.meta.declarationHash, current.meta)).toBeUndefined();
    if (damaged) expect(store.trace.at(-1)?.action).toBe('quarantined');
    else {
      expect(disk.files).toEqual(files); expect((await store.latest(old.meta.declarationHash, old.meta))?.meta).toEqual(old.meta);
      await store.write(current); expect((await store.latest(current.meta.declarationHash, current.meta))?.meta).toEqual(current.meta);
      expect([...disk.files.keys()].some(p => p.includes('.corrupt-'))).toBe(false);
    }
  }
});
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
test('legacy overlap hashes refuse before reuse while ordinary generations still load', async () => {
  for (const adjustSizes of [false, true]) {
    const p = pipeline(), selected = { ...layout, force: { ...layout.force, adjustSizes } };
    try {
      const hashes = await p.request<{ declarationHash: string }>(1, { kind: 'configure', config: { ...config, layout: selected } });
      const g = await generation(1, hashes.declarationHash), { overlap: _revision, ...legacy } = layoutIdentity(selected);
      g.meta.layout = selected;
      g.meta.layoutHash = await digest({ layout: legacy, streamEveryIterations: 1 });
      const loaded = await p.request(1, { kind: 'load', generation: structuredClone(g) });
      expect(loaded !== undefined).toBe(!adjustSizes);
      g.meta.layoutHash = await digest({ layout: layoutIdentity(selected), streamEveryIterations: 1 });
      expect(await p.request(1, { kind: 'load', generation: g })).toBeDefined();
    } finally { p.dispose(); }
  }
});
test('Auto and Processor reopen a pre-graphics generation exactly; Graphics refuses it', async () => {
  const rows = [{ path: '0.md', properties: {} }];
  const key = await generationKey(rows, declaration, layout, `graph-ng-fa2@2/stream1/group0/${config.source}/format${CACHE_FORMAT}`);
  for (const layoutEngine of ['auto', 'processor', 'graphics'] as const) {
    const p = pipeline();
    try {
      const { declarationHash } = await p.request<{ declarationHash: string }>(1, { kind: 'configure', config: { ...config, layoutEngine } });
      const expected = Float32Array.of(3, 4), { meta: header } = await generation(1, declarationHash, key);
      const legacy = encodeLayout({ meta: { ...header, producer: 'graph-ng-fa2@2' }, identities: ['0.md'], positions: expected.slice(), edgeKeys: new Uint32Array() });
      const loaded = await p.request(1, { kind: 'load', generation: legacy });
      expect(loaded !== undefined).toBe(layoutEngine !== 'graphics');
      await p.request(1, { kind: 'rows', reset: true, columns: packRows(rows, declaration) });
      const { meta } = await p.request<ProjectResult>(1, { kind: 'project' });
      expect(meta.key === key).toBe(layoutEngine !== 'graphics');
      if (layoutEngine !== 'graphics') {
        const result = await p.request<LayoutResult>(1, { kind: 'layout' });
        expect(result.cached).toBe(true); expect(result.positions).toEqual(expected);
      }
    } finally { p.dispose(); }
  }
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
test('early Stop on a cold worker cannot arrange, stream or persist a seed as a solved layout', async () => {
  const p = pipeline(), rows = [{ path: 'a.md', properties: {} }];
  let frames = 0; p.onPositions = () => { frames++; };
  try {
    await p.request(1, { kind: 'configure', config });
    await p.request(1, { kind: 'rows', reset: true, columns: packRows(rows, declaration) });
    const { meta } = await p.request<ProjectResult>(1, { kind: 'project' });
    const pending = p.request<LayoutResult>(1, { kind: 'layout' }); p.stopLayout(1);
    const result = await pending;
    expect(result.positions).toEqual(initialPositions(1, parseInt(meta.key.slice(0, 8), 16) ^ layout.seed, layout.initialRadius));
    expect(result.settled).toBe(false); expect(frames).toBe(0);
    expect(await p.request(1, { kind: 'encode' }).catch(String)).toContain('Layout not settled');
  } finally { p.dispose(); }
});
test('switching engine families skips an intact binary generation without quarantine', async () => {
  const adapter = new MemoryAdapter(), store = new BinaryLayoutStore(adapter, options), legacy = await generation();
  await store.write(legacy); adapter.reads = [];
  expect(await store.latest(legacy.meta.declarationHash, { source: config.source, producer: 'graph-ng-fa2@4-webgpu', layoutHash: await digest({ layout: layoutIdentity(layout), streamEveryIterations: 1, engine: 'graphics' }) })).toBeUndefined();
  expect(adapter.reads.some(p => p.endsWith('.bin'))).toBe(false);
  expect((await store.latest(legacy.meta.declarationHash))?.meta.key).toBe(legacy.meta.key);
});
test('legacy slice-1 positions are refused after the quality producer migration', async () => {
  const p = pipeline();
  try {
    const hashes = await p.request<{ declarationHash: string }>(1, { kind: 'configure', config });
    const old = { key: '1'.repeat(64), identities: ['0.md'], positions: [3, 4], producer: 'graphology-fa2@0.10.1', layoutHash: await digest(layoutIdentity(layout)), edgeKeys: [] };
    const binary = await p.request<BinaryGeneration>(1, { kind: 'migrate', declarationHash: hashes.declarationHash, generation: old });
    expect(binary).toBeUndefined(); // pre-quality producers are never restamped as settled
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
test('Groups withdraws recompute demand and cannot resurrect its obsolete renderer', async () => {
  const fake = fakeTransport(), p = new WorkerPipeline(fake.transport, () => 10000);
  try {
    const work = p.request(7, { kind: 'recompute', options: layout, preview: { from: 1, wanted: true } });
    p.previewWanted(8,false); expect(fake.sent).toHaveLength(1);
    p.previewWanted(7,false); expect(fake.sent.at(-1)).toEqual({ kind: 'preview-wanted', id: 1, wanted: false });
    p.previewWanted(7,true); expect(fake.sent).toHaveLength(2);
    p.previewWanted(7, true, { from: 1, wanted: false }); expect(fake.sent).toHaveLength(2); // same revision, different request
    fake.emit({ id: 1, revision: 7, result: 'final' }); expect(await work).toBe('final');
  } finally { p.dispose(); }
});
test('Stop survives a queued recompute and targets only its acknowledged request', async () => {
  const fake = fakeTransport(), p = new WorkerPipeline(fake.transport, () => 10000);
  try {
    const search = p.request(7, { kind: 'search', query: 'a', visible: new Uint8Array() });
    const next = p.request(7, { kind: 'recompute', options: layout });
    p.stopLayout(8); p.stopLayout(7);
    expect(fake.sent.map(m => m.kind)).toEqual(['search']);
    fake.emit({ id: 1, revision: 7, result: [] }); await search;
    expect(fake.sent.map(m => m.kind)).toEqual(['search', 'recompute']);
    fake.emit({ kind: 'started', id: 2, revision: 7 });
    expect(fake.sent.at(-1)).toEqual({ kind: 'stop-layout', id: 2 });
    fake.emit({ id: 2, revision: 7, result: 'stopped' }); expect(await next).toBe('stopped');
    const fresh = p.request(7, { kind: 'layout' }); fake.emit({ kind: 'started', id: 3, revision: 7 });
    expect(fake.sent.at(-1).kind).toBe('layout');
    fake.emit({ id: 3, revision: 7, result: 'fresh' }); await fresh;
  } finally { p.dispose(); }
});
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
    expect(await p.request(1, { kind: 'migrate', declarationHash: hashes.declarationHash, generation: { key: '1'.repeat(64), identities: ['0.md'], positions: [3, 4], producer: 'graphology-fa2@0.10.1', layoutHash: await digest(layoutIdentity(layout)) } })).toBeUndefined();
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
    expect(Object.keys(detail.projection).sort()).toEqual(['carrier', 'carrierNodes', 'groups', 'interest', 'nodeCount', 'offsets', 'paths', 'quarantined', 'source', 'target', 'tint', 'type', 'types', 'up']);
    expect(detail.projection.groups.every(g => Object.keys(g).join() === 'values')).toBe(true);
    for (const index of [-1, 2, .5, NaN]) expect(() => renderPath(detail.projection, index)).toThrow('RENDER_PATH_INDEX');
    // Detail transfer never detaches the worker authority or its membership data.
    expect((await p.request<DetailResult>(1, { kind: 'detail' })).projection.nodeCount).toBe(2);
    expect((await p.request<LayoutResult>(1, { kind: 'layout' })).positions.length).toBe(4);
  } finally { p.dispose(); }
});
test('find-a-note ranks in the worker over names and identities, returning only note indices', async () => {
  const { renderPath } = await import('../src/render-projection');
  const p = pipeline(), d = { ...declaration, identity: [{ key: 'uid' }] };
  try {
    await p.request(1, { kind: 'configure', config: { ...config, declaration: d } });
    const rows = [{ path: 'N/Alpha.md', properties: { uid: 'X-1' } }, { path: 'N/Beta.md', properties: { uid: 'ALPHA-9' } }, { path: 'N/Zalpha.md', properties: { uid: 'z' } }, { path: 'N/Gamma.md', properties: { uid: 'g' } }];
    await p.request(1, { kind: 'rows', reset: true, columns: packRows(rows, d) });
    await p.request(1, { kind: 'project' });
    const order = (await p.request<DetailResult>(1, { kind: 'detail' })).projection, at = (path: string) => [0, 1, 2, 3].find(i => renderPath(order, i) === path)!;
    const all = new Uint8Array(4).fill(1);
    expect(await p.request<number[]>(1, { kind: 'search', query: 'Alpha', visible: all.slice() })).toEqual(['N/Alpha.md', 'N/Zalpha.md', 'N/Beta.md'].map(at));
    const some = all.slice(); some[at('N/Alpha.md')] = 0;
    expect(await p.request<number[]>(1, { kind: 'search', query: 'alpha', visible: some })).toEqual(['N/Zalpha.md', 'N/Beta.md'].map(at));
    // Settle explicitly: awaiting these through `expect(...).rejects` stalled the worker reply under Bun.
    const failure = (q: Promise<unknown>) => q.then(() => '', e => String(e));
    expect(await failure(p.request(1, { kind: 'search', query: 'a', visible: new Uint8Array(1) }))).toContain('SEARCH_MASK');
    expect(await failure(p.request(2, { kind: 'search', query: 'a', visible: all.slice() }))).toContain('Projection generation changed');
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
test('relationship details: rule names and relationship-note paths per edge row, revision-bound and bounded', async () => {
  const p = pipeline();
  try {
    const d = { ...declaration, edges: [...declaration.edges, { name: 'crosswalk', kind: 'reified' as const, sourceProperty: 'from', targetProperty: 'to', typeProperty: 'relation' }, { name: 'reverse-map', kind: 'reified' as const, sourceProperty: 'src', targetProperty: 'dst' }] };
    const rows = [{ path: 'a.md', properties: {} }, { path: 'b.md', properties: {} }, { path: 'X/1.md', properties: { from: 'a.md', to: 'b.md', relation: 'maps' } }, { path: 'X/2.md', properties: { src: 'b.md', dst: 'a.md' } }];
    await p.request(1, { kind: 'configure', config: { ...config, declaration: d } }); await p.request(1, { kind: 'rows', reset: true, columns: packRows(rows, d) }); await p.request(1, { kind: 'project' });
    const detail = await p.request<DetailResult>(1, { kind: 'detail' }), m = detail.projection.source.length; expect(m).toBe(2);
    const info = await p.request<{ rule?: string; carrier?: string }[]>(1, { kind: 'relationships', edges: [0, 1] });
    const byType = Object.fromEntries(info.map((x, e) => [detail.projection.types[detail.projection.type[e]!], x]));
    expect(byType).toEqual({ maps: { rule: 'crosswalk', carrier: 'X/1.md' }, 'reverse-map': { rule: 'reverse-map', carrier: 'X/2.md' } });
    expect(await p.request(1, { kind: 'relationships', edges: [m] }).catch(String)).toContain('RELATIONSHIP_INDEX');
    expect(await p.request(0, { kind: 'relationships', edges: [0] }).catch(String)).toContain('generation changed');
  } finally { p.dispose(); }
});

test('first eligible frame spends the only credit; recycling alone never unlocks another', async () => {
  const p = pipeline(), frames: number[] = [], steps: number[] = [];
  let ready!: () => void;
  p.onPositions = e => { frames.push(e.iteration); steps.push(e.iteration); p.recycle(e.positions.buffer as ArrayBuffer); return new Promise<void>(r => { ready = r; }); };
  p.onProgress = step => { steps.push(step); };
  try {
    await p.request(1, { kind: 'configure', config: { ...config, layout: { ...layout, iterations: 13, convergenceThreshold: 0 }, streamEveryIterations: 2 } });
    await p.request(1, { kind: 'rows', columns: packRows([{ path: 'a.md', properties: {} }, { path: 'b.md', properties: {} }], declaration), reset: true });
    await p.request(1, { kind: 'project' });
    const result = await p.request<LayoutResult>(1, { kind: 'layout', preview: { from: 4, wanted: true } });
    expect(frames).toEqual([4]); expect(steps).toEqual([2,4,6,8,10,12]); expect(result.positions.every(Number.isFinite)).toBe(true);
    ready(); // After final, completing setup cannot re-credit a later RPC.
  } finally { p.dispose(); }
});
test('worker position events carry actual cold and warm solver iteration limits', async () => {
  const p = pipeline(), events: [number, number][] = [];
  p.onPositions = event => { events.push([event.iteration, event.total]); p.recycle(event.positions.buffer as ArrayBuffer); };
  try {
    await p.request(1, { kind: 'configure', config: { ...config, layout: { ...layout, iterations: 7, relaxIterations: 3, convergenceThreshold: 0 }, streamEveryIterations: 2 } });
    await p.request(1, { kind: 'rows', columns: packRows([{ path: 'a.md', properties: {} }, { path: 'b.md', properties: {} }], declaration), reset: true });
    await p.request(1, { kind: 'project', complete: true }); await p.request(1, { kind: 'layout' });
    expect(events).toEqual([[2, 7], [4, 7], [6, 7]]);
    events.length = 0;
    await p.request(2, { kind: 'configure', config: { ...config, layout: { ...layout, iterations: 7, relaxIterations: 3, convergenceThreshold: 0 }, streamEveryIterations: 2 } });
    await p.request(2, { kind: 'rows', columns: packRows([{ path: 'c.md', properties: {} }], declaration) });
    await p.request(2, { kind: 'project', complete: true }); await p.request(2, { kind: 'layout' });
    expect(events).toEqual([[2, 7], [4, 7], [6, 7]]); // unsettled continuation gets a full budget
  } finally { p.dispose(); }
});

test('real edits queued during provisional layout warm-start by identity without a zero-step reset', async () => {
  const p = pipeline(), streams: { revision: number; iteration: number }[] = [];
  const d = { ...declaration, identity: [{ key: 'id' }], edges: [{ name: 'edge', kind: 'inline' as const, key: 'to', type: 'edge' }] };
  const c = { ...config, declaration: d, layout: { ...layout, iterations: 20, relaxIterations: 6, convergenceThreshold: 0 }, streamEveryIterations: 1 };
  const facts = Array.from({ length: 20 }, (_, i) => ({ path: `${String(i).padStart(2, '0')}.md`, properties: { id: String(i), ...(i === 0 ? { to: '1' } : {}) } }));
  let follow: Promise<unknown> | undefined;
  p.onPositions = e => {
    streams.push({ revision: e.revision, iteration: e.iteration }); p.recycle(e.positions.buffer as ArrayBuffer);
    if (e.revision === 1 && e.iteration === 5) {
      // A real metadata edit arrives before the first layout finishes. RPCs serialize it behind layout.
      follow = p.request(2, { kind: 'configure', config: c }).then(async () => {
        await p.request(2, { kind: 'rows', columns: packRows([{ path: '00.md', properties: { id: '0', to: '2' } }], d) });
        await p.request(2, { kind: 'project', complete: false });
      });
    }
  };
  try {
    await p.request(1, { kind: 'configure', config: c });
    await p.request(1, { kind: 'rows', columns: packRows(facts, d), reset: true });
    await p.request(1, { kind: 'project', complete: false });
    const first = await p.request<LayoutResult>(1, { kind: 'layout' });
    expect(follow).toBeDefined(); await follow;
    const next = await p.request<LayoutResult>(2, { kind: 'layout' });
    expect(next.cached).toBe(false); expect(next.reused).toBeUndefined();
    expect(streams.filter(e => e.revision === 2).map(e => e.iteration)).toEqual(Array.from({ length: 19 }, (_, i) => i + 1));
    expect(next.positions.every(Number.isFinite)).toBe(true);
    await p.request(3, { kind: 'configure', config: { ...c, source: 'different-view' } });
    await p.request(3, { kind: 'project', complete: false });
    const isolated = await p.request<LayoutResult>(3, { kind: 'layout' });
    expect(isolated.reused).toBeUndefined(); expect(streams.some(e => e.revision === 3 && e.iteration === 0)).toBe(false);
  } finally { p.dispose(); }
});

test('review: committed refinement becomes the settled generation for encode and reopen', async () => {
  const p = pipeline(), rows: FactRow[] = [{ path: 'a.md', properties: {}, links: { 'fixture@1': ['b.md'] } }, { path: 'b.md', properties: {}, links: {} }];
  try {
    await p.request(1, { kind: 'configure', config }); await p.request(1, { kind: 'rows', columns: packRows(rows, declaration), reset: true }); await p.request(1, { kind: 'project' });
    const first = await p.request<LayoutResult>(1, { kind: 'layout' });
    const options = { ...layout, force: { ...layout.force, scalingRatio: 12 } };
    const refined = await p.request<LayoutResult>(1, { kind: 'recompute', options, initial: first.positions });
    expect(refined.settled).toBe(true);
    await p.request(1, { kind: 'adoptLayout' } as any);
    const encoded = await p.request<BinaryGeneration>(1, { kind: 'encode' });
    expect(decodeLayout(encoded).positions).toEqual(refined.positions); expect(encoded.meta.layout).toEqual(options);
    await p.request(2, { kind: 'configure', config: { ...config, layout: options } }); await p.request(2, { kind: 'project' });
    const restored = await p.request<LayoutResult>(2, { kind: 'layout' }); expect(restored.cached).toBe(true); expect(restored.positions).toEqual(refined.positions);
  } finally { p.dispose(); }
});

test('unsettled generations never encode; hydration continues from prior coordinates instead of pinning them', async () => {
  const p = pipeline(), c = { ...config, layout: { ...layout, iterations: 1, convergenceThreshold: 0 }, streamEveryIterations: 1 };
  const rows = [{ path: 'a.md', properties: {}, links: { 'fixture@1': ['b.md'] } }, { path: 'b.md', properties: {} }, { path: 'c.md', properties: {} }];
  try {
    await p.request(1, { kind: 'configure', config: c }); await p.request(1, { kind: 'rows', reset: true, columns: packRows(rows, declaration) });
    await p.request(1, { kind: 'project', complete: false }); const first = await p.request<LayoutResult>(1, { kind: 'layout' });
    expect(first.settled).toBe(false); expect(await p.request(1, { kind: 'encode' }).catch(String)).toContain('not settled');
    const continued = await p.request<LayoutResult>(1, { kind: 'recompute', options: c.layout, initial: first.positions.slice() });
    await p.request(2, { kind: 'project', complete: true }); const verified = await p.request<LayoutResult>(2, { kind: 'layout' });
    expect(verified.positions).toEqual(continued.positions); expect(verified.positions).not.toEqual(first.positions); expect(verified.cached).toBe(false);
    const twice = await p.request<LayoutResult>(2, { kind: 'recompute', options: c.layout, initial: verified.positions.slice() });
    expect(twice.positions).not.toEqual(verified.positions);
    const detail = await p.request<DetailResult>(2, { kind: 'detail' });
    await p.request(2, { kind: 'explore', view: { ...(await import('../src/core/explore')).emptyView(), query: 'b' }, facetValues: 10 });
    expect((await p.request<DetailResult>(2, { kind: 'detail' })).projection.source).toEqual(detail.projection.source);
    expect((await p.request<LayoutResult>(2, { kind: 'recompute', options: c.layout, initial: verified.positions.slice() })).positions).toEqual(twice.positions);
  } finally { p.dispose(); }
});

test('Lines to Notes reuses declared input while changed keys and producers invalidate it', async () => {
  const p = pipeline(), d = { ...declaration, identity: [{ key: 'uid' }], edges: [{ name: 'relation', kind: 'reified' as const, sourceProperty: 'source', targetProperty: 'target' }] };
  try {
    const first: any = await p.request(1, { kind: 'configure', config: { ...config, declaration: d } });
    await p.request(1, { kind: 'rows', reset: true, columns: packRows([{ path: 'a.md', properties: { uid: 'a' } }, { path: 'b.md', properties: { uid: 'b' } }, { path: 'r.md', properties: { source: 'a', target: 'b' } }], d) });
    expect((await p.request<ProjectResult>(1, { kind: 'project' })).nodes).toBe(2);
    const notes = { ...d, display: { reifiedAsNodes: true } };
    const next: any = await p.request(2, { kind: 'configure', config: { ...config, declaration: notes } });
    expect(next.ingestHash).toBe(first.ingestHash); expect(next.declarationHash).not.toBe(first.declarationHash);
    expect((await p.request<ProjectResult>(2, { kind: 'project' })).nodes).toBe(3);
    for (const changed of [{ ...notes, columns: ['another'] }, { ...notes, edges: [...notes.edges, { name: 'native', kind: 'producer' as const, producer: 'native@1', type: 'link' }] }]) {
      expect((await p.request<any>(3, { kind: 'configure', config: { ...config, declaration: changed } })).ingestHash).not.toBe(first.ingestHash);
    }
  } finally { p.dispose(); }
});

test('stop layout keeps an unsettled result and refinement resumes its adopted positions', async () => {
  const p = pipeline(), options = { ...layout, iterations: 1000, batchIterations: 1, convergenceThreshold: 0 };
  const rows = Array.from({ length: 200 }, (_, i) => ({ path: `${i}.md`, properties: {}, links: { 'fixture@1': [`${(i + 1) % 200}.md`] } }));
  try {
    await p.request(1, { kind: 'configure', config: { ...config, layout: options } });
    await p.request(1, { kind: 'rows', reset: true, columns: packRows(rows, declaration) }); await p.request(1, { kind: 'project' });
    let frames = 0;
    p.onPositions = e => { frames++; p.stopLayout(e.revision); p.recycle(e.positions.buffer as ArrayBuffer); };
    const stopped = await p.request<LayoutResult>(1, { kind: 'layout' });
    expect(frames).toBeGreaterThan(0); expect(frames).toBeLessThan(999); expect(stopped.settled).toBe(false); expect(stopped.positions.every(Number.isFinite)).toBe(true);
    expect(await p.request(1, { kind: 'encode' }).catch(String)).toContain('not settled');
    p.onPositions = e => p.recycle(e.positions.buffer as ArrayBuffer);
    const one = { ...options, iterations: 1 };
    const resumed = await p.request<LayoutResult>(1, { kind: 'recompute', options: one });
    const explicit = await p.request<LayoutResult>(1, { kind: 'recompute', options: one, initial: stopped.positions.slice() });
    expect(resumed.positions).toEqual(explicit.positions); expect(resumed.positions).not.toEqual(stopped.positions);
    await p.request(1, { kind: 'adoptLayout' });
    const again = await p.request<LayoutResult>(1, { kind: 'recompute', options: one });
    const expected = await p.request<LayoutResult>(1, { kind: 'recompute', options: one, initial: resumed.positions.slice() });
    expect(again.positions).toEqual(expected.positions);
    expect(await p.request(1, { kind: 'encode' }).catch(String)).toContain('not settled');
  } finally { p.dispose(); }
});


for (const count of [500, 20000]) test(`mid-layout and refinement Stop return unsettled within 500 ms at ${count} nodes`, async () => {
  const p = pipeline(), options = { ...layout, iterations: 10000, batchIterations: 5, convergenceThreshold: 0 };
  const rows = Array.from({ length: count }, (_, i) => ({ path: `${i}.md`, properties: {}, links: { 'fixture@1': [`${(i + 1) % count}.md`] } }));
  try {
    await p.request(1, { kind: 'configure', config: { ...config, layout: options, streamEveryIterations: 5 } });
    await p.request(1, { kind: 'rows', reset: true, columns: packRows(rows, declaration) }); await p.request(1, { kind: 'project' });
    for (const kind of ['layout', 'recompute'] as const) {
      let stopAt = 0, lastIteration = 0;
      p.onPositions = e => { lastIteration = e.iteration; if (!stopAt) { stopAt = performance.now(); p.stopLayout(e.revision); } p.recycle(e.positions.buffer as ArrayBuffer); };
      const result = await p.request<LayoutResult>(1, kind === 'layout' ? { kind } : { kind, options });
      expect(stopAt).toBeGreaterThan(0); expect(performance.now() - stopAt).toBeLessThan(500);
      expect(lastIteration).toBeLessThan(options.iterations / 2); expect(result.settled).toBe(false); expect(result.positions.every(Number.isFinite)).toBe(true);
    }
  } finally { p.dispose(); }
});


test('visual pass adopts, saves and reopens ready to refine; full and legacy generation identities stay isolated', async () => {
  const p = pipeline(), rows = [{ path:'alone.md', properties:{} }];
  const o = { ...DEFAULT_LAYOUT, iterations: 100, force: { ...DEFAULT_LAYOUT.force, gravity: 0 } };
  const configure = (finishFully: boolean) => p.request(1, {kind:'configure',config:{...config,layout:{...o,finishFully}}});
  const project = () => p.request<ProjectResult>(1, {kind:'project'}), solve = () => p.request<LayoutResult>(1, {kind:'layout'});
  try {
    await configure(false); await p.request(1, {kind:'rows',reset:true,columns:packRows(rows,declaration)}); const visual = await project();
    expect(await solve()).toMatchObject({looksDone:true,settled:false,cached:false});
    expect(await p.request(1, {kind:'recompute',options:o})).toMatchObject({looksDone:true,settled:false});
    await p.request(1, {kind:'adoptLayout'}); const early = await p.request<BinaryGeneration>(1, {kind:'encode'});
    expect(early.meta.looksDone).toBe(true); await configure(true);
    expect(await p.request(1, {kind:'load', generation:structuredClone(early)})).toBeUndefined();
    const full = await project(); expect(full.meta.key).not.toBe(visual.meta.key); expect(full.meta.layoutHash).not.toBe(visual.meta.layoutHash);
    expect(await solve()).toMatchObject({looksDone:false,settled:true,cached:false});
    const legacy = await p.request<BinaryGeneration>(1, {kind:'encode'}); delete legacy.meta.layout.finishFully; delete legacy.meta.looksDone;
    expect(() => decodeLayout({ ...legacy, meta: { ...legacy.meta, looksDone:true } })).toThrow('Invalid visual completion');
    await configure(false); expect(await p.request(1,{kind:'load',generation:structuredClone(legacy)})).toBeUndefined();
    expect(await p.request(1,{kind:'load',generation:early})).toBeDefined(); expect((await project()).exactSaved).toBe(true);
    expect(await solve()).toMatchObject({looksDone:true,settled:false,cached:true});
    await configure(true); expect(await p.request(1,{kind:'load',generation:legacy})).toBeDefined(); expect((await project()).exactSaved).toBe(true);
    expect(await solve()).toMatchObject({looksDone:false,settled:true,cached:true});
  } finally { p.dispose(); }
});

test('cold visual layout keeps its stop step and coordinates across preview and batch cadences', async () => {
  const rows = Array.from({ length: 3 }, (_, i) => ({ path: `${i}.md`, properties: {}, links: { 'fixture@1': i < 2 ? [`${i+1}.md`] : [] } }));
  async function cold(streamEveryIterations: number, batchIterations: number) {
    const p = pipeline(), options = { ...DEFAULT_LAYOUT, iterations: 2000, batchIterations };
    try {
      await p.request(1, { kind: 'configure', config: { ...config, layout: options, streamEveryIterations } });
      await p.request(1, { kind: 'rows', reset: true, columns: packRows(rows, declaration) }); await p.request(1, { kind: 'project' });
      let last = 0; p.onProgress = step => { last = step; };
      const result = await p.request<LayoutResult>(1, { kind: 'layout', preview: { from: 1, wanted: false } });
      // No progress event on the terminal step. Each cadence is shorter than the visual stride.
      return { stop: result.looksDone ? (Math.floor(last / 16) + 1) * 16 : options.iterations, positions: result.positions };
    } finally { p.dispose(); }
  }
  const baseline = await cold(5, 5); expect(baseline.stop).toBeLessThan(2000);
  expect(await cold(13, 5)).toEqual(baseline); expect(await cold(5, 7)).toEqual(baseline);
});
