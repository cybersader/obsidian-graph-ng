import { ItemView, Plugin, PluginSettingTab, Setting, Notice, TFile, apiVersion, type WorkspaceLeaf } from 'obsidian';
import { LocalAdapter } from './adapter/local';
import { digest, migrateDeclaration, validatePredicate, type Predicate } from './core/declaration';
import type { Projection } from './core/projection';
import { pairKey, indexCarriers, type GroupProjection, type GroupContribution } from './core/group-projection';
import { BinaryLayoutStore, type BinaryGeneration } from './core/binary-layout';
import { yieldTask } from './core/scheduler';
import { WorkerPipeline, LAYOUT_PRODUCER, currentDetailGeneration, type ProjectResult, type DetailResult, type LayoutResult } from './pipeline';
import { groupPages, page } from './core/group-page';
import { loadSettings, validateSettings, type Settings } from './settings';
import { DetailRenderer, GroupRenderer, gpuStatus, type Renderer } from './renderer';
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
    if (data?.generations && typeof data.generations === 'object' && data.settings?.declaration) { const oldHash = await digest(data.settings.declaration), currentHash = await digest(this.settings.declaration); const old = data.generations[oldHash]; if (old) this.generations[currentHash] = old; }
    const url = URL.createObjectURL(new Blob([__LAYOUT_WORKER_SOURCE__], { type: 'text/javascript' }));
    this.pipeline = new WorkerPipeline(new Worker(url), () => this.settings.workerTimeoutMs, () => URL.revokeObjectURL(url), {
      restart: () => new Worker(url), maxRestarts: () => this.settings.workerRestarts,
      onRestart: () => {
        this.ingestedHash = ''; this.adapter?.invalidate();
        for (const leaf of this.app.workspace.getLeavesOfType(VIEW)) (leaf.view as GraphView).invalidateSource();
        new Notice('Graph NG worker restarted; rebuilding from the public metadata cache.');
        this.notify();
      },
    });
    this.register(() => this.pipeline.dispose()); this.resetStore();
    this.registerView(VIEW, leaf => new GraphView(leaf, this));
    this.addCommand({ id: 'open', name: 'Open graph', callback: () => { void this.open(); } });
    this.addRibbonIcon('git-fork', 'Graph NG', () => { void this.open(); });
    this.addSettingTab(new GraphSettings(this));
    this.resetAdapter();
    if (loaded.persist) await this.save();
    this.registerEvent(this.app.vault.on('modify', file => { if (file.path === this.settings.projectionFile) this.notify(); }));
  }
  resetAdapter() { this.adapter?.index.dispose(); this.adapter = new LocalAdapter(this.app, this, this.linkProducer, this.settings.debounceMs, () => this.notify(), true, this.settings.declaration); this.ingestedHash = ''; }
  subscribe(listener: () => void) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  notify() { for (const fn of this.listeners) fn(); }
  async open() {
    let leaf = this.app.workspace.getLeavesOfType(VIEW)[0];
    if (!leaf) { leaf = this.app.workspace.getLeaf('tab'); await leaf.setViewState({ type: VIEW, active: true }); }
    await this.app.workspace.revealLeaf(leaf);
  }
  save() {
    this.writes = this.writes.catch(() => {}).then(() => this.saveData({ settings: this.settings}));
    return this.writes;
  }
  async apply(settings: Settings) {
    settings = { ...settings, declaration: migrateDeclaration(settings.declaration) }; validateSettings(settings);
    await this.serialize(async () => {
      this.settings = settings; this.adapter.configure(settings.declaration); this.resetStore();
      // Event registrations are owned by the original adapter; use its debounce only after reload.
      await this.save();
    }); this.notify();
  }
  async cache(generation: BinaryGeneration) {
    if (!this.settings.persistLayout) return;
    this.writes = this.writes.catch(() => {}).then(() => this.store.write(generation));
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
  private projection?: Projection;
  private colors?: Uint32Array;
  private provisional = true;
  private activeRevision = 0;
  private detailGeneration = -1;
  private queued = false;
  private refreshing = false;
  private closed = false;
  private positions?: Float32Array;
  private visible?: Uint8Array;
  private predicate?: Predicate;
  private gpu = { available: false, reason: 'Not probed' };
  readonly cacheTrace: { expected: string; stored?: string; nodes: number; indexed: number; listed: number; valid: boolean }[] = [];
  detailRenderer?: DetailRenderer;
  constructor(leaf: WorkspaceLeaf, readonly plugin: GraphPlugin) { super(leaf); }
  getViewType() { return VIEW; }
  getDisplayText() { return 'Graph NG'; }
  getIcon() { return 'git-fork'; }
  async onOpen() {
    this.contentEl.empty(); this.contentEl.addClass('graph-ng-view');
    this.toolbar = this.contentEl.createDiv({ cls: 'graph-ng-toolbar' });
    this.toolbar.createEl('button', { text: 'Groups' }).onclick = () => this.showGroups();
    this.toolbar.createEl('button', { text: 'All notes' }).onclick = () => this.showDetails();
    const filter = this.toolbar.createEl('input', { attr: { placeholder: 'Filter JSON: {"kind":"folder","prefix":"Notes"}', 'aria-label': 'Column predicate JSON' } });
    const apply = this.toolbar.createEl('button', { text: 'Apply filter' });
    apply.onclick = () => {
      try { const pred: unknown = filter.value.trim() ? JSON.parse(filter.value) : undefined; if (pred !== undefined) validatePredicate(pred); this.predicate = pred; void this.refresh(); }
      catch (e) { new Notice(String(e)); }
    };
    this.status = this.contentEl.createDiv({ cls: 'graph-ng-status', attr: { role: 'status' } });
    this.stage = this.contentEl.createDiv({ cls: 'graph-ng-stage' });
    this.panel = this.contentEl.createDiv({ cls: 'graph-ng-panel' });
    // Creating even a probe GL context can block; the initial group view needs no GPU.
    this.unsubscribe = this.plugin.subscribe(() => { void this.refresh(); });
    await this.refresh();
  }
  invalidateSource() { this.revision++; this.renderRevision++; this.provisional = true; if (this.contentEl) this.contentEl.dataset.verified = 'false'; this.renderer?.dispose(); this.renderer = undefined; this.projection = undefined; this.detailGeneration = -1; this.positions = undefined; this.groupGraph = undefined; this.stage?.empty(); this.panel?.empty(); }
  async onClose() { this.closed = true; this.renderRevision++; this.revision++; this.renderer?.dispose(); this.unsubscribe?.(); }
  async refresh() {
    if (this.closed) return;
    if (this.refreshing) { this.queued = true; return; }
    this.refreshing = true;
    try { do { this.queued = false; await this.plugin.serialize(() => this.refreshOnce()); } while (this.queued && !this.closed); }
    finally { this.refreshing = false; }
  }
  private async refreshOnce() {
    const rev = ++this.revision, revision = ++this.plugin.nextRevision; this.activeRevision = revision;
    const current = () => !this.closed && rev === this.revision;
    const settings = this.plugin.settings, start = performance.now();
    this.carrierLookup = undefined; this.provisional = true; this.contentEl.dataset.verified = 'false';
    this.contentEl.dataset.state = 'building'; this.status.textContent = 'Building projection from the public metadata cache…';
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
        this.projection = undefined; this.positions = undefined; this.groupGraph = p; this.members.clear(); this.contributions.clear();
        this.status.textContent = `${p.groups.length} groups · ${p.groupEdges.length} counted group pairs · unverified external aggregate (not merged with live rows)`;
        this.contentEl.dataset.state = 'ready'; this.showGroups(); return;
      }
      const config = { declaration: settings.declaration, layout: settings.layout, source: `${this.plugin.linkProducer}/${this.plugin.sourceIdentity}`, groupLevel: settings.groupLevel, predicate: this.predicate, streamEveryIterations: settings.streamEveryIterations };
      const hashes = await this.plugin.pipeline.request<{ declarationHash: string; layoutHash: string }>(revision, { kind: 'configure', config });
      if (!current()) return;
      if (settings.persistLayout) {
        await this.plugin.migrate(revision, hashes.declarationHash);
        const saved = await this.plugin.store.latest(hashes.declarationHash, { source: config.source, layoutHash: hashes.layoutHash, producer: LAYOUT_PRODUCER });
        if (saved) {
          try {
            const cache = await this.plugin.pipeline.request<{ groups?: GroupProjection } | undefined>(revision, { kind: 'load', generation: saved });
            if (cache?.groups && current() && !this.predicate) {
              this.projection = undefined; this.positions = undefined; this.groupGraph = cache.groups; this.members.clear(); this.contributions.clear(); this.showGroups();
              this.status.textContent = `cached · verifying ${this.plugin.adapter.coverage().indexed} of ${this.plugin.adapter.coverage().listed} · filters and members provisional`;
              this.contentEl.dataset.cachedPaintMs = String(performance.now() - start); await yieldTask();
            }
          } catch { await this.plugin.store.quarantine(saved.meta); }
        }
      }
      const reset = this.plugin.ingestedHash !== hashes.declarationHash;
      for await (const batch of this.plugin.adapter.columns(reset, settings.ingest)) {
        if (!current()) return;
        await this.plugin.pipeline.request(revision, { kind: 'rows', ...batch });
        const c = this.plugin.adapter.coverage();
        this.status.textContent = `${this.groupGraph ? 'cached · ' : ''}verifying ${c.indexed} of ${c.listed} · filters and members provisional`;
      }
      this.plugin.ingestedHash = hashes.declarationHash;
      this.plugin.pipeline.onGroups = event => {
        if (event.revision !== revision || !current()) return;
        this.groupGraph = event.projection; this.members.clear(); this.contributions.clear(); this.showGroups();
        this.contentEl.dataset.firstGroupMs = String(performance.now() - start);
      };
      const result = await this.plugin.pipeline.request<ProjectResult>(revision, { kind: 'project', complete: this.plugin.adapter.coverage().indexed === this.plugin.adapter.coverage().listed });
      if (!current()) return;
      if (result.invalidSaved) await this.plugin.store.quarantine(result.invalidSaved);
      const coverage = this.plugin.adapter.coverage(); this.provisional = coverage.indexed !== coverage.listed;
      this.contentEl.dataset.verified = String(!this.provisional);
      const base = `${result.nodes.toLocaleString()} nodes · ${result.edges.toLocaleString()} edges · ${coverage.indexed}/${coverage.listed} listed notes indexed${this.provisional ? ' (partial · filters and members provisional)' : ' · verified'} · ${result.unresolved} unresolved${result.quarantined.length ? ` · ${result.quarantined.length} notes share an ID (excluded)` : ''}`;
      this.status.textContent = `${base} · building layout in worker`;
      this.contentEl.dataset.nodes = String(result.nodes); this.contentEl.dataset.edges = String(result.edges);
      await yieldTask();
      const detail = await this.plugin.pipeline.request<DetailResult>(revision, { kind: 'detail' });
      if (!current()) return;
      this.projection = detail.projection; this.detailGeneration = revision; this.visible = detail.visible; this.colors = detail.colors;
      if (result.quarantined.length) this.showGroups();
      this.plugin.pipeline.onPositions = event => { if (event.revision === revision && current()) { if (this.positions && this.contentEl.dataset.mode === 'groups') this.plugin.pipeline.recycle(this.positions.buffer as ArrayBuffer); this.positions = event.positions; this.contentEl.dataset.streaming = 'true'; } };
      let layout: LayoutResult;
      try { layout = await this.plugin.pipeline.request<LayoutResult>(revision, { kind: 'layout' }); }
      catch (error) { if (String(error).includes('Saved identities')) { await this.plugin.store.quarantine(result.meta); } throw error; }
      if (!current()) return;
      this.positions = layout.positions;
      this.cacheTrace.push({ expected: result.meta.key, stored: layout.stored, nodes: result.nodes, ...coverage, valid: layout.cached }); if (this.cacheTrace.length > 16) this.cacheTrace.shift();
      this.status.textContent = `${base} · ${layout.cached ? 'cached layout' : `worker ${layout.milliseconds.toFixed(0)} ms`} · total ${(performance.now() - start).toFixed(0)} ms${this.gpu.available || this.gpu.reason === 'Not probed' ? '' : ' · GPU unavailable — group view and member lists remain available'}`;
      this.contentEl.dataset.state = 'ready'; this.contentEl.dataset.layoutMs = String(layout.milliseconds); this.contentEl.dataset.cached = String(layout.cached);
      if (settings.persistLayout && !layout.cached && !this.provisional && (!settings.declaration.edges.some(e => e.kind === 'producer') || this.plugin.adapter.linksResolved)) {
        const generation = await this.plugin.pipeline.request<BinaryGeneration>(revision, { kind: 'encode' });
        await this.plugin.cache(generation);
      }
    } catch (e) {
      this.plugin.adapter.invalidate(); this.plugin.ingestedHash = ''; this.provisional = true; this.contentEl.dataset.verified = 'false';
      if (current()) { this.status.textContent = `Graph NG: ${String(e)}`; this.contentEl.dataset.state = 'error'; }
    } finally {
      if (!current()) { this.plugin.adapter.invalidate(); this.plugin.ingestedHash = ''; this.contentEl.dataset.verified = 'false'; }
    }
  }
  showGroups() {
    this.renderRevision++;
    const start = performance.now();
    this.renderer?.dispose(); this.detailRenderer = undefined; this.stage.empty(); this.panel.empty();
    const projection = this.groupGraph; if (!projection) return;
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
      this.renderer = new GroupRenderer(this.stage, selected, settings, id => this.drill(id), edge => this.edgeList(edge));
      previous.disabled = canvasPage === 0; next.disabled = (canvasPage + 1) * settings.groupCanvasPageSize >= projection.groups.length;
      label.textContent = ` Canvas groups ${canvasPage * settings.groupCanvasPageSize + 1}–${Math.min((canvasPage + 1) * settings.groupCanvasPageSize, projection.groups.length)} / ${projection.groups.length} `;
      this.contentEl.dataset.canvasGroups = String(selected.groups.length);
    };
    previous.onclick = () => { canvasPage--; draw(); }; next.onclick = () => { canvasPage++; draw(); }; draw();
    this.paginate(projection.groups, (g, host) => { host.createEl('button', { text: `${g.label} (${g.count.toLocaleString()})`, attr: { 'data-group': g.id } }).onclick = () => this.drill(g.id); }, this.panel, 'graph-ng-group-controls');
    const edges = this.panel.createEl('details'); edges.createEl('summary', { text: `Relationships (${projection.groupEdges.length} group pairs)` });
    this.paginate(projection.groupEdges, (edge, host) => {
      host.createEl('button', { text: `${pages.labels.get(edge.a)} ↔ ${pages.labels.get(edge.b)} · ${edge.total}`, cls: 'graph-ng-edge' }).onclick = () => this.edgeList(edge);
    }, edges);
    if (this.projection?.quarantined.length) {
      const conflicts = this.panel.createEl('details', { cls: 'graph-ng-quarantine' });
      conflicts.createEl('summary', { text: `${this.projection.quarantined.length} notes share an ID (excluded)` });
      this.paginate(this.projection.quarantined, (note, host) => { host.createEl('button', { text: `${note.path} — ${note.id}` }).onclick = () => this.openPath(note.path); }, conflicts);
    }
    this.contentEl.dataset.mode = 'groups'; this.contentEl.dataset.groupFirstPageMs = String(performance.now() - start);
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
    const group = this.groupGraph?.groups.find(g => g.id === id); if (!group) return;
    this.panel.empty(); this.panel.createEl('strong', { text: `${group.label}: ${group.count.toLocaleString()} members${this.provisional ? ' · provisional' : ''}` });
    const revision = this.activeRevision, projection = this.projection, renderRevision = this.renderRevision;
    if (projection && !currentDetailGeneration(revision, this.activeRevision, this.detailGeneration)) { new Notice('Member dictionary is updating; try this group again when verification finishes.'); return; }
    let members: Uint32Array | undefined;
    try { members = projection ? await this.plugin.pipeline.request<Uint32Array>(revision, { kind: 'members', group: id }) : undefined; }
    catch { return; } // A changed projection or recovered worker invalidates this interaction.
    if (revision !== this.activeRevision || (projection && !currentDetailGeneration(revision, this.activeRevision, this.detailGeneration)) || renderRevision !== this.renderRevision || this.closed) return;
    if (!members || !projection) {
      if (group.openPath) this.panel.createEl('button', { text: 'Open group note' }).onclick = () => this.openPath(group.openPath!);
      const local = group.identityPrefix ? this.plugin.adapter.snapshot().filter(r => this.plugin.settings.declaration.identity.some(k => typeof r.properties[k.key] === 'string' && (r.properties[k.key] as string).startsWith(group.identityPrefix!))) : [];
      if (local.length) this.paginate(local, (r, host) => { host.createEl('button', { text: r.path, cls: 'graph-ng-member' }).onclick = () => this.openPath(r.path); });
      else this.panel.createDiv({ text: 'Producer aggregate: member bodies are not included. No local members matched its declared identity prefix.' });
      return;
    }
    const p = projection;
    if (this.gpu.reason === 'Not probed') this.gpu = gpuStatus();
    if (this.gpu.available && this.positions) { const bits = new Uint8Array(p.paths.length); for (const i of members) bits[i] = 1; this.showDetails(bits, false); }
    this.paginate(Array.from(members), (i, host) => { host.createEl('button', { text: p.paths[i]!, cls: 'graph-ng-member' }).onclick = () => this.openPath(p.paths[i]!); });
  }
  private edgeList(edge: GroupProjection['groupEdges'][number]) {
    this.panel.empty();
    this.panel.createEl('strong', { text: Object.entries(edge.typeCounts).map(([t, n]) => `${t}: ${n.toLocaleString()}`).join(' · ') });
    if (edge.directional) this.panel.createDiv({ text: `A → B: ${JSON.stringify(edge.directional.aToB)} · B → A: ${JSON.stringify(edge.directional.bToA)}` });
    const rows = this.contributions.get(pairKey(edge.a, edge.b));
    if (this.projection) { void this.contributionPages(pairKey(edge.a, edge.b)); return; }
    if (rows) this.paginate(rows, (r, host) => { const item = host.createDiv({ cls: 'graph-ng-contribution' }); item.createSpan({ text: `${r.source} → ${r.target} [${r.type}] ` }); if (r.carrier) item.createEl('button', { text: r.carrier }).onclick = () => this.openPath(r.carrier!); });
    else this.paginate(edge.carriers.ids, (id, host) => {
      this.carrierLookup ??= indexCarriers(this.plugin.adapter.values(), this.plugin.settings.declaration);
      const path = this.carrierLookup.get(edge.carriers.kind)?.get(id) ?? null;
      const button = host.createEl('button', { text: path ?? `${id} (not resolved locally)`, cls: 'graph-ng-carrier' });
      button.disabled = !path; if (path) button.onclick = () => this.openPath(path);
    });
  }
  private async contributionPages(pair: string) {
    let offset = 0; const revision = this.activeRevision, size = this.plugin.settings.listPageSize;
    const root = this.panel.createDiv({ cls: 'graph-ng-pagination' }), controls = root.createDiv(), previous = controls.createEl('button', { text: 'Previous page' }), next = controls.createEl('button', { text: 'Next page' }), list = root.createDiv();
    const draw = async () => {
      let result: { total: number; items: GroupContribution[] };
      try { result = await this.plugin.pipeline.request<typeof result>(revision, { kind: 'contributions', pair, offset, count: size }); }
      catch { return; } // Stale generation/worker recovery: never display another generation's page.
      if (revision !== this.activeRevision || !root.isConnected) return;
      list.empty(); previous.disabled = offset === 0; next.disabled = offset + size >= result.total;
      for (const r of result.items) { const item = list.createDiv({ cls: 'graph-ng-contribution' }); item.createSpan({ text: `${r.source} → ${r.target} [${r.type}] ` }); if (r.carrier) item.createEl('button', { text: r.carrier }).onclick = () => this.openPath(r.carrier!); }
    };
    previous.onclick = () => { offset -= size; void draw(); }; next.onclick = () => { offset += size; void draw(); }; await draw();
  }
  async showDetails(bits = this.visible, clearPanel = true) {
    if (!this.projection || !this.positions || !bits) { new Notice('Individual nodes are not ready; the group graph remains usable.'); return; }
    if (this.gpu.reason === 'Not probed') this.gpu = gpuStatus();
    if (!this.gpu.available) { this.status.textContent += ' · GPU unavailable — use group member lists'; new Notice(`GPU unavailable: ${this.gpu.reason}. Use group member lists.`); return; }
    const renderRevision = ++this.renderRevision; this.contentEl.dataset.mode = 'nodes-building';
    this.renderer?.dispose(); this.stage.empty(); if (clearPanel) this.panel.empty();
    try {
      this.detailRenderer = await DetailRenderer.create(this.stage, this.projection, this.positions, bits, this.plugin.settings, i => this.openPath(this.projection!.paths[i]!), () => this.showGroups(), this.colors!, () => renderRevision === this.renderRevision);
      this.renderer = this.detailRenderer; this.contentEl.dataset.mode = 'nodes';
    } catch (e) { if (renderRevision !== this.renderRevision) return; this.gpu = { available: false, reason: String(e) }; this.showGroups(); this.status.textContent += ' · GPU unavailable; group fallback active'; }
  }
}
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
