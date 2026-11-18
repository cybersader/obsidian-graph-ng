import { layoutIdentity, validateLayout } from './core/layout-options';
import { probeGpu } from './gpu-probe';
import { renderProjection } from './render-projection';
import { runLayout, isolateRing, type LayoutInput } from './core/layout';
import { LayoutEngineSession } from './layout-engine';
import type { EngineStatus, EngineTiming, LayoutEnginePreference } from './layout-engine-policy';
const engines = new LayoutEngineSession();
import { yieldTask } from './core/scheduler';
import { checked, cooperative, filterSteps, groupSteps, lowerPredicate, lowerGroup, type EvaluationControl } from './core/expr/engine';
import { identityDeclaration, digest, canonical, layoutDeclaration } from './core/declaration';
import { declaredKeys } from './core/columns';
import { buildProjection, colorGroups, NONE, type FactRow, type Projection, type DictionaryColumn } from './core/projection';
import { contractGroups, validateGroupProjection, type GroupProjection } from './core/group-projection';
import { unpackRows, transferables } from './core/columns';
import { generationKey } from './core/generation';
import { warmLayout, validSavedLayout } from './core/incremental';
import { CACHE_FORMAT, decodeLayout, encodeLayout, type BinaryLayout, type GenerationMeta } from './core/binary-layout';
import { edgeHashes, hashEdge, edgeHashSet } from './core/edge-hash';
import { LAYOUT_PRODUCER, evaluation, type PipelineRequest, type PipelineConfig, type LayoutResult } from './pipeline';
import { carrierHiddenBy, emptyView, explore, groupColumn, hide, relationshipNotes, searchSteps, withoutTypes, type ExploreResult, type ExploreView } from './core/explore';
const rows = new Map<string, FactRow>();
let config: PipelineConfig, meta: GenerationMeta, projection: Projection, visible: Uint8Array;
let contracted: ReturnType<typeof contractGroups>, positions: Float32Array | undefined, saved: BinaryLayout | undefined;
/** Unverified coordinates are same-declaration, in-memory hints only, never a disk generation. */
let interim: BinaryLayout | undefined;
let settled = false;
let preparedLayout: { positions: Float32Array; settled: boolean; options: PipelineConfig['layout']; revision: number; layoutEngine?: LayoutEnginePreference; engineChoices?: EngineTiming[] } | undefined;
const recycled: ArrayBuffer[] = [];
const takeBuffer = (length: number) => { const i = recycled.findIndex(b => b.byteLength === length * 4); return i < 0 ? new Float32Array(length) : new Float32Array(recycled.splice(i, 1)[0]!); };
let complete = true, projectionRevision = -1, colors: Uint32Array = new Uint32Array(), explored: ExploreResult | undefined;
/** One view authority: masks, the group dictionary used by members/contributions and the summary all derive together. */
/** Every applied view (project, regroup, filter, derived source) gets its own generation;
 * member/contribution reads must name it, so no lookup can cross groupings. */
let viewGeneration = 0;
function applyView(view: ExploreView, prepared?: { base: Uint8Array; group: DictionaryColumn; hidden: number[]; why: Uint8Array }) {
  viewGeneration++;
  const filters = config.predicate ? [...view.filters, config.predicate] : view.filters;
  explored = explore(projection, config.declaration, { ...view, filters }, colors, config.groupLevel, { facetValues: config.facetValues ?? 50 }, prepared);
  visible = explored.visible;
  const source = { values: explored.groupKeys, codes: explored.groupCodes, encoded: explored.groupLabels !== explored.groupKeys };
  contracted = contractGroups({ ...withoutTypes(projection, view.hiddenTypes), groups: [source] }, visible, 0);
  if (filters.length) {
    // Relationship notes alone, cached per projection, so a filter can say what it hides of them in either display.
    if (carrierCache?.[0] !== projection) carrierCache = [projection, relationshipNotes(projection.carrierPaths.flatMap(path => rows.get(path) ?? []), config.declaration)];
    explored.carrierHidden = carrierHiddenBy(carrierCache[1], filters);
  }
  return explored;
}
let carrierCache: [Projection, Projection | undefined] | undefined;
/** Prepare expression work cooperatively; only commit config/view state on success. */
function* viewSteps(view: ExploreView, rules: PipelineConfig['declaration']['colors'] | undefined): Generator<void, { base: Uint8Array; group: DictionaryColumn; colors: Uint32Array; hidden: number[]; why: Uint8Array }> {
  const base = new Uint8Array(projection.paths.length).fill(1), why = new Uint8Array(base.length), hidden: number[] = [];
  for (const predicate of [...view.filters, ...(config.predicate ? [config.predicate] : [])]) { hidden.push(hide(base, yield* filterSteps(projection, lowerPredicate(predicate)), why, hidden.length + 1)); yield; }
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
  return { base, group, colors: nextColors, hidden, why };
}
let declarationHash = '', layoutHash = '', hashes: Uint32Array = new Uint32Array();
/** Same source, producer and layout parameters: positions are valid warm-start hints even when only
 * grouping, display columns or other non-topology declaration fields changed. */
function configLayoutHash(layout: PipelineConfig['layout']) {
  const engine = config.layoutEngine;
  return digest({ layout: layoutIdentity(layout), streamEveryIterations: config.streamEveryIterations, ...(engine && engine !== 'auto' ? { engine } : {}) });
}
function compatible(g: GenerationMeta) {
  return g.format === CACHE_FORMAT && g.layoutHash === layoutHash && g.producer === LAYOUT_PRODUCER && g.source === config.source && g.streamEveryIterations === config.streamEveryIterations && canonical(layoutIdentity(g.layout)) === canonical(layoutIdentity(config.layout));
}
/** Exact identity of a persisted generation: compatible, same declaration and group level. */
const matches = (g: GenerationMeta) => compatible(g) && g.declarationHash === declarationHash && g.groupLevel === config.groupLevel;
/** Cached paints are the unfiltered declared grouping; a persisted view is reapplied live. */
function cacheSummary() { return groupSummary(contractGroups(projection, new Uint8Array(projection.paths.length).fill(1), config.groupLevel).projection); }
function groupSummary(p: GroupProjection): GroupProjection {
  // Carrier/contribution objects remain worker-owned and are read a page at a time.
  return { ...p, groupEdges: p.groupEdges.map(e => ({ ...e, carriers: { kind: e.carriers.kind, ids: [] } })) };
}
async function solve(input: LayoutInput, options: PipelineConfig['layout'], revision: number, stopped: () => boolean, preference = config.layoutEngine, remembered = config.engineChoices) {
  const arrange = isolateRing(input);
  const result = await engines.run(input, options, {
    preference, remembered, every: config.streamEveryIterations, stopped, yieldNow: () => yieldTask(true),
    status: engineStatus => self.postMessage({ kind: 'engine', revision, engineStatus }),
    buffer: takeBuffer,
    emit: (p, iteration, total) => {
      arrange(p);
      self.postMessage({ kind: 'positions', revision, positions: p, iteration, total }, { transfer: [p.buffer] });
    },
  });
  if (result.positions !== input.initial) arrange(result.positions);
  return result;
}
async function handle(r: PipelineRequest, revision: number, control: EvaluationControl): Promise<unknown> {
  switch (r.kind) {
    case 'gpu': return typeof OffscreenCanvas === 'undefined' ? undefined : probeGpu(new OffscreenCanvas(1, 1));
    case 'external': {
      if (r.bytes.byteLength > r.maxBytes) throw new Error('Projection byte limit exceeded');
      const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(r.bytes)); validateGroupProjection(value, r.limits); return value;
    }
    case 'configure': {
      preparedLayout = undefined;
      // Equal ID strings from different declared properties need not identify the same notes.
      if (saved && canonical(config.declaration.identity) !== canonical(r.config.declaration.identity)) saved = undefined;
      config = r.config;
      declarationHash = await digest(identityDeclaration(layoutDeclaration(config.declaration, config.layout.force.familyPull > 0))); layoutHash = await configLayoutHash(config.layout);
      if (saved && !compatible(saved.meta)) saved = undefined;
      if (interim && !matches(interim.meta)) interim = undefined;
      // held: this worker already has compatible coordinates, so the view can skip the disk read.
      return { declarationHash, layoutHash, held: Boolean(interim || saved && matches(saved.meta)), ingestHash: await digest({ source: config.source, keys: declaredKeys(config.declaration), producers: config.declaration.edges.flatMap(e => e.kind === 'producer' ? [e.producer] : []).sort() }) };
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
      if (old.producer !== LAYOUT_PRODUCER || !validSavedLayout(old) || old.layoutHash !== await digest(layoutIdentity(config.layout)) || r.declarationHash !== declarationHash) return undefined;
      const keys = new Uint32Array((old.edgeKeys?.length ?? 0) * 2);
      old.edgeKeys?.forEach((key, i) => keys.set(hashEdge(key), i * 2));
      const m = { format: CACHE_FORMAT, declarationHash, layoutHash, layout: config.layout, key: old.key, producer: LAYOUT_PRODUCER, source: config.source, groupLevel: config.groupLevel, streamEveryIterations: config.streamEveryIterations };
      return encodeLayout({ meta: m, identities: old.identities, positions: Float32Array.from(old.positions), edgeKeys: keys });
    }
    case 'project': {
      preparedLayout = undefined;
      projectionRevision = revision;
      complete = r.complete !== false;
      positions = undefined;
      const input = [...rows.values()];
      projection = buildProjection(input, config.declaration);
      colors = colorGroups(projection, config.declaration);
      applyView(config.view ?? emptyView());
      self.postMessage({ kind: 'groups', revision, view: viewGeneration, projection: groupSummary(contracted.projection) });
      const key = await generationKey(input, config.declaration, config.layout, `${LAYOUT_PRODUCER}/${config.layoutEngine ?? 'auto'}/stream${config.streamEveryIterations}/group${config.groupLevel}/${config.source}/format${CACHE_FORMAT}`);
      meta = { format: CACHE_FORMAT, key, declarationHash, layoutHash, layout: config.layout, producer: LAYOUT_PRODUCER, source: config.source, groupLevel: config.groupLevel, streamEveryIterations: config.streamEveryIterations };
      hashes = edgeHashes(projection);
      let invalidSaved;
      if (saved && complete) { const current = new Set(projection.identities); if (saved.identities.some(id => !current.has(id))) { if (matches(saved.meta)) invalidSaved = saved.meta; saved = undefined; } }
      return { invalidSaved, meta, nodes: projection.paths.length, edges: projection.source.length, unresolved: projection.unresolved, quarantined: projection.quarantined, dropped: projection.dropped, missed: projection.missed, rows: projection.carrierPaths.length + projection.quarantined.length, ruleNotes: projection.ruleNotes };
    }
    case 'detail': {
      // Copies are made in the worker only: the renderer borrows transferred buffers;
      // the authoritative worker buffers remain live for incremental edits and cache encoding.
      return structuredClone({ projection: renderProjection(projection), visible, colors, explore: explored, view: viewGeneration });
    }
    case 'recompute': {
      if (revision !== projectionRevision || !positions) throw new Error('Projection generation changed');
      validateLayout(r.options);
      const start = performance.now();
      const next = await solve({ count: projection.paths.length, source: projection.source, target: projection.target, offsets: projection.offsets, targets: projection.targets, up: projection.up, seed: Number.parseInt(meta.key.slice(0, 8), 16), initial: r.initial ?? positions.slice() }, r.options, revision, control.cancelled, r.layoutEngine, r.engineChoices);
      preparedLayout = { ...next, options: r.options, revision, layoutEngine: r.layoutEngine, engineChoices: r.engineChoices };
      return { ...next, positions: next.positions.slice(), milliseconds: performance.now() - start, cached: false };
    }
    case 'adoptLayout': {
      const pending = preparedLayout;
      if (!pending || pending.revision !== revision || revision !== projectionRevision) throw new Error('Layout generation changed');
      const options = pending.options;
      config = { ...config, layoutEngine: pending.layoutEngine, engineChoices: pending.engineChoices };
      const nextDeclarationHash = await digest(identityDeclaration(layoutDeclaration(config.declaration, options.force.familyPull > 0)));
      const nextLayoutHash = await configLayoutHash(options);
      const key = await generationKey([...rows.values()], config.declaration, options, `${LAYOUT_PRODUCER}/${config.layoutEngine ?? 'auto'}/stream${config.streamEveryIterations}/group${config.groupLevel}/${config.source}/format${CACHE_FORMAT}`);
      config = { ...config, layout: options }; declarationHash = nextDeclarationHash; layoutHash = nextLayoutHash;
      meta = { ...meta, key, declarationHash, layoutHash, layout: options };
      positions = pending.positions; settled = pending.settled; preparedLayout = undefined;
      const generation = { meta, identities: projection.identities, positions, edgeKeys: hashes };
      if (complete && settled) { saved = { ...generation, groups: cacheSummary() }; interim = undefined; }
      else { saved = undefined; interim = generation; }
      return meta;
    }
    case 'layout': {
      const start = performance.now(), seed = Number.parseInt(meta.key.slice(0, 8), 16);
      let engineStatus: EngineStatus | undefined;
      // Continue the latest live computation; unchanged saved borrowing creates no interim.
      const prior = interim ?? saved, fromSaved = !!prior && prior === saved, stored = fromSaved ? prior.meta.key : undefined;
      const exact = complete && fromSaved && prior && matches(prior.meta) && prior.meta.key === meta.key && prior.identities.length === projection.identities.length && prior.identities.every((id, i) => id === projection.identities[i]);
      let reused: LayoutResult['reused'] = exact ? fromSaved ? 'all' : 'interim' : undefined;
      settled = !!exact;
      if (exact) positions = prior!.positions;
      else {
        let input: LayoutInput | undefined;
        // An unverified build (metadata or links still resolving, e.g. right after an app reload) also
        // starts from saved positions; it is never persisted and the verified build re-checks identities.
        if (prior) {
          input = warmLayout({ identities: prior.identities, positions: prior.positions }, projection, seed, config.layout);
          const old = edgeHashSet(prior.edgeKeys); let added = 0;
          for (let i = 0; i < hashes.length; i += 2) if (!old.has(`${hashes[i]}:${hashes[i + 1]}`)) { added++; input.movable![projection.source[i / 2]!] = 1; input.movable![projection.target[i / 2]!] = 1; }
          const affected = input.movable!.slice();
          for (let i = 0; i < affected.length; i++) if (affected[i]) for (let j = projection.offsets[i]!; j < projection.offsets[i + 1]!; j++) input.movable![projection.targets[j]!] = 1;
          // Relaxing a mostly new graph from hints would be worse than a full cold layout. An
          // unverified build may lack most links, so only verified builds count edge churn (added + removed).
          const edges = hashes.length / 2, before = prior.edgeKeys.length / 2;
          if (input.movable!.reduce((n, m) => n + m, 0) * 2 > input.count || (complete && (added * 2 + before - edges) * 2 > Math.max(edges, before))) {
            // Native hydration may change most edges. Continue from the last live positions,
            // but run the full budget rather than a short, partially pinned relaxation.
            if (prior === interim) input.movable = undefined; else input = undefined;
          }
        }
        if (!input) input = { count: projection.paths.length, source: projection.source, target: projection.target, offsets: projection.offsets, targets: projection.targets, up: projection.up, seed };
        // A parent-only edit changes no link endpoint. On active-family key misses relax
        // every note, rather than incorrectly treating all existing notes as pinned.
        if (prior === interim || config.layout.force.familyPull && projection.up) input.movable = undefined;
        if (input.movable && !input.movable.some(Boolean)) { positions = input.initial!; settled = fromSaved; reused = fromSaved ? 'all' : 'interim'; }
        else { if (input.movable && input.initial) reused = fromSaved ? 'some' : 'interim-some'; const result = await solve(input, config.layout, revision, control.cancelled); positions = result.positions; settled = result.settled; engineStatus = result.engineStatus; }
      }
      const milliseconds = performance.now() - start;
      // An exact hit already holds this generation; skip re-contracting its group summary.
      if (complete && settled && (!exact || prior === interim)) saved = { meta, identities: projection.identities, positions, edgeKeys: hashes, groups: cacheSummary() };
      interim = complete && settled || fromSaved && reused === 'all' ? undefined : { meta, identities: projection.identities, positions, edgeKeys: hashes };
      return { positions: positions.slice(), milliseconds, cached: Boolean(exact && fromSaved), reused, stored, settled, engineStatus };
    }
    case 'encode':
      if (!positions || !settled) throw new Error('Layout not settled');
      return encodeLayout({ meta, identities: projection.identities, positions, edgeKeys: hashes, groups: saved?.meta.key === meta.key && saved.groups ? saved.groups : cacheSummary() });
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
    case 'search': {
      // Ranked find-a-note over the cached search text; only note indices leave the worker.
      if (revision !== projectionRevision) throw new Error('Projection generation changed');
      return (await cooperative(searchSteps(projection, String(r.query), r.visible), control)).map(h => h.node);
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
    case 'relationships': {
      // Bounded detail for selected rows: the declaring rule's name and the relationship note's path.
      if (revision !== projectionRevision) throw new Error('Projection generation changed');
      return r.edges.slice(0, 64).map(e => {
        if (!Number.isSafeInteger(e) || e < 0 || e >= projection.source.length) throw new Error('RELATIONSHIP_INDEX');
        const c = projection.carrier[e]!; return { rule: config.declaration.edges[projection.rule?.[e] ?? -1]?.name, carrier: c === NONE ? undefined : projection.carrierPaths[c] };
      });
    }
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
let layoutRequest = -1;
self.onmessage = (event: MessageEvent<PipelineRequest & { id: number; revision: number; input?: LayoutInput; options?: any }>) => {
  const recycle = event.data as unknown as { kind: string; buffer?: ArrayBuffer; id: number };
  if (recycle.kind === 'stop-layout') { if (recycle.id === layoutRequest) { cancelled.add(recycle.id); engines.stop(); } return; }
  if (recycle.kind === 'cancel-evaluation') { if ([...evaluations.values()].includes(recycle.id)) cancelled.add(recycle.id); return; }
  if (recycle.kind === 'recycle') { if (recycle.buffer && recycled.length < 2) recycled.push(recycle.buffer); return; }
  // Backwards-compatible deterministic layout protocol used by existing harness consumers.
  if (event.data.input) { const start = performance.now(); try { const p = runLayout(event.data.input, event.data.options); self.postMessage({ positions: p, milliseconds: performance.now() - start }, { transfer: [p.buffer] }); } catch (error) { self.postMessage({ error: String(error) }); } return; }
  const r = event.data;
  if (evaluation(r)) { const old = evaluations.get(r.kind); if (old !== undefined) cancelled.add(old); evaluations.set(r.kind, r.id); }
  queue = queue.then(async () => {
    if (r.kind === 'layout' || r.kind === 'recompute') layoutRequest = r.id;
    self.postMessage({ kind: 'started', id: r.id, revision: r.revision });
    try { const result = await handle(r, r.revision, { cancelled: () => cancelled.has(r.id), budgetMs: evaluation(r) ? r.budgetMs ?? 120000 : 120000 }); self.postMessage({ id: r.id, revision: r.revision, result }, { transfer: transferables(result) }); }
    catch (error) { self.postMessage({ id: r.id, revision: r.revision, error: String(error) }); }
    finally { if (layoutRequest === r.id) layoutRequest = -1; cancelled.delete(r.id); if (evaluations.get(r.kind) === r.id) evaluations.delete(r.kind); }
  });
};
