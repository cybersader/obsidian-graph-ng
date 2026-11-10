import { ItemView, Plugin, PluginSettingTab, Setting, Notice, TFile, apiVersion, type WorkspaceLeaf } from 'obsidian';
import { LocalAdapter } from './adapter/local';
import { digest, validateDeclaration, validatePredicate, type Predicate } from './core/declaration';
import { buildProjection, filterNodes, type Projection } from './core/projection';
import { contractGroups, validateGroupProjection, pairKey, resolveCarrier, type GroupProjection, type GroupContribution } from './core/group-projection';
import { incrementalLayout } from './core/incremental';
import type { LayoutInput } from './core/layout';
import { defaults, validateSettings, type Settings } from './settings';
import { DetailRenderer, GroupRenderer, gpuStatus, type Renderer } from './renderer';
declare const __LAYOUT_WORKER_SOURCE__: string;
const VIEW = 'graph-ng';
const PRODUCER = 'graphology-fa2@0.10.1';
interface Generation { key: string; identities: string[]; positions: number[]; producer: string }
interface Data { settings: Settings; generations: Record<string, Generation> }
export default class GraphPlugin extends Plugin {
  settings!: Settings;
  adapter!: LocalAdapter;
  generations: Record<string, Generation> = Object.create(null);
  private listeners = new Set<() => void>();
  private writes: Promise<void> = Promise.resolve();
  readonly linkProducer = `obsidian-links@${apiVersion}`;
  async onload() {
    const data = await this.loadData() as Data | null;
    this.settings = defaults(this.linkProducer);
    if (data?.settings) { try { validateSettings(data.settings); this.settings = data.settings; } catch (e) { new Notice(`Graph NG settings invalid; using defaults: ${String(e)}`); } }
    if (data?.generations && typeof data.generations === 'object') this.generations = data.generations;
    this.registerView(VIEW, leaf => new GraphView(leaf, this));
    this.addCommand({ id: 'open', name: 'Open graph', callback: () => { void this.open(); } });
    this.addRibbonIcon('git-fork', 'Graph NG', () => { void this.open(); });
    this.addSettingTab(new GraphSettings(this));
    this.resetAdapter();
    this.registerEvent(this.app.vault.on('modify', file => { if (file.path === this.settings.projectionFile) this.notify(); }));
  }
  resetAdapter() { this.adapter?.index.dispose(); this.adapter = new LocalAdapter(this.app, this, this.linkProducer, this.settings.debounceMs, () => this.notify()); }
  subscribe(listener: () => void) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  notify() { for (const fn of this.listeners) fn(); }
  async open() {
    let leaf = this.app.workspace.getLeavesOfType(VIEW)[0];
    if (!leaf) { leaf = this.app.workspace.getLeaf('tab'); await leaf.setViewState({ type: VIEW, active: true }); }
    await this.app.workspace.revealLeaf(leaf);
  }
  save() {
    this.writes = this.writes.catch(() => {}).then(() => this.saveData({ settings: this.settings, generations: this.settings.persistLayout ? this.generations : {} }));
    return this.writes;
  }
  async apply(settings: Settings) {
    validateSettings(settings); this.settings = settings;
    // Event registrations are owned by the original adapter; use its debounce only after reload.
    await this.save(); this.notify();
  }
  async cache(declarationHash: string, generation: Generation) {
    if (!this.settings.persistLayout) return;
    delete this.generations[declarationHash]; this.generations[declarationHash] = generation;
    for (const key of Object.keys(this.generations).slice(0, -this.settings.cachedDeclarations)) delete this.generations[key];
    await this.save();
  }
}
export class GraphView extends ItemView {
  private renderer?: Renderer;
  private stopWorker?: () => void;
  private unsubscribe?: () => void;
  private revision = 0;
  private status!: HTMLElement;
  private stage!: HTMLElement;
  private panel!: HTMLElement;
  private toolbar!: HTMLElement;
  private groupGraph?: GroupProjection;
  private contributions = new Map<string, GroupContribution[]>();
  private members = new Map<string, number[]>();
  private projection?: Projection;
  private previous?: { projection: Projection; positions: Float32Array; declaration: string; layout: string };
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
      try { const pred: unknown = filter.value.trim() ? JSON.parse(filter.value) : undefined; if (pred !== undefined) validatePredicate(pred); this.predicate = pred; if (this.projection) { this.visible = filterNodes(this.projection, pred); this.updateGroups(); this.showGroups(); } }
      catch (e) { new Notice(String(e)); }
    };
    this.status = this.contentEl.createDiv({ cls: 'graph-ng-status', attr: { role: 'status' } });
    this.stage = this.contentEl.createDiv({ cls: 'graph-ng-stage' });
    this.panel = this.contentEl.createDiv({ cls: 'graph-ng-panel' });
    this.gpu = gpuStatus();
    this.unsubscribe = this.plugin.subscribe(() => { void this.refresh(); });
    await this.refresh();
  }
  async onClose() { this.revision++; this.stopWorker?.(); this.renderer?.dispose(); this.unsubscribe?.(); }
  private updateGroups() {
    if (!this.projection || !this.visible) return;
    const c = contractGroups(this.projection, this.visible, this.plugin.settings.groupLevel);
    this.groupGraph = c.projection; this.contributions = c.contributions; this.members = c.members;
  }
  async refresh() {
    const rev = ++this.revision; this.stopWorker?.(); this.renderer?.dispose(); this.renderer = undefined; this.detailRenderer = undefined;
    this.status.textContent = 'Building projection…'; this.contentEl.dataset.state = 'building';
    const settings = this.plugin.settings;
    try {
      if (settings.projectionFile) {
        const file = this.app.vault.getAbstractFileByPath(settings.projectionFile);
        if (!(file instanceof TFile)) throw new Error(`Projection file not found: ${settings.projectionFile}`);
        const p: unknown = JSON.parse(await this.app.vault.read(file)); validateGroupProjection(p);
        if (rev !== this.revision) return;
        this.projection = undefined; this.positions = undefined; this.groupGraph = p; this.members.clear(); this.contributions.clear();
        this.status.textContent = `${p.groups.length} producer-supplied groups · ${p.groupEdges.length} counted group pairs · aggregate input only`;
        this.contentEl.dataset.state = 'ready'; this.showGroups(); return;
      }
      const rows = this.plugin.adapter.snapshot();
      const start = performance.now(), p = buildProjection(rows, settings.declaration);
      this.projection = p; this.visible = filterNodes(p, this.predicate); this.positions = undefined;
      this.updateGroups(); this.showGroups();
      const coverage = this.plugin.adapter.coverage();
      const base = `${p.paths.length.toLocaleString()} nodes · ${p.source.length.toLocaleString()} edges · ${coverage.indexed}/${coverage.listed} listed notes indexed${coverage.indexed < coverage.listed ? ' (partial)' : ''} · ${p.unresolved} unresolved`;
      this.status.textContent = `${base} · building layout in worker`;
      this.contentEl.dataset.nodes = String(p.paths.length); this.contentEl.dataset.edges = String(p.source.length);
      const declarationHash = await digest(settings.declaration), layoutHash = await digest(settings.layout);
      const key = await digest({ declarationHash, layoutHash, producer: PRODUCER, rows: [...rows].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0) });
      if (rev !== this.revision) return;
      const cache = this.plugin.generations[declarationHash];
      const valid = settings.persistLayout && cache?.key === key && cache.producer === PRODUCER && Array.isArray(cache.positions) && cache.positions.length === p.paths.length * 2 && cache.positions.every(Number.isFinite) && JSON.stringify(cache.identities) === JSON.stringify(p.identities);
      this.cacheTrace.push({ expected: key, stored: cache?.key, nodes: p.paths.length, ...coverage, valid: Boolean(valid) });
      if (this.cacheTrace.length > 16) this.cacheTrace.shift();
      let ms = 0, cached = false;
      if (valid) { this.positions = Float32Array.from(cache.positions); cached = true; }
      else {
        const seed = Number.parseInt(key.slice(0, 8), 16), old = this.previous;
        const input = old?.declaration === declarationHash && old.layout === layoutHash ? incrementalLayout(old.projection, old.positions, p, seed, settings.layout) : { count: p.paths.length, source: p.source, target: p.target, seed };
        if ('movable' in input && input.movable && !input.movable.some(Boolean)) this.positions = input.initial;
        else { const result = await this.layout(input); if (rev !== this.revision) return; this.positions = result.positions; ms = result.milliseconds; }
        // A restored workspace can open before metadata/vault enumeration finishes.
        // Never replace its last complete generation with a transient partial/empty graph.
        if (this.positions && coverage.indexed === coverage.listed && (coverage.listed > 0 || !cache)) await this.plugin.cache(declarationHash, { key, identities: p.identities, positions: Array.from(this.positions), producer: PRODUCER });
      }
      if (rev !== this.revision || !this.positions) return;
      this.previous = { projection: p, positions: this.positions, declaration: declarationHash, layout: layoutHash };
      this.status.textContent = `${base} · ${cached ? 'cached layout' : `worker ${ms.toFixed(0)} ms`} · total ${(performance.now() - start).toFixed(0)} ms${this.gpu.available ? '' : ' · GPU unavailable — group view and member lists remain available'}`;
      this.contentEl.dataset.state = 'ready'; this.contentEl.dataset.layoutMs = String(ms); this.contentEl.dataset.cached = String(cached);
    } catch (e) { if (rev === this.revision) { this.status.textContent = `Graph NG: ${String(e)}`; this.contentEl.dataset.state = 'error'; } }
  }
  private layout(input: LayoutInput): Promise<{ positions: Float32Array; milliseconds: number }> {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(new Blob([__LAYOUT_WORKER_SOURCE__], { type: 'text/javascript' }));
      const worker = new Worker(url);
      const cleanup = () => { clearTimeout(timer); worker.terminate(); URL.revokeObjectURL(url); this.stopWorker = undefined; };
      const timer = setTimeout(() => { cleanup(); reject(new Error('Layout timed out; reduce iterations or use precomputed groups')); }, this.plugin.settings.workerTimeoutMs);
      this.stopWorker = () => { cleanup(); reject(new Error('Layout superseded')); };
      worker.onerror = e => { cleanup(); reject(new Error(e.message)); };
      worker.onmessage = e => { cleanup(); if (e.data.error) reject(new Error(e.data.error)); else resolve(e.data); };
      worker.postMessage({ input, options: this.plugin.settings.layout });
    });
  }
  showGroups() {
    this.renderer?.dispose(); this.detailRenderer = undefined; this.stage.empty(); this.panel.empty();
    if (!this.groupGraph) return;
    this.renderer = new GroupRenderer(this.stage, this.groupGraph, this.plugin.settings, id => this.drill(id), edge => this.edgeList(edge));
    const controls = this.panel.createDiv({ cls: 'graph-ng-group-controls' });
    for (const g of this.groupGraph.groups) controls.createEl('button', { text: `${g.label} (${g.count.toLocaleString()})`, attr: { 'data-group': g.id } }).onclick = () => this.drill(g.id);
    const edges = this.panel.createEl('details'); edges.createEl('summary', { text: `Relationships (${this.groupGraph.groupEdges.length} group pairs)` });
    for (const e of this.groupGraph.groupEdges) {
      const labels = new Map(this.groupGraph.groups.map(g => [g.id, g.label]));
      const label = `${labels.get(e.a)} → ${labels.get(e.b)} · ${Object.values(e.typeCounts).reduce((a, b) => a + b, 0)}`;
      edges.createEl('button', { text: label, cls: 'graph-ng-edge' }).onclick = () => this.edgeList(e);
    }
    this.contentEl.dataset.mode = 'groups';
  }
  private openPath(path: string) {
    if (!(this.app.vault.getAbstractFileByPath(path) instanceof TFile)) { new Notice('The referenced note is not available locally.'); return; }
    void this.app.workspace.openLinkText(path, '', 'tab');
  }
  private paginate<T>(items: T[], render: (item: T, host: HTMLElement) => void) {
    let shown = 0; const list = this.panel.createDiv({ cls: 'graph-ng-list' }), more = this.panel.createEl('button', { text: 'Show more' });
    const next = () => { const end = Math.min(items.length, shown + this.plugin.settings.listPageSize); for (; shown < end; shown++) render(items[shown]!, list); more.hidden = shown >= items.length; };
    more.onclick = next; next();
  }
  private drill(id: string) {
    const group = this.groupGraph?.groups.find(g => g.id === id); if (!group) return;
    this.panel.empty(); this.panel.createEl('strong', { text: `${group.label}: ${group.count.toLocaleString()} members` });
    const members = this.members.get(id);
    if (!members || !this.projection) {
      if (group.openPath) this.panel.createEl('button', { text: 'Open group note' }).onclick = () => this.openPath(group.openPath!);
      const local = group.identityPrefix ? this.plugin.adapter.snapshot().filter(r => this.plugin.settings.declaration.identity.some(k => typeof r.properties[k.key] === 'string' && (r.properties[k.key] as string).startsWith(group.identityPrefix!))) : [];
      if (local.length) this.paginate(local, (r, host) => { host.createEl('button', { text: r.path, cls: 'graph-ng-member' }).onclick = () => this.openPath(r.path); });
      else this.panel.createDiv({ text: 'Producer aggregate: member bodies are not included. No local members matched its declared identity prefix.' });
      return;
    }
    const p = this.projection;
    if (this.gpu.available && this.positions) { const bits = new Uint8Array(p.paths.length); for (const i of members) bits[i] = 1; this.showDetails(bits, false); }
    this.paginate(members, (i, host) => { host.createEl('button', { text: p.paths[i]!, cls: 'graph-ng-member' }).onclick = () => this.openPath(p.paths[i]!); });
  }
  private edgeList(edge: GroupProjection['groupEdges'][number]) {
    this.panel.empty();
    this.panel.createEl('strong', { text: Object.entries(edge.typeCounts).map(([t, n]) => `${t}: ${n.toLocaleString()}`).join(' · ') });
    if (edge.directional) this.panel.createDiv({ text: `A → B: ${JSON.stringify(edge.directional.aToB)} · B → A: ${JSON.stringify(edge.directional.bToA)}` });
    const rows = this.contributions.get(pairKey(edge.a, edge.b));
    if (rows) this.paginate(rows, (r, host) => { const item = host.createDiv({ cls: 'graph-ng-contribution' }); item.createSpan({ text: `${r.source} → ${r.target} [${r.type}] ` }); if (r.carrier) item.createEl('button', { text: r.carrier }).onclick = () => this.openPath(r.carrier!); });
    else this.paginate(edge.carriers.ids, (id, host) => {
      const path = resolveCarrier(this.plugin.adapter.snapshot(), this.plugin.settings.declaration, edge.carriers.kind, id);
      const button = host.createEl('button', { text: path ?? `${id} (not resolved locally)`, cls: 'graph-ng-carrier' });
      button.disabled = !path; if (path) button.onclick = () => this.openPath(path);
    });
  }
  showDetails(bits = this.visible, clearPanel = true) {
    if (!this.projection || !this.positions || !bits) { new Notice('Individual nodes are not ready; the group graph remains usable.'); return; }
    if (!this.gpu.available) { new Notice(`GPU unavailable: ${this.gpu.reason}. Use group member lists.`); return; }
    this.renderer?.dispose(); this.stage.empty(); if (clearPanel) this.panel.empty();
    try {
      this.detailRenderer = new DetailRenderer(this.stage, this.projection, this.positions, bits, this.plugin.settings, i => this.openPath(this.projection!.paths[i]!), () => this.showGroups());
      this.renderer = this.detailRenderer; this.contentEl.dataset.mode = 'nodes';
    } catch (e) { this.gpu = { available: false, reason: String(e) }; this.showGroups(); this.status.textContent += ' · GPU unavailable; group fallback active'; }
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
      try { const d: unknown = JSON.parse(declaration.value); validateDeclaration(d); const settings = { ...JSON.parse(knobs.value), declaration: d }; validateSettings(settings); await this.plugin.apply(settings); result.textContent = 'Saved and rebuilt.'; }
      catch (e) { result.textContent = String(e); }
    }));
  }
}
