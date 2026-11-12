import { probeGpu } from './gpu-probe';
import { renderProjection } from './render-projection';
import { runLayout, runLayoutStream, type LayoutInput } from './core/layout';
import { yieldTask } from './core/scheduler';
import { checked, cooperative, filterSteps, groupSteps, lowerPredicate, lowerGroup, type EvaluationControl } from './core/expr/engine';
import { identityDeclaration, digest, canonical, layoutDeclaration } from './core/declaration';
import { declaredKeys } from './core/columns';
import { buildProjection, colorGroups, type FactRow, type Projection, type DictionaryColumn } from './core/projection';
import { contractGroups, validateGroupProjection, type GroupProjection } from './core/group-projection';
import { unpackRows, transferables } from './core/columns';
import { generationKey } from './core/generation';
import { warmLayout, validSavedLayout } from './core/incremental';
import { CACHE_FORMAT, decodeLayout, encodeLayout, type BinaryLayout, type GenerationMeta } from './core/binary-layout';
import { edgeHashes, hashEdge, edgeHashSet } from './core/edge-hash';
import { LAYOUT_PRODUCER, type PipelineRequest, type PipelineConfig } from './pipeline';
import { emptyView, explore, groupColumn, withoutTypes, type ExploreResult, type ExploreView } from './core/explore';
const rows = new Map<string, FactRow>();
let config: PipelineConfig, meta: GenerationMeta, projection: Projection, visible: Uint8Array;
let contracted: ReturnType<typeof contractGroups>, positions: Float32Array | undefined, saved: BinaryLayout | undefined;
const recycled: ArrayBuffer[] = [];
const takeBuffer = (length: number) => { const i = recycled.findIndex(b => b.byteLength === length * 4); return i < 0 ? new Float32Array(length) : new Float32Array(recycled.splice(i, 1)[0]!); };
let complete = true, projectionRevision = -1, colors: Uint32Array = new Uint32Array(), explored: ExploreResult | undefined;
/** One view authority: masks, the group dictionary used by members/contributions and the summary all derive together. */
/** Every applied view (project, regroup, filter, derived source) gets its own generation;
 * member/contribution reads must name it, so no lookup can cross groupings. */
let viewGeneration = 0;
function applyView(view: ExploreView, prepared?: { base: Uint8Array; group: DictionaryColumn }) {
  viewGeneration++;
  const filters = config.predicate ? [...view.filters, config.predicate] : view.filters;
  explored = explore(projection, config.declaration, { ...view, filters }, colors, config.groupLevel, { facetValues: config.facetValues ?? 50 }, prepared);
  visible = explored.visible;
  const source = { values: explored.groupKeys, codes: explored.groupCodes, encoded: explored.groupLabels !== explored.groupKeys };
  contracted = contractGroups({ ...withoutTypes(projection, view.hiddenTypes), groups: [source] }, visible, 0);
  return explored;
}
/** Prepare expression work cooperatively; only commit config/view state on success. */
function* viewSteps(view: ExploreView, rules: PipelineConfig['declaration']['colors'] | undefined): Generator<void, { base: Uint8Array; group: DictionaryColumn; colors: Uint32Array }> {
  const base = new Uint8Array(projection.paths.length).fill(1);
  for (const predicate of [...view.filters, ...(config.predicate ? [config.predicate] : [])]) {
    const bits = yield* filterSteps(projection, lowerPredicate(predicate));
    for (let i = 0; i < base.length; i++) { base[i]! &= bits[i]!; if (i % 1024 === 1023) yield; }
  }
  let nextColors = colors;
  if (rules) {
    nextColors = new Uint32Array(base.length).fill(rules.length);
    for (let k = 0; k < rules.length; k++) {
      const bits = yield* filterSteps(projection, lowerPredicate(rules[k]!.predicate));
      for (let i = 0; i < base.length; i++) { if (bits[i] && nextColors[i] === rules.length) nextColors[i] = k; if (i % 1024 === 1023) yield; }
    }
  }
  const g = view.group;
  const group = g && (g.from === 'expr' || g.from === 'derived') ? yield* groupSteps(projection, lowerGroup(g)) : groupColumn(projection, config.declaration, g, config.groupLevel);
  return { base, group, colors: nextColors };
}
let declarationHash = '', layoutHash = '', hashes: Uint32Array = new Uint32Array();
function matches(g: GenerationMeta) {
  return g.format === CACHE_FORMAT && g.declarationHash === declarationHash && g.layoutHash === layoutHash && g.producer === LAYOUT_PRODUCER && g.source === config.source && g.groupLevel === config.groupLevel && g.streamEveryIterations === config.streamEveryIterations && canonical(g.layout) === canonical(config.layout);
}
/** Cached paints are the unfiltered declared grouping; a persisted view is reapplied live. */
function cacheSummary() { return groupSummary(contractGroups(projection, new Uint8Array(projection.paths.length).fill(1), config.groupLevel).projection); }
function groupSummary(p: GroupProjection): GroupProjection {
  // Carrier/contribution objects remain worker-owned and are read a page at a time.
  return { ...p, groupEdges: p.groupEdges.map(e => ({ ...e, carriers: { kind: e.carriers.kind, ids: [] } })) };
}
async function handle(r: PipelineRequest, revision: number, control: EvaluationControl): Promise<unknown> {
  switch (r.kind) {
    case 'gpu': return typeof OffscreenCanvas === 'undefined' ? undefined : probeGpu(new OffscreenCanvas(1, 1));
    case 'external': {
      if (r.bytes.byteLength > r.maxBytes) throw new Error('Projection byte limit exceeded');
      const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(r.bytes)); validateGroupProjection(value, r.limits); return value;
    }
    case 'configure': {
      config = r.config;
      declarationHash = await digest(identityDeclaration(layoutDeclaration(config.declaration))); layoutHash = await digest({ layout: config.layout, streamEveryIterations: config.streamEveryIterations });
      if (saved && !matches(saved.meta)) saved = undefined;
      return { declarationHash, layoutHash, ingestHash: await digest({ declarationHash, keys: declaredKeys(config.declaration) }) };
    }
    case 'rows':
      if (r.reset) rows.clear();
      for (const path of r.removed ?? []) rows.delete(path);
      for (const row of unpackRows(r.columns)) rows.set(row.path, row);
      return rows.size;
    case 'load': {
      const decoded = decodeLayout(r.generation);
      if (!matches(decoded.meta)) return undefined;
      if (decoded.groups != null) { validateGroupProjection(decoded.groups, { groups: 20000, pairs: 200000, carriers: 1000000 }); }
      saved = decoded;
      return { meta: saved.meta, groups: saved.groups };
    }
    case 'migrate': {
      const old = r.generation;
      if (!config.source.endsWith('/local')) return undefined;
      // Old keys omit source/format; local-only hints can never be stamped for a new view.
      if (!['graphology-fa2@0.10.1', LAYOUT_PRODUCER].includes(old.producer) || !validSavedLayout(old) || old.layoutHash !== await digest(config.layout) || r.declarationHash !== declarationHash) return undefined;
      const keys = new Uint32Array((old.edgeKeys?.length ?? 0) * 2);
      old.edgeKeys?.forEach((key, i) => keys.set(hashEdge(key), i * 2));
      const m = { format: CACHE_FORMAT, declarationHash, layoutHash, layout: config.layout, key: old.key, producer: LAYOUT_PRODUCER, source: config.source, groupLevel: config.groupLevel, streamEveryIterations: config.streamEveryIterations };
      return encodeLayout({ meta: m, identities: old.identities, positions: Float32Array.from(old.positions), edgeKeys: keys });
    }
    case 'project': {
      projectionRevision = revision;
      complete = r.complete !== false;
      positions = undefined;
      const input = [...rows.values()];
      projection = buildProjection(input, config.declaration);
      colors = colorGroups(projection, config.declaration);
      applyView(config.view ?? emptyView());
      self.postMessage({ kind: 'groups', revision, view: viewGeneration, projection: groupSummary(contracted.projection) });
      const key = await generationKey(input, config.declaration, config.layout, `${LAYOUT_PRODUCER}/stream${config.streamEveryIterations}/group${config.groupLevel}/${config.source}/format${CACHE_FORMAT}`);
      meta = { format: CACHE_FORMAT, key, declarationHash, layoutHash, layout: config.layout, producer: LAYOUT_PRODUCER, source: config.source, groupLevel: config.groupLevel, streamEveryIterations: config.streamEveryIterations };
      hashes = edgeHashes(projection);
      let invalidSaved;
      if (saved && complete) { const current = new Set(projection.identities); if (saved.identities.some(id => !current.has(id))) { invalidSaved = saved.meta; saved = undefined; } }
      return { invalidSaved, meta, nodes: projection.paths.length, edges: projection.source.length, unresolved: projection.unresolved, quarantined: projection.quarantined };
    }
    case 'detail': {
      // Copies are made in the worker only: the renderer borrows transferred buffers;
      // the authoritative worker buffers remain live for incremental edits and cache encoding.
      return structuredClone({ projection: renderProjection(projection), visible, colors, explore: explored, view: viewGeneration });
    }
    case 'layout': {
      const start = performance.now(), seed = Number.parseInt(meta.key.slice(0, 8), 16);
      const stored = saved?.meta.key;
      const exact = complete && saved && matches(saved.meta) && stored === meta.key && saved.identities.length === projection.identities.length && saved.identities.every((id, i) => id === projection.identities[i]);
      if (exact) positions = saved!.positions;
      else {
        let input: LayoutInput;
        if (complete && saved && matches(saved.meta)) {
          input = warmLayout({ identities: saved.identities, positions: saved.positions }, projection, seed, config.layout);
          const old = edgeHashSet(saved.edgeKeys);
          for (let i = 0; i < hashes.length; i += 2) if (!old.has(`${hashes[i]}:${hashes[i + 1]}`)) { input.movable![projection.source[i / 2]!] = 1; input.movable![projection.target[i / 2]!] = 1; }
          const affected = input.movable!.slice();
          for (let i = 0; i < affected.length; i++) if (affected[i]) for (let j = projection.offsets[i]!; j < projection.offsets[i + 1]!; j++) input.movable![projection.targets[j]!] = 1;
        } else input = { count: projection.paths.length, source: projection.source, target: projection.target, offsets: projection.offsets, targets: projection.targets, seed };
        positions = input.movable && !input.movable.some(Boolean) ? input.initial! : await runLayoutStream(input, config.layout, config.streamEveryIterations, p => self.postMessage({ kind: 'positions', revision, positions: p }, { transfer: [p.buffer] }), yieldTask, takeBuffer);
      }
      const milliseconds = performance.now() - start;
      if (complete) saved = { meta, identities: projection.identities, positions, edgeKeys: hashes, groups: cacheSummary() };
      return { positions: positions.slice(), milliseconds, cached: Boolean(exact), stored };
    }
    case 'encode':
      if (!positions) throw new Error('No completed layout');
      return encodeLayout({ meta, identities: projection.identities, positions, edgeKeys: hashes, groups: cacheSummary() });
    case 'explore': {
      if (revision !== projectionRevision) throw new Error('Projection generation changed');
      // Colors are presentation-only: a legend edit re-evaluates rules on existing
      // columns without changing layout identity or re-ingesting notes.
      const prepared = await cooperative(viewSteps(r.view, r.colors), control);
      colors = prepared.colors;
      config = { ...config, declaration: r.colors ? { ...config.declaration, colors: r.colors } : config.declaration, view: r.view, facetValues: r.facetValues };
      const result = applyView(r.view, prepared);
      return structuredClone({ explore: result, colors, groups: groupSummary(contracted.projection), view: viewGeneration });
    }
    case 'expression-count': {
      if (revision !== projectionRevision) throw new Error('Projection generation changed');
      const ast = checked(r.expr, r.context);
      if (r.context === 'group') return { matched: projection.paths.length, total: projection.paths.length, groups: (await cooperative(groupSteps(projection, ast), control)).values.length };
      return { matched: (await cooperative(filterSteps(projection, ast), control)).reduce((a, b) => a + b, 0), total: projection.paths.length };
    }
    case 'members':
      if (revision !== projectionRevision) throw new Error('Projection generation changed');
      if (r.view !== viewGeneration) throw new Error('View generation changed');
      return Uint32Array.from(contracted.members.get(r.group) ?? []);
    case 'contributions': {
      if (revision !== projectionRevision) throw new Error('Projection generation changed');
      if (r.view !== viewGeneration) throw new Error('View generation changed');
      const items = contracted.contributions.get(r.pair) ?? [];
      return { total: items.length, items: items.slice(r.offset, r.offset + r.count) };
    }
  }
}
// Serialization prevents async digests/configuration from racing row deltas or newer revisions.
let queue = Promise.resolve();
const evaluations = new Map<string, number>();
const cancelled = new Set<number>();
self.onmessage = (event: MessageEvent<PipelineRequest & { id: number; revision: number; input?: LayoutInput; options?: any }>) => {
  const recycle = event.data as unknown as { kind: string; buffer?: ArrayBuffer; id: number };
  if (recycle.kind === 'cancel-evaluation') { if ([...evaluations.values()].includes(recycle.id)) cancelled.add(recycle.id); return; }
  if (recycle.kind === 'recycle') { if (recycle.buffer && recycled.length < 2) recycled.push(recycle.buffer); return; }
  // Backwards-compatible deterministic layout protocol used by existing harness consumers.
  if (event.data.input) { const start = performance.now(); try { const p = runLayout(event.data.input, event.data.options); self.postMessage({ positions: p, milliseconds: performance.now() - start }, { transfer: [p.buffer] }); } catch (error) { self.postMessage({ error: String(error) }); } return; }
  const r = event.data;
  if (r.kind === 'expression-count' || r.kind === 'explore') { const old = evaluations.get(r.kind); if (old !== undefined) cancelled.add(old); evaluations.set(r.kind, r.id); }
  queue = queue.then(async () => {
    self.postMessage({ kind: 'started', id: r.id, revision: r.revision });
    try { const result = await handle(r, r.revision, { cancelled: () => cancelled.has(r.id), budgetMs: (r.kind === 'expression-count' || r.kind === 'explore') ? r.budgetMs ?? 120000 : 120000 }); self.postMessage({ id: r.id, revision: r.revision, result }, { transfer: transferables(result) }); }
    catch (error) { self.postMessage({ id: r.id, revision: r.revision, error: String(error) }); }
    finally { cancelled.delete(r.id); if (evaluations.get(r.kind) === r.id) evaluations.delete(r.kind); }
  });
};
