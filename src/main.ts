import { expressionPrelude } from './core/expr/expression-prelude';
import { predicateColumn, groupColumn as sourceColumn } from './core/declaration';
import { ItemView, Plugin, PluginSettingTab, Setting, Notice, TFile, apiVersion, type WorkspaceLeaf } from 'obsidian';
import { LocalAdapter, type PropertySource } from './adapter/local';
import { canonical, digest, layoutDeclaration, migrateDeclaration, validateDeclaration, type GraphDeclaration, type Predicate } from './core/declaration';
import { canonicalView, type ExploreResult, type ExploreView, type ViewCamera } from './core/explore';
import { ExplorePanel } from './explore-panel';
import { categorical, NEUTRAL_GROUPS } from './render-effects';
import { readTheme } from './render-theme';
import { renderPath, type RenderProjection } from './render-projection';
import { pairKey, carrierIndexer, indexCarriers, type GroupProjection, type GroupContribution } from './core/group-projection';
import { BinaryLayoutStore, type BinaryGeneration } from './core/binary-layout';
import { yieldTask, sliced } from './core/scheduler';
import { WorkerPipeline, LAYOUT_PRODUCER, currentDetailGeneration, type ProjectResult, type DetailResult, type LayoutResult, type ViewResult } from './pipeline';
import { groupPages, page } from './core/group-page';
import { ContributionPage, type ContributionContext } from './contribution-page';
import { canonicalExplore, loadSettings, settingsForSave, validateSettings, type Settings } from './settings';
import { DetailRenderer, GroupRenderer, gpuStatus, type Renderer, type RenderView } from './renderer';
declare const __LAYOUT_WORKER_SOURCE__: string;
const VIEW = 'graph-ng';
interface Generation { key: string; identities: string[]; positions: number[]; producer: string; layoutHash?: string; edgeKeys?: string[] }
interface Data { settings: Settings; generations: Record<string, Generation> }
export default class GraphPlugin extends Plugin {
  settings!: Settings;
  adapter!: LocalAdapter;
  generations: Record<string, Generation> = Object.create(null);
  private listeners = new Set<() => void>();
  private writes: Promise<void> = Promise.resolve();
  private work: Promise<unknown> = Promise.resolve();
  pipeline!: WorkerPipeline;
  store!: BinaryLayoutStore;
  ingestedHash = '';
  nextRevision = 0;
  private viewIdentity = 'local';
  private viewNamespace = 'local';
  serialize<T>(run: () => Promise<T>): Promise<T> { const next = this.work.catch(() => {}).then(run); this.work = next; return next; }
  resetStore() {
    const pluginDirectory = this.manifest.dir ?? `${this.app.vault.configDir}/plugins/${this.manifest.id}`;
    const directory = `${pluginDirectory}/${this.settings.cache.directory || 'cache'}`;
    this.store = new BinaryLayoutStore(this.app.vault.adapter, { ...this.settings.cache, directory: `${directory}/${this.viewNamespace}`, cachedDeclarations: this.settings.cachedDeclarations }, yieldTask);
  }
  get sourceIdentity() { return this.viewIdentity; }
  // Future host adapter supplies an opaque member/view tag, never an inferred plugin identity.
  async setSourceIdentity(identity: string) {
    if (!identity || identity.length > 512) throw new Error('Invalid source view identity');
    if (identity === this.viewIdentity) return;
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW)) (leaf.view as GraphView).invalidateSource();
    await this.serialize(async () => { await this.store.discard(); this.generations = Object.create(null); this.viewIdentity = identity; this.viewNamespace = identity === 'local' ? 'local' : await digest({ identity }); this.ingestedHash = ''; this.adapter.invalidate(); this.resetStore(); }); this.notify();
  }
  readonly linkProducer = `obsidian-links@${apiVersion}`;
  async onload() {
    const dataPath = `${this.manifest.dir ?? `${this.app.vault.configDir}/plugins/${this.manifest.id}`}/data.json`;
    const loaded = await loadSettings(this.app.vault.adapter, dataPath, this.linkProducer, message => { new Notice(message); });
    this.settings = loaded.settings;
    const data = loaded.data as Data | undefined;
    if (data?.generations && typeof data.generations === 'object' && data.settings?.declaration) { const oldHash = await digest(layoutDeclaration(data.settings.declaration)), currentHash = await digest(layoutDeclaration(this.settings.declaration)); const old = data.generations[oldHash]; if (old) this.generations[currentHash] = old; }
    const url = URL.createObjectURL(new Blob([expressionPrelude(), __LAYOUT_WORKER_SOURCE__], { type: 'text/javascript' }));
    this.pipeline = new WorkerPipeline(new Worker(url), () => this.settings.workerTimeoutMs, () => URL.revokeObjectURL(url), {
      restart: () => new Worker(url), maxRestarts: () => this.settings.workerRestarts,
      onRestart: () => {
        this.ingestedHash = ''; this.adapter?.invalidate();
        for (const leaf of this.app.workspace.getLeavesOfType(VIEW)) (leaf.view as GraphView).invalidateSource();
        new Notice('Graph NG worker restarted; rebuilding from available properties.');
        this.notify();
      },
    });
    this.register(() => this.pipeline.dispose()); this.resetStore();
    this.registerView(VIEW, leaf => new GraphView(leaf, this));
    this.addCommand({ id: 'open', name: 'Open graph', callback: () => { void this.open(); } });
    this.addRibbonIcon('git-fork', 'Graph NG', () => { void this.open(); });
    this.addSettingTab(new GraphSettings(this));
    this.resetAdapter(); this.watchProperties();
    if (loaded.persist) await this.save();
    this.registerEvent(this.app.vault.on('modify', file => { if (file.path === this.settings.projectionFile) this.notify(); }));
  }
  propertySource?: PropertySource;
  propertyRevision = 0;
  /** Public optional host capability; listener ownership never transfers the provider. */
  watchProperties(host = globalThis) {
    let active = true, verifying = false, pending = false, timer: ReturnType<typeof setTimeout> | undefined;
    const verify = () => {
      if (!active || timer !== undefined || verifying) return;
      timer = setTimeout(async () => {
        timer = undefined; verifying = true; pending = false;
        try { if (await this.adapter.verifyProperties(this.settings.ingest) && active) for (const leaf of this.app.workspace.getLeavesOfType(VIEW)) (leaf.view as GraphView).promoteProperties(); }
        finally { verifying = false; if (pending) verify(); }
      }, this.settings.debounceMs);
    };
    const changed = (event?: Event) => {
      const candidate = (host as typeof globalThis & { openclast?: { propertyFacts?: PropertySource } }).openclast?.propertyFacts;
      const source = typeof candidate?.get === 'function' ? candidate : undefined, previous = this.propertySource;
      if (source === previous && (event as CustomEvent | undefined)?.detail?.invalidated === false) { pending = true; verify(); return; }
      clearTimeout(timer); timer = undefined; pending = false;
      this.propertySource = source; this.propertyRevision++;
      this.adapter.setPropertySource(source); this.ingestedHash = '';
      for (const leaf of this.app.workspace.getLeavesOfType(VIEW)) (leaf.view as GraphView).invalidateSource();
      this.notify();
      if (source && source !== previous) void Promise.resolve().then(() => active && source === this.propertySource && source.load?.()).catch(() => {});
    };
    host.addEventListener?.('oc:property-facts-changed', changed);
    this.register(() => { active = false; clearTimeout(timer); host.removeEventListener?.('oc:property-facts-changed', changed); });
    changed();
  }
  resetAdapter() { this.adapter?.index.dispose(); this.adapter = new LocalAdapter(this.app, this, this.linkProducer, this.settings.debounceMs, () => this.notify(), true, this.settings.declaration, this.propertySource); this.ingestedHash = ''; }
  subscribe(listener: () => void) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  notify() { for (const fn of this.listeners) fn(); }
  async open() {
    let leaf = this.app.workspace.getLeavesOfType(VIEW)[0];
    if (!leaf) { leaf = this.app.workspace.getLeaf('tab'); await leaf.setViewState({ type: VIEW, active: true }); }
    await this.app.workspace.revealLeaf(leaf);
  }
  /** Every write (explicit, coalesced, unload, cache migration) validates first; invalid
   * in-memory settings are refused with a notice and the last valid file stays on disk. */
  save() {
    clearTimeout(this.saveTimer); this.saveTimer = undefined;
    let data: ReturnType<typeof settingsForSave>;
    try { data = settingsForSave(this.settings); } catch (e) { new Notice(`Graph NG did not save invalid settings: ${String(e)}`); return this.writes; }
    this.writes = this.writes.catch(() => {}).then(() => this.saveData({ settings: data }));
    return this.writes;
  }
  private saveTimer: ReturnType<typeof setTimeout> | undefined;
  /** Coalesced settings write for live controls (sliders, view state); still settings-only. */
  saveSoon() { clearTimeout(this.saveTimer); this.saveTimer = setTimeout(() => void this.save(), 400); }
  onunload() { if (this.saveTimer !== undefined) void this.save(); }
  async apply(settings: Settings) {
    settings = { ...settings, declaration: migrateDeclaration(settings.declaration) }; validateSettings(settings); settings.explore = canonicalExplore(settings.explore);
    await this.serialize(async () => {
      this.settings = settings; this.adapter.configure(settings.declaration); this.resetStore();
      // Event registrations are owned by the original adapter; use its debounce only after reload.
      await this.save();
    }); this.notify();
  }
  async cache(generation: BinaryGeneration, current = () => true) {
    if (!this.settings.persistLayout) return;
    const store = this.store;
    this.writes = this.writes.catch(() => {}).then(() => { if (current() && this.settings.persistLayout && store === this.store) return store.write(generation); });
    await this.writes;
  }
  async migrate(revision: number, declarationHash: string) {
    const old = this.generations[declarationHash]; if (!old || this.sourceIdentity !== 'local') return;
    const generation = await this.pipeline.request<BinaryGeneration | undefined>(revision, { kind: 'migrate', generation: old, declarationHash });
    if (generation) await this.cache(generation);
    delete this.generations[declarationHash]; await this.save();
  }
}
export class GraphView extends ItemView {
  private renderer?: Renderer;
  private unsubscribe?: () => void;
  private revision = 0;
  private renderRevision = 0;
  private status!: HTMLElement;
  private stage!: HTMLElement;
  private panel!: HTMLElement;
  private toolbar!: HTMLElement;
  private groupGraph?: GroupProjection;
  private carrierLookup?: ReturnType<typeof indexCarriers>;
  private contributions = new Map<string, GroupContribution[]>();
  private members = new Map<string, number[]>();
  private projection?: RenderProjection;
  private colors?: Uint32Array;
  private provisional = true;
  private activeRevision = 0;
  private detailGeneration = -1;
  private groupGeneration = -1;
  /** Worker view generation and grouping identity of the adopted groupGraph/explored. */
  private viewGeneration = -1;
  private viewSource = '';
  private contributionScope = '';
  private contributionPage: ContributionPage;
  private queued = false;
  /** Disclosure sections the user opened; a re-render restores them instead of collapsing. */
  private openSections = new Set<string>();
  private refreshing = false;
  private closed = false;
  private positions?: Float32Array;
  private visible?: Uint8Array;
  private predicate?: Predicate;
  private view: ExploreView;
  private explored?: ExploreResult;
  private explorePanel?: ExplorePanel;
  private exploring = false;
  private exploreQueued?: () => void;
  private detailScope?: Uint8Array;
  private pendingCamera?: ViewCamera;
  private body!: HTMLElement;
  private gpu = { available: false, reason: 'Not probed' };
  readonly startupTrace: { revision: number; start: number; groupsAt: number; drawMs: number; firstGroupMs: number }[] = [];
  readonly cacheTrace: { expected: string; stored?: string; nodes: number; indexed: number; listed: number; valid: boolean }[] = [];
  detailRenderer?: DetailRenderer;
  constructor(leaf: WorkspaceLeaf, readonly plugin: GraphPlugin) {
    super(leaf);
    this.view = structuredClone(plugin.settings.explore.view);
    this.contributionPage = new ContributionPage(plugin.settings.listPageSize, (revision, pair, offset, count, view) => plugin.pipeline.request(revision, { kind: 'contributions', pair, offset, count, view }), () => this.renderContributionPanel());
  }
  getViewType() { return VIEW; }
  getDisplayText() { return 'Graph NG'; }
  getIcon() { return 'git-fork'; }
  async onOpen() {
    this.contentEl.empty(); this.contentEl.addClass('graph-ng-view');
    this.toolbar = this.contentEl.createDiv({ cls: 'graph-ng-toolbar' });
    this.toolbar.createEl('button', { text: 'Groups' }).onclick = () => this.showGroups();
    this.toolbar.createEl('button', { text: 'All notes' }).onclick = () => { this.detailScope = undefined; void this.showDetails(); };
    this.status = this.contentEl.createDiv({ cls: 'graph-ng-status', attr: { role: 'status' } });
    this.body = this.contentEl.createDiv({ cls: 'graph-ng-body' });
    this.stage = this.body.createDiv({ cls: 'graph-ng-stage' });
    this.explorePanel = new ExplorePanel(this.body, {
      settings: () => this.plugin.settings, result: () => this.explored, mode: () => this.contentEl.dataset.mode ?? 'groups',
      policy: () => this.detailRenderer?.policy.reasons ?? [], carriers: () => this.detailRenderer?.carrierCount ?? 0, setView: (view, after) => this.setView(view, after), setColors: colors => this.setColors(colors), preview: (expr, context) => this.previewExpression(expr, context),
      visualsChanged: labels => { this.plugin.saveSoon(); this.detailRenderer?.refreshVisuals(labels); if (this.contentEl.dataset.mode === 'groups') this.showGroups(true); },
      groupColor: code => this.groupColor(code), focusGroup: code => this.focusGroup(code), fit: () => this.detailRenderer?.fitAll(),
      camera: () => this.detailRenderer ? { ...this.detailRenderer.camera } : null, restoreCamera: camera => this.restoreCamera(camera), persist: () => this.plugin.saveSoon(),
    }, this.view);
    this.panel = this.contentEl.createDiv({ cls: 'graph-ng-panel' });
    // Creating even a probe GL context can block; the initial group view needs no GPU.
    this.registerEvent(this.app.workspace.on('css-change', () => this.renderer?.refreshTheme?.()));
    this.unsubscribe = this.plugin.subscribe(() => { void this.refresh(); });
    const source = this.plugin.propertySource;
    void Promise.resolve().then(() => !this.closed && source === this.plugin.propertySource && source?.load?.()).catch(() => {});
    await this.refresh();
  }
  invalidateSource() { this.explored = undefined; this.explorePanel?.render(); this.contributionPage.clear(); this.groupGeneration = -1; this.revision++; this.renderRevision++; this.provisional = true; if (this.contentEl) this.contentEl.dataset.verified = 'false'; this.renderer?.dispose(); this.renderer = undefined; this.projection = undefined; this.detailGeneration = -1; this.positions = undefined; this.groupGraph = undefined; this.stage?.empty(); this.panel?.empty(); }
  promoteProperties() {
    if (this.closed || this.plugin.settings.projectionFile || !this.groupGraph || this.detailGeneration !== this.activeRevision || !this.plugin.adapter.factsComplete()) return;
    this.provisional = false; this.contentEl.dataset.verified = 'true';
    this.status.textContent = this.status.textContent?.replace(' (partial · filters and members provisional)', ' · verified') ?? '';
  }
  async onClose() { this.explorePanel?.dispose(); this.contributionPage.clear(); this.closed = true; this.renderRevision++; this.revision++; this.renderer?.dispose(); this.unsubscribe?.(); }
  async refresh() {
    if (this.closed) return;
    if (this.refreshing) { this.queued = true; return; }
    this.refreshing = true;
    try { do { this.queued = false; await this.plugin.serialize(() => this.refreshOnce()); } while (this.queued && !this.closed); }
    finally { this.refreshing = false; }
  }
  private async refreshOnce() {
    const scope = JSON.stringify([this.plugin.sourceIdentity, this.plugin.settings.projectionFile, this.plugin.settings.groupLevel, this.plugin.settings.declaration.groups, this.view?.group ?? null]);
    if (scope !== this.contributionScope) this.contributionPage.clear();
    this.contributionScope = scope; this.contributionPage.size = this.plugin.settings.listPageSize; this.contributionPage.suspend();
    const rev = ++this.revision, revision = ++this.plugin.nextRevision; this.activeRevision = revision;
    const source = this.plugin.propertySource, propertyRevision = this.plugin.propertyRevision;
    const current = () => !this.closed && rev === this.revision && source === this.plugin.propertySource && propertyRevision === this.plugin.propertyRevision;
    const settings = this.plugin.settings, start = performance.now();
    this.carrierLookup = undefined; this.renderRevision++; this.provisional = true; this.contentEl.dataset.verified = 'false';
    this.contentEl.dataset.state = 'building'; this.status.textContent = 'Building projection from available properties…';
    try {
      if (settings.projectionFile) {
        const file = this.app.vault.getAbstractFileByPath(settings.projectionFile);
        if (!(file instanceof TFile)) throw new Error(`Projection file not found: ${settings.projectionFile}`);
        if (file.stat.size > settings.maxProjectionBytes) throw new Error('Projection byte limit exceeded');
        const text = await this.app.vault.read(file);
        const bytes = new TextEncoder().encode(text);
        if (bytes.byteLength > settings.maxProjectionBytes) throw new Error('Projection byte limit exceeded');
        const p = await this.plugin.pipeline.request<GroupProjection>(revision, { kind: 'external', bytes, maxBytes: settings.maxProjectionBytes, limits: { groups: settings.maxProjectionGroups, pairs: settings.maxProjectionPairs, carriers: settings.maxProjectionCarriers } });
        if (!current()) return;
        this.projection = undefined; this.positions = undefined; this.explored = undefined; this.groupGraph = p; this.groupGeneration = revision; this.viewGeneration = -1; this.viewSource = 'external'; this.members.clear(); this.contributions.clear();
        this.status.textContent = `${p.groups.length} groups · ${p.groupEdges.length} counted group pairs · unverified external aggregate (not merged with live rows)`;
        this.contentEl.dataset.state = 'ready'; this.showGroups(); return;
      }
      const configuredSource = this.sourceKey(this.view), config = { declaration: settings.declaration, layout: settings.layout, source: `${this.plugin.linkProducer}/${this.plugin.sourceIdentity}`, groupLevel: settings.groupLevel, predicate: this.predicate, view: this.view, facetValues: settings.explore?.facetValues, streamEveryIterations: settings.streamEveryIterations };
      const hashes = await this.plugin.pipeline.request<{ declarationHash: string; layoutHash: string; ingestHash: string }>(revision, { kind: 'configure', config });
      if (!current()) return;
      if (settings.persistLayout) {
        await this.plugin.migrate(revision, hashes.declarationHash);
        const saved = await this.plugin.store.latest(hashes.declarationHash, { source: config.source, layoutHash: hashes.layoutHash, producer: LAYOUT_PRODUCER });
        if (saved) {
          try {
            const cache = await this.plugin.pipeline.request<{ groups?: GroupProjection } | undefined>(revision, { kind: 'load', generation: saved });
            if (cache?.groups && current() && !this.predicate && !(this.view && viewNarrows(this.view))) {
              this.projection = undefined; this.positions = undefined; this.groupGraph = cache.groups; this.groupGeneration = -revision; this.viewGeneration = -1; this.viewSource = this.sourceKey(null); this.members.clear(); this.contributions.clear(); this.showGroups(true);
              this.status.textContent = `cached · verifying ${this.plugin.adapter.coverage().indexed} of ${this.plugin.adapter.coverage().listed} · filters and members provisional`;
              this.contentEl.dataset.cachedPaintMs = String(performance.now() - start); await yieldTask();
            }
          } catch { await this.plugin.store.quarantine(saved.meta); }
        }
      }
      const reset = this.plugin.ingestedHash !== hashes.ingestHash;
      for await (const batch of this.plugin.adapter.columns(reset, settings.ingest)) {
        if (!current()) return;
        await this.plugin.pipeline.request(revision, { kind: 'rows', ...batch });
        const c = this.plugin.adapter.coverage();
        this.status.textContent = `${this.groupGraph ? 'cached · ' : ''}verifying ${c.indexed} of ${c.listed} · filters and members provisional`;
      }
      this.plugin.ingestedHash = hashes.ingestHash;
      this.plugin.pipeline.onGroups = event => {
        if (event.revision !== revision || !current()) return;
        const groupsAt = performance.now();
        this.groupGraph = event.projection; this.groupGeneration = revision; this.viewGeneration = event.view; this.viewSource = configuredSource; this.members.clear(); this.contributions.clear(); this.showGroups(true);
        const painted = performance.now(), firstGroupMs = painted - start;
        this.startupTrace.push({ revision, start, groupsAt, drawMs: painted - groupsAt, firstGroupMs }); if (this.startupTrace.length > 16) this.startupTrace.shift();
        // A queued metadata refresh must not relabel its later paint as cold startup.
        this.contentEl.dataset.firstGroupMs ??= String(firstGroupMs);
        this.contentEl.dataset.refreshGroupMs = String(firstGroupMs);
      };
      const complete = this.plugin.adapter.factsComplete(); this.provisional = !complete;
      const result = await this.plugin.pipeline.request<ProjectResult>(revision, { kind: 'project', complete: !this.provisional });
      if (!current()) return;
      if (result.invalidSaved) await this.plugin.store.quarantine(result.invalidSaved);
      const coverage = this.plugin.adapter.coverage(); this.provisional = !this.plugin.adapter.factsComplete();
      this.contentEl.dataset.verified = String(!this.provisional);
      const base = `${result.nodes.toLocaleString()} nodes · ${result.edges.toLocaleString()} edges · ${coverage.indexed}/${coverage.listed} properties available${this.plugin.adapter.linksPending() ? '; links pending' : ''}${this.provisional ? ' (partial · filters and members provisional)' : ' · verified'} · ${result.unresolved} unresolved${result.quarantined.length ? ` · ${result.quarantined.length} notes share an ID (excluded)` : ''}`;
      this.status.textContent = `${base} · building layout in worker`;
      this.contentEl.dataset.nodes = String(result.nodes); this.contentEl.dataset.edges = String(result.edges);
      await yieldTask();
      const detail = await this.plugin.pipeline.request<DetailResult>(revision, { kind: 'detail' });
      if (!current()) return;
      this.projection = detail.projection; this.detailGeneration = revision; this.viewGeneration = detail.view; this.viewSource = configuredSource; this.visible = detail.visible; this.colors = detail.colors; this.explored = detail.explore; this.contentEl.dataset.visibleNodes = String(detail.explore.visible.reduce((n, v) => n + v, 0)); this.explorePanel?.render();
      this.contributionPage.update(this.contributionContext());
      if (result.quarantined.length) this.showGroups(true);
      this.plugin.pipeline.onPositions = event => { if (event.revision === revision && current()) { if (this.positions && this.contentEl.dataset.mode === 'groups') this.plugin.pipeline.recycle(this.positions.buffer as ArrayBuffer); this.positions = event.positions; this.contentEl.dataset.streaming = 'true'; } };
      let layout: LayoutResult;
      try { layout = await this.plugin.pipeline.request<LayoutResult>(revision, { kind: 'layout' }); }
      catch (error) { if (String(error).includes('Saved identities')) { await this.plugin.store.quarantine(result.meta); } throw error; }
      if (!current()) return;
      this.positions = layout.positions;
      this.cacheTrace.push({ expected: result.meta.key, stored: layout.stored, nodes: result.nodes, ...coverage, valid: layout.cached }); if (this.cacheTrace.length > 16) this.cacheTrace.shift();
      this.status.textContent = `${base} · ${layout.cached ? 'cached layout' : `worker ${layout.milliseconds.toFixed(0)} ms`} · total ${(performance.now() - start).toFixed(0)} ms${this.gpu.available || this.gpu.reason === 'Not probed' ? '' : ' · GPU unavailable — group view and member lists remain available'}`;
      this.contentEl.dataset.state = 'ready'; this.contentEl.dataset.layoutMs = String(layout.milliseconds); this.contentEl.dataset.cached = String(layout.cached);
      if (settings.persistLayout && !layout.cached && complete && !this.provisional && (!settings.declaration.edges.some(e => e.kind === 'producer') || this.plugin.adapter.linksResolved)) {
        const generation = await this.plugin.pipeline.request<BinaryGeneration>(revision, { kind: 'encode' });
        if (!current()) return;
        await this.plugin.cache(generation, current);
      }
    } catch (e) {
      this.plugin.adapter.invalidate(); this.plugin.ingestedHash = ''; this.provisional = true; this.contentEl.dataset.verified = 'false';
      if (current()) { this.status.textContent = `Graph NG: ${String(e)}`; this.contentEl.dataset.state = 'error'; this.contributionPage.fail(`Projection refresh failed: ${String(e)}`); }
    } finally {
      if (!current()) { this.plugin.adapter.invalidate(); this.plugin.ingestedHash = ''; this.contentEl.dataset.verified = 'false'; }
    }
  }
  showGroups(preserveSelection = false) {
    if (!preserveSelection) this.contributionPage.clear();
    this.renderRevision++;
    const start = performance.now();
    this.renderer?.dispose(); this.detailRenderer = undefined; this.stage.empty(); this.panel.empty();
    const projection = this.groupGraph, generation = this.groupGeneration, source = this.viewSource; if (!projection) return;
    const settings = this.plugin.settings, pages = groupPages(projection, settings.groupCanvasPageSize);
    let canvasPage = 0;
    const canvasControls = this.panel.createDiv({ cls: 'graph-ng-canvas-pager' });
    const previous = canvasControls.createEl('button', { text: 'Previous canvas groups' });
    const label = canvasControls.createSpan();
    const next = canvasControls.createEl('button', { text: 'Next canvas groups' });
    canvasControls.hidden = projection.groups.length <= settings.groupCanvasPageSize;
    const draw = () => {
      this.renderer?.dispose(); this.stage.empty();
      const selected = pages.canvas(canvasPage);
      this.renderer = new GroupRenderer(this.stage, selected, settings, id => this.drill(id), edge => this.edgeList(edge, projection, generation, source), id => this.groupColor(Number(id)));
      previous.disabled = canvasPage === 0; next.disabled = (canvasPage + 1) * settings.groupCanvasPageSize >= projection.groups.length;
      label.textContent = ` Canvas groups ${canvasPage * settings.groupCanvasPageSize + 1}–${Math.min((canvasPage + 1) * settings.groupCanvasPageSize, projection.groups.length)} / ${projection.groups.length} `;
      this.contentEl.dataset.canvasGroups = String(selected.groups.length);
    };
    previous.onclick = () => { canvasPage--; draw(); }; next.onclick = () => { canvasPage++; draw(); }; draw();
    this.paginate(projection.groups, (g, host) => { host.createEl('button', { text: `${g.label} (${g.count.toLocaleString()})`, attr: { 'data-group': g.id } }).onclick = () => this.drill(g.id); }, this.panel, 'graph-ng-group-controls');
    const edges = this.section('relationships'); edges.createEl('summary', { text: `Relationships (${projection.groupEdges.length} group pairs)` });
    this.paginate(projection.groupEdges, (edge, host) => {
      host.createEl('button', { text: `${pages.labels.get(edge.a)} ↔ ${pages.labels.get(edge.b)} · ${edge.total}`, cls: 'graph-ng-edge' }).onclick = () => this.edgeList(edge, projection, generation, source);
    }, edges);
    if (this.projection?.quarantined.length) {
      const conflicts = this.section('quarantine', 'graph-ng-quarantine');
      conflicts.createEl('summary', { text: `${this.projection.quarantined.length} notes share an ID (excluded)` });
      this.paginate(this.projection.quarantined, (note, host) => { host.createEl('button', { text: `${note.path} — ${note.id}` }).onclick = () => this.openPath(note.path); }, conflicts);
    }
    this.contentEl.dataset.mode = 'groups'; this.contentEl.dataset.groupFirstPageMs = String(performance.now() - start); this.explorePanel?.render();
    if (this.contributionPage.selection) { this.renderContributionPanel(); this.contributionPage.update(this.contributionContext()); }
  }
  private section(key: string, cls = `graph-ng-${key}`) {
    const details = this.panel.createEl('details', { cls }); details.open = this.openSections.has(key);
    details.addEventListener('toggle', () => { if (details.open) this.openSections.add(key); else this.openSections.delete(key); });
    return details;
  }
  private openPath(path: string) {
    if (!(this.app.vault.getAbstractFileByPath(path) instanceof TFile)) { new Notice('The referenced note is not available locally.'); return; }
    void this.app.workspace.openLinkText(path, '', 'tab');
  }
  private paginate<T>(items: readonly T[], render: (item: T, host: HTMLElement) => void, host = this.panel, listClass = 'graph-ng-list') {
    let index = 0; const size = this.plugin.settings.listPageSize, root = host.createDiv({ cls: 'graph-ng-pagination' });
    const controls = root.createDiv({ cls: 'graph-ng-page-controls' }), previous = controls.createEl('button', { text: 'Previous page' });
    const label = controls.createSpan(), next = controls.createEl('button', { text: 'Next page' }), list = root.createDiv({ cls: listClass });
    controls.hidden = items.length <= size;
    const draw = () => {
      list.empty(); for (const item of page(items, index, size)) render(item, list);
      previous.disabled = index === 0; next.disabled = (index + 1) * size >= items.length;
      label.textContent = ` ${items.length ? index * size + 1 : 0}–${Math.min((index + 1) * size, items.length)} / ${items.length} `;
    };
    previous.onclick = () => { index--; draw(); }; next.onclick = () => { index++; draw(); }; draw();
  }
  private async drill(id: string) {
    this.contributionPage.clear();
    const group = this.groupGraph?.groups.find(g => g.id === id); if (!group) return;
    this.panel.empty(); this.panel.createEl('strong', { text: `${group.label}: ${group.count.toLocaleString()} members${this.provisional ? ' · provisional' : ''}` });
    const revision = this.activeRevision, projection = this.projection, renderRevision = ++this.renderRevision, view = this.viewGeneration;
    if (projection && !currentDetailGeneration(revision, this.activeRevision, this.detailGeneration)) { new Notice('Member dictionary is updating; try this group again when verification finishes.'); return; }
    let members: Uint32Array | undefined;
    try { members = projection ? await this.plugin.pipeline.request<Uint32Array>(revision, { kind: 'members', group: id, view }) : undefined; }
    catch { return; } // A changed projection or recovered worker invalidates this interaction.
    if (revision !== this.activeRevision || view !== this.viewGeneration || (projection && !currentDetailGeneration(revision, this.activeRevision, this.detailGeneration)) || renderRevision !== this.renderRevision || this.closed) return;
    if (!members || !projection) {
      if (group.openPath) this.panel.createEl('button', { text: 'Open group note' }).onclick = () => this.openPath(group.openPath!);
      const local = group.identityPrefix ? this.plugin.adapter.snapshot().filter(r => this.plugin.settings.declaration.identity.some(k => typeof r.properties[k.key] === 'string' && (r.properties[k.key] as string).startsWith(group.identityPrefix!))) : [];
      if (local.length) this.paginate(local, (r, host) => { host.createEl('button', { text: r.path, cls: 'graph-ng-member' }).onclick = () => this.openPath(r.path); });
      else this.panel.createDiv({ text: 'Producer aggregate: member bodies are not included. No local members matched its declared identity prefix.' });
      return;
    }
    const p = projection;
    try { if (this.gpu.reason === 'Not probed') this.gpu = await this.plugin.pipeline.request<typeof this.gpu | undefined>(revision, { kind: 'gpu' }) ?? gpuStatus(); }
    catch (error) { new Notice(`GPU probe failed: ${String(error)}. Use group member lists.`); }
    if (revision !== this.activeRevision || renderRevision !== this.renderRevision || this.closed) return;
    if (this.gpu.available && this.positions) { const bits = new Uint8Array(p.nodeCount); for (const i of members) bits[i] = 1; this.detailScope = bits; this.showDetails(bits, false); }
    this.paginate(Array.from(members), (i, host) => { host.createEl('button', { text: renderPath(p, i), cls: 'graph-ng-member' }).onclick = () => this.openPath(renderPath(p, i)); });
  }
  private async edgeList(edge: GroupProjection['groupEdges'][number], clickedGraph = this.groupGraph, clickedGeneration = this.groupGeneration, clickedSource = this.viewSource) {
    this.contributionPage.clear();
    if (!this.plugin.settings.projectionFile) {
      this.contributionPage.select(edge.a, edge.b, clickedGeneration, clickedGraph, clickedSource);
      this.contributionPage.update(this.contributionContext());
      return;
    }
    this.panel.empty();
    this.panel.createEl('strong', { text: Object.entries(edge.typeCounts).map(([t, n]) => `${t}: ${n.toLocaleString()}`).join(' · ') });
    if (edge.directional) this.panel.createDiv({ text: `A → B: ${JSON.stringify(edge.directional.aToB)} · B → A: ${JSON.stringify(edge.directional.bToA)}` });
    const rows = this.contributions.get(pairKey(edge.a, edge.b));
    if (rows) this.paginate(rows, (r, host) => { const item = host.createDiv({ cls: 'graph-ng-contribution' }); item.createSpan({ text: `${r.source} → ${r.target} [${r.type}] ` }); if (r.carrier) item.createEl('button', { text: r.carrier }).onclick = () => this.openPath(r.carrier!); });
    else {
      const renderRevision = ++this.renderRevision;
      if (!this.carrierLookup) {
        const status = this.panel.createDiv({ text: 'Resolving carrier notes…', attr: { role: 'status' } });
        const index = carrierIndexer(this.plugin.settings.declaration);
        try {
          await sliced(this.plugin.adapter.values(), this.plugin.settings.ingest, row => {
            if (renderRevision !== this.renderRevision || this.closed) throw new Error('Carrier lookup superseded');
            index.add(row);
          });
        } catch (error) { if (renderRevision === this.renderRevision && !this.closed) status.textContent = `Carrier lookup failed: ${String(error)}`; return; }
        if (renderRevision !== this.renderRevision || this.closed || clickedGraph !== this.groupGraph) return;
        this.carrierLookup = index.lookup; status.remove();
      }
      const lookup = this.carrierLookup;
      this.paginate(edge.carriers.ids, (id, host) => {
        const path = lookup.get(edge.carriers.kind)?.get(id) ?? null;
        const button = host.createEl('button', { text: path ?? `${id} (not resolved locally)`, cls: 'graph-ng-carrier' });
        button.disabled = !path; if (path) button.onclick = () => this.openPath(path);
      });
    }
  }
  private contributionContext(): ContributionContext {
    return { active: this.activeRevision, groups: this.groupGeneration, detail: this.detailGeneration, level: this.plugin.settings.groupLevel, projection: this.projection, graph: this.groupGraph, values: this.explored?.groupKeys, view: this.viewGeneration, source: this.viewSource };
  }
  /** Grouping identity: the runtime group source (or declared default at the configured level). */
  private sourceKey(view: ExploreView | null | undefined) {
    return `${canonical(view?.group ?? null)}@${this.plugin.settings.groupLevel}`;
  }
  private renderContributionPanel() {
    const pager = this.contributionPage; if (!pager.selection || this.closed || !this.panel) return;
    this.panel.empty();
    const edge = pager.edge;
    this.panel.createEl('strong', { text: edge ? Object.entries(edge.typeCounts).map(([t, n]) => `${t}: ${n.toLocaleString()}`).join(' · ') : 'Contributing mappings' });
    if (edge?.directional) this.panel.createDiv({ text: `A → B: ${JSON.stringify(edge.directional.aToB)} · B → A: ${JSON.stringify(edge.directional.bToA)}` });
    const status = this.panel.createDiv({ cls: 'graph-ng-contribution-status', attr: { role: 'status', 'data-state': pager.status }, text: pager.message });
    if (pager.status === 'error') status.createEl('button', { text: 'Retry' }).onclick = () => pager.retry(this.contributionContext());
    if (pager.status !== 'ready' || !pager.result) return;
    const { total, items } = pager.result, root = this.panel.createDiv({ cls: 'graph-ng-pagination' }), controls = root.createDiv();
    const previous = controls.createEl('button', { text: 'Previous page' }), next = controls.createEl('button', { text: 'Next page' });
    previous.disabled = pager.offset === 0; next.disabled = pager.offset + pager.size >= total;
    previous.onclick = () => pager.move(-1, this.contributionContext()); next.onclick = () => pager.move(1, this.contributionContext());
    controls.createSpan({ text: ` ${total ? pager.offset + 1 : 0}–${Math.min(pager.offset + pager.size, total)} / ${total} ` });
    for (const r of items) { const item = root.createDiv({ cls: 'graph-ng-contribution' }); item.createSpan({ text: `${r.source} → ${r.target} [${r.type}] ` }); if (r.carrier) item.createEl('button', { text: r.carrier }).onclick = () => this.openPath(r.carrier!); }
  }
  /** Renderer masks for the current explore result: group codes, collapsed groups, hidden types. */
  private renderView(): RenderView {
    const r = this.explored; if (!r) return {};
    const collapsed = new Uint8Array(r.groupKeys.length), keys = new Set(this.view.collapsedGroups), types = new Set(this.view.hiddenTypes);
    r.groupKeys.forEach((k, i) => { if (keys.has(k)) collapsed[i] = 1; });
    return { groupCodes: r.groupCodes, groupLabels: r.groupLabels, collapsed, typeHidden: Uint8Array.from(r.types, t => types.has(t) ? 1 : 0), colors: this.colors };
  }
  /** Latest-wins worker view recompute; no re-projection, relayout or renderer rebuild. */
  setView(view: ExploreView, after?: () => void, colors?: GraphDeclaration['colors']) {
    const needed = [...view.filters.flatMap(f => predicateColumn(f) ?? []), ...(view.group ? [sourceColumn(view.group)].flatMap(k => k ?? []) : [])];
    const known = new Set(this.explored?.facets.map(f => f.key));
    const missing = needed.filter(k => !known.has(k));
    if (missing.length) { this.view = view; const settings = this.plugin.settings; settings.explore.view = canonicalView(view); void this.plugin.apply({ ...settings, declaration: { ...settings.declaration, columns: [...new Set([...settings.declaration.columns, ...missing])] } }); return; }
    this.view = view; this.plugin.settings.explore.view = canonicalView(view); this.plugin.saveSoon();
    const run = async () => {
      this.exploring = true;
      const revision = this.activeRevision, started = performance.now();
      try {
        if (!this.projection || !currentDetailGeneration(revision, this.activeRevision, this.detailGeneration)) return;
        const sent = this.view, result = await this.plugin.pipeline.request<ViewResult>(revision, { kind: 'explore', view: sent, colors, facetValues: this.plugin.settings.explore.facetValues });
        if (this.closed || revision !== this.activeRevision) return;
        this.explored = result.explore; this.colors = result.colors; this.visible = result.explore.visible; this.groupGraph = result.groups; this.groupGeneration = revision;
        this.viewGeneration = result.view; this.viewSource = this.sourceKey(sent); this.members.clear(); this.contributions.clear();
        this.contentEl.dataset.exploreMs = String(performance.now() - started); const g = this.view.group; this.contentEl.dataset.groupSource = !g ? 'declared' : g.from === 'folder' ? `folder:${g.depth}` : g.from === 'expr' ? 'expression' : `${g.from}:${g.key}`; this.contentEl.dataset.visibleNodes = String(result.explore.visible.reduce((n, v) => n + v, 0));
        this.contributionPage.update(this.contributionContext());
        if (this.contentEl.dataset.mode === 'nodes' && this.detailRenderer) {
          let bits = this.visible; if (this.detailScope) { bits = this.visible.slice(); for (let i = 0; i < bits.length; i++) bits[i]! &= this.detailScope[i]!; }
          this.detailRenderer.setView(bits, this.renderView());
        } else if (this.contentEl.dataset.mode === 'groups') this.showGroups(true);
        this.explorePanel?.setState(this.view); after?.();
      } catch (error) {
        if (!this.closed && !String(error).includes('generation changed') && !String(error).includes('Expression superseded')) { new Notice(`Graph NG view: ${String(error)}`); this.status.textContent = `View not applied: ${String(error)}`; }
      } finally {
        this.exploring = false; const next = this.exploreQueued; this.exploreQueued = undefined; if (next) void next();
      }
    };
    if (this.exploring) { this.exploreQueued = run; this.plugin.pipeline.cancelEvaluation('explore'); } else void run();
  }
  private async previewExpression(expr: string, context: 'filter' | 'group') {
    const revision = this.activeRevision;
    const result = await this.plugin.pipeline.request<{ matched: number; total: number; groups?: number }>(revision, { kind: 'expression-count', expr, context });
    if (revision !== this.activeRevision || this.closed) throw new Error('Projection generation changed');
    return result;
  }
  /** Rules are presentation: re-evaluated in the worker on existing columns. A rule on a
   * property that is not yet materialized falls back to a full apply (re-ingest, no relayout). */
  private async setColors(colors: GraphDeclaration['colors']) {
    const declaration = { ...this.plugin.settings.declaration, colors };
    try { validateDeclaration(declaration); } catch (e) { new Notice(String(e)); return; }
    const settings = { ...this.plugin.settings, declaration: migrateDeclaration(declaration) };
    const materialized = new Set(this.explored?.facets.map(f => f.key));
    if (colors.every(c => [predicateColumn(c.predicate)].flatMap(k => k ?? []).every(k => materialized.has(k)))) {
      // Mutate in place: live renderers hold this settings object.
      this.plugin.settings.declaration = settings.declaration; this.plugin.adapter.configure(settings.declaration); this.plugin.saveSoon();
      this.setView(this.view, () => { this.detailRenderer?.refreshTheme(); this.explorePanel?.render(); }, settings.declaration.colors);
    } else await this.plugin.apply(settings);
  }
  private groupPalette?: { size: number; bg: string; bytes: Uint8Array };
  /** The same deterministic group palette the renderer uses, for legends and group canvas. */
  private themeCache?: { at: number; theme: ReturnType<typeof readTheme> };
  groupColor(code: number): string {
    // Legends ask once per row; read computed host colors at most once per burst.
    if (!this.themeCache || performance.now() - this.themeCache.at > 250) this.themeCache = { at: performance.now(), theme: readTheme(this.stage, this.plugin.settings) };
    const size = Math.max(1, Math.min(this.explored?.groupKeys.length ?? 1, 4096)), theme = this.themeCache.theme;
    // External aggregates have opaque group ids and no explore dictionary: neutral group color.
    if (!this.explored || !Number.isSafeInteger(code) || code < 0 || code >= this.explored.groupKeys.length) return theme.group;
    if (!this.groupPalette || this.groupPalette.size !== size || this.groupPalette.bg !== theme.background) { const p = theme.palette; this.groupPalette = { size, bg: theme.background, bytes: categorical(size, [p[8]!, p[9]!, p[10]!]) }; }
    // A declared rule named like the group wins, exactly as the group canvas colors it.
    const rule = this.plugin.settings.declaration.colors.findIndex(c => c.name === this.explored?.groupLabels[code]), p = theme.palette;
    if (rule >= 0) { const r = (rule + 5) * 4; return `rgb(${p[r]},${p[r + 1]},${p[r + 2]})`; }
    if (NEUTRAL_GROUPS.has(this.explored.groupLabels[code]!)) return theme.node;
    const b = this.groupPalette.bytes, k = (code % size) * 4;
    return this.plugin.settings.visuals.autoPalette ? `rgb(${b[k]},${b[k + 1]},${b[k + 2]})` : theme.group;
  }
  private focusGroup(code: number) {
    if (this.contentEl.dataset.mode === 'nodes' && this.detailRenderer) this.detailRenderer.frameGroup(code);
    else void this.drill(String(code));
  }
  private restoreCamera(camera: ViewCamera) {
    if (this.detailRenderer && this.contentEl.dataset.mode === 'nodes') this.detailRenderer.flyTo(camera.x, camera.y, camera.ratio);
    else { this.pendingCamera = camera; this.detailScope = undefined; void this.showDetails(); }
  }
  async showDetails(bits = this.visible, clearPanel = true) {
    if (!this.projection || !this.positions || !bits) { new Notice('Individual nodes are not ready; the group graph remains usable.'); return; }
    const renderRevision = ++this.renderRevision; this.contentEl.dataset.mode = 'nodes-building';
    try {
      if (this.gpu.reason === 'Not probed') this.gpu = await this.plugin.pipeline.request<typeof this.gpu | undefined>(this.activeRevision, { kind: 'gpu' }) ?? gpuStatus();
      if (renderRevision !== this.renderRevision || this.closed) return;
      if (!this.gpu.available && bits.reduce((n, b) => n + (b ? 1 : 0), 0) > this.plugin.settings.canvasMaxDetailNodes) { this.contentEl.dataset.mode = 'groups'; this.status.textContent += ' · GPU unavailable — use group member lists'; new Notice(`GPU unavailable: ${this.gpu.reason}. Use group member lists.`); return; }
      this.renderer?.dispose(); this.stage.empty(); if (clearPanel) { this.contributionPage.clear(); this.panel.empty(); }
      this.detailRenderer = await DetailRenderer.create(this.stage, this.projection, this.positions, bits, this.plugin.settings, i => this.openPath(renderPath(this.projection!, i)), () => this.showGroups(), this.colors!, () => renderRevision === this.renderRevision, !this.gpu.available, () => {
        if (renderRevision !== this.renderRevision || this.closed) return;
        this.gpu = { available: false, reason: 'WebGL context could not be restored' };
        this.showGroups(); void this.showDetails(bits, clearPanel);
      }, this.renderView());
      this.renderer = this.detailRenderer; this.contentEl.dataset.mode = 'nodes';
      this.detailRenderer.onHub = group => { const key = this.explored?.groupKeys[group]; if (key !== undefined) this.setView({ ...this.view, collapsedGroups: this.view.collapsedGroups.filter(k => k !== key) }, () => this.focusGroup(group)); };
      if (this.pendingCamera) { const c = this.pendingCamera; this.pendingCamera = undefined; this.detailRenderer.flyTo(c.x, c.y, c.ratio); }
      this.explorePanel?.render();
    } catch (e) { if (renderRevision !== this.renderRevision) return; this.gpu = { available: false, reason: String(e) }; this.showGroups(); this.status.textContent += ' · GPU unavailable; group fallback active'; }
  }
}
/** Whether a view hides anything relative to the unfiltered declared grouping. */
const viewNarrows = (v: ExploreView) => Boolean(v.query.trim() || v.filters.length || v.group || v.hiddenGroups.length || v.hiddenColors.length || v.hiddenTypes.length);
class GraphSettings extends PluginSettingTab {
  constructor(private plugin: GraphPlugin) { super(plugin.app, plugin); }
  display() {
    this.containerEl.empty();
    new Setting(this.containerEl).setName('Graph declaration').setHeading();
    this.containerEl.createEl('p', { text: 'All meaning is declared here. Edit JSON, validate, then save. Settings are local to this vault. Optional projectionFile accepts producer-supplied aggregate JSON. Changing debounceMs takes effect after reloading the plugin.' });
    const declaration = this.containerEl.createEl('textarea', { cls: 'graph-ng-json', attr: { 'aria-label': 'Graph declaration JSON' } }); declaration.value = JSON.stringify(this.plugin.settings.declaration, null, 2);
    const knobs = this.containerEl.createEl('textarea', { cls: 'graph-ng-json', attr: { 'aria-label': 'Tuning settings JSON' } });
    const { declaration: _, ...rest } = this.plugin.settings; knobs.value = JSON.stringify(rest, null, 2);
    const result = this.containerEl.createDiv({ attr: { role: 'status' } });
    new Setting(this.containerEl).addButton(b => b.setButtonText('Validate and save').onClick(async () => {
      try { const d = migrateDeclaration(JSON.parse(declaration.value)); const settings = { ...JSON.parse(knobs.value), declaration: d }; validateSettings(settings); await this.plugin.apply(settings); result.textContent = 'Saved and rebuilt.'; }
      catch (e) { result.textContent = String(e); }
    }));
  }
}
