import { devicePerformance, performanceRecords, type PerformanceRecord } from './performance';
import { lighterChoices, lighterSettings, type LighterChoice, performanceControls, showPerformanceSuggestions } from './performance-ui';
import { stateChip } from './view-state';
import { disclosure, disclosureBody, panelHelp, iconButton } from './panel-help';
import { BuildProgress, workingText } from './working';
import { LayoutPreview } from './layout-preview';
import type { CoordinateToken } from './webgl-renderer';
import { legacySizing, sizingSettings, type NodeSizingValues } from './node-sizing';
import { generationCurrent, physicsSettings, type PhysicsValues } from './physics-controls';
import { expressionPrelude } from './core/expr/expression-prelude';
import { folderPath, predicateColumn, groupColumn as sourceColumn } from './core/declaration';
import { Modal, ItemView, Menu, Plugin, PluginSettingTab, Setting, Notice, TFile, apiVersion, type WorkspaceLeaf, type ViewStateResult } from 'obsidian';
import { obsidianMenu } from './context-menu';
import { LocalAdapter, type PropertySource } from './adapter/local';
import { canonical, digest, layoutDeclaration, migrateDeclaration, validateDeclaration, type GraphDeclaration, type Predicate } from './core/declaration';
import { groupLabel, canonicalView, validateSaved, NO_COLOR, type SavedView, type ExploreResult, type ExploreView, type ViewCamera } from './core/explore';
import { ExplorePanel, setRelationshipDisplay } from './explore-panel';
import { graphStats, layoutAdvice, recommend, suggestionSettings, type GraphStats, type Suggestion } from './recommend';
import { categorical, NEUTRAL_GROUPS } from './render-effects';
import { readTheme } from './render-theme';
import { renderPath, type RenderProjection } from './render-projection';
import { CanvasLimit, canvasDetailEdges } from './render-data';
import { carrierIndexer, indexCarriers, type GroupProjection } from './core/group-projection';
import { BinaryLayoutStore, type BinaryGeneration } from './core/binary-layout';
import { yieldTask, sliced } from './core/scheduler';
import { WorkerPipeline, LAYOUT_PRODUCER, currentDetailGeneration, type ProjectResult, type DetailResult, type LayoutResult, type ViewResult } from './pipeline';
import { groupPages, page } from './core/group-page';
import { ContributionPage, type ContributionContext } from './contribution-page';
import { accounting, pendingText, num, plural, renderInformation, renderReadout, sum, type InformationReport } from './graph-information';
import { canonicalExplore, loadSettings, settingsForSave, validateSettings, type Settings } from './settings';
import { searchable } from './search';
import { DetailRenderer, GroupRenderer, gpuStatus, type Renderer, type RenderView } from './renderer';
declare const __LAYOUT_WORKER_SOURCE__: string;
/** One message/check serves each boundary without dropping phase information. */
function requireLayout(current: () => boolean, phase = '') { if (!current()) throw new Error(`Layout generation changed${phase}`); }
function cleanupFailure(error: unknown, phase: string, cleanup: unknown) { return new Error(`${error}; ${phase} failed: ${cleanup}. Saved-state recovery uncertain; retry saving before closing.`); }
const VIEW = 'graph-ng';
interface Generation { key: string; identities: string[]; positions: number[]; producer: string; layoutHash?: string; edgeKeys?: string[] }
interface Data { settings: Settings; generations: Record<string, Generation> }
/** Assign `next[k]` where `live[k]` still equals `was[k]`, in place; returns the count of keys kept live. */
const adopt = <T extends object>(live: T, next: T, was: T, keys: (keyof T)[]) => keys.filter(k => JSON.stringify(live[k]) === JSON.stringify(was[k]) ? (live[k] = next[k], false) : true).length;
export default class GraphPlugin extends Plugin {
  settings!: Settings;
  performanceLog: PerformanceRecord[] = [];
  performanceModalOpen = false;
  override saveData(data: { settings: { performanceDiagnostics?: boolean } }) {
    return super.saveData({ ...data, ...(data.settings.performanceDiagnostics ? { performanceLog: performanceRecords(this.performanceLog) } : {}) });
  }
  refreshPerformance() { for (const leaf of this.app.workspace.getLeavesOfType(VIEW)) (leaf.view as GraphView).performanceChanged(); }
  recordPerformance(sample: Partial<PerformanceRecord>) {
    try {
      const heap = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize;
      if (this.settings.performanceDiagnostics) {
        this.performanceLog = performanceRecords([...this.performanceLog, { ...sample, tier: devicePerformance.tier, mode: this.settings.performance, frameMs: devicePerformance.frameMs, longTasks: devicePerformance.longTasks, longTaskMs: devicePerformance.longTaskMs, heapBytes: heap }]);
        this.saveSoon();
      }
      if (!this.settings.performancePrompted && !this.performanceModalOpen && this.settings.performanceSuggestions && (devicePerformance.tier === 'low' || (sample.notes ?? 0) >= 10000 || (sample.edges ?? 0) >= 50000 || (heap ?? 0) >= 1e9) && lighterChoices(this.settings).length) {
        showPerformanceSuggestions(this);
      }
    } catch { /* Optional observations and suggestions must never fail a graph operation. */ }
  }
  adapter!: LocalAdapter;
  generations: Record<string, Generation> = Object.create(null);
  private listeners = new Set<() => void | Promise<void>>();
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
    this.register(devicePerformance.observe());
    this.performanceLog = this.settings.performanceDiagnostics ? performanceRecords(loaded.data?.performanceLog) : [];
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
    // Loading normalizes settings in memory only; adoption requires explicit validated apply.
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
  subscribe(listener: () => void | Promise<void>) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  notify() { return Promise.all([...this.listeners].map(fn => fn())); }
  async open() {
    let leaf = this.app.workspace.getLeavesOfType(VIEW)[0];
    if (!leaf) { leaf = this.app.workspace.getLeaf('tab'); await leaf.setViewState({ type: VIEW, active: true }); }
    await this.app.workspace.revealLeaf(leaf);
  }
  /** Every write (explicit, coalesced, unload, cache migration) validates first; invalid
   * in-memory settings are refused with a notice and the last valid file stays on disk. */
  save() {
    clearTimeout(this.saveTimer); this.saveTimer = undefined;
    try { settingsForSave(this.settings); } catch (e) { new Notice(`Graph NG did not save invalid settings: ${String(e)}`); return this.writes; }
    this.writes = this.writes.catch(() => {}).then(() => this.saveData({ settings: settingsForSave(this.settings) }));
    return this.writes;
  }
  /** Candidate writes share the ordinary save queue; nothing live changes before acknowledgement. */
  commitLayout(values: PhysicsValues, current: () => boolean, commit: () => void) {
    this.writes = this.writes.catch(() => {}).then(async () => {
      requireLayout(current, ' before save');
      const next = physicsSettings(this.settings, values);
      try {
        await this.saveData({ settings: settingsForSave(next) });
        requireLayout(current, ' during save');
        const merged = physicsSettings(this.settings, values);
        commit(); this.settings.layout = merged.layout;
      } catch (error) {
        // A rejected host write can have side effects. Restore latest live settings,
        // never an old whole-settings snapshot, before allowing queued writes through.
        try { await this.saveData({ settings: settingsForSave(this.settings) }); }
        catch (restore) { throw cleanupFailure(error, 'restoring saved settings also', restore); }
        throw error;
      }
    });
    return this.writes;
  }
  /** Acknowledged candidate write: live settings change only after save and a current check. */
  /** `assign` adopts only candidate keys still equal to `was` (their value when the save began) and returns how many it left
   *  live; a live edit made during the save wins and is then persisted, never overwritten by the stale suggestion. */
  private commitCandidate(label: string, build: () => Settings, assign: (next: Settings, was: Settings) => number, current: () => boolean) {
    this.writes = this.writes.catch(() => {}).then(async () => {
      if (!current()) throw new Error(`${label} view changed`);
      const was = structuredClone(this.settings);
      try {
        await this.saveData({ settings: settingsForSave(build()) });
        if (!current()) throw new Error(`${label} view changed during save`);
        if (assign(build(), was)) await this.saveData({ settings: settingsForSave(this.settings) });
      } catch (error) {
        try { await this.saveData({ settings: settingsForSave(this.settings) }); } catch { throw new Error(`${label} save failed; restoring saved settings also failed; storage recovery uncertain`); }
        throw error;
      }
    }); return this.writes;
  }
  async commitPerformance(selected: ReadonlySet<LighterChoice>, never: boolean, current: () => boolean) {
    selected = new Set(selected);
    await this.serialize(async () => {
      await this.commitCandidate('Performance', () => ({ ...lighterSettings(this.settings, selected), performanceSuggestions: never ? false : this.settings.performanceSuggestions }),
        (next, was) => adopt(this.settings.visuals, next.visuals, was.visuals, ['labelStyle', 'curvedEdges', 'motion']) + adopt(this.settings.declaration.display, next.declaration.display, was.declaration.display, ['reifiedAsNodes']) + adopt(this.settings, next, was, ['performanceSuggestions']), current);
      if (selected.size) { this.adapter.configure(this.settings.declaration); this.resetStore(); }
    }); if (selected.size) await this.notify();
  }
  commitSizing(values: NodeSizingValues, current: () => boolean) {
    return this.commitCandidate('Sizing', () => sizingSettings(this.settings, values), (next, was) => adopt(this.settings, next, was, ['nodeSize', 'nodeSizing']) + adopt(this.settings.visuals, next.visuals, was.visuals, ['degreeSizing', 'degreeCurve']), current);
  }
  /** Suggested presentation values; mutates in place because live renderers hold this object. */
  commitSuggestions(list: Suggestion[], current: () => boolean) {
    list = structuredClone(list);
    return this.commitCandidate('Graph', () => suggestionSettings(this.settings, list), (next, was) => adopt(this.settings, next, was, ['labelDensity']) + adopt(this.settings.visuals, next.visuals, was.visuals, Object.keys(next.visuals) as (keyof Settings['visuals'])[]), current);
  }
  /** Narrow bookmark transaction on the single settings queue; never applies graph settings. */
  commitSavedView(saved: SavedView | null, expected: SavedView | null) {
    saved = saved && structuredClone(saved); expected = expected && structuredClone(expected);
    const name = saved?.name ?? expected?.name;
    this.writes = this.writes.catch(() => {}).then(async () => {
      const before = this.settings.explore.savedViews;
      const target = before.find(v => v.name === name) ?? null;
      if (canonical(target) !== canonical(expected)) throw new Error('Saved view changed. Review the name collision again.');
      const next = before.flatMap(v => v.name === name ? saved ? [saved] : [] : [v]);
      if (saved && !target) next.push(saved);
      validateSaved(next);
      const original = canonical(before);
      const candidate = () => {
        if (canonical(this.settings.explore.savedViews) !== original) throw new Error('Saved views changed during save. Review again.');
        return settingsForSave({ ...this.settings, explore: { ...this.settings.explore, savedViews: next } });
      };
      let stored = candidate();
      try {
        await this.saveData({ settings: stored });
        // Live sliders can change unrelated settings while the host write is pending.
        const latest = candidate();
        if (canonical(latest) !== canonical(stored)) { stored = latest; await this.saveData({ settings: stored }); }
        if (canonical(candidate()) !== canonical(stored)) throw new Error('Settings changed during save. Retry explicitly.');
        this.settings.explore.savedViews = next;
      } catch (error) {
        try { await this.saveData({ settings: settingsForSave(this.settings) }); }
        catch { throw new Error('Save failed; stored settings could not be confirmed.'); }
        throw error;
      }
    });
    return this.writes;
  }
  private saveTimer: ReturnType<typeof setTimeout> | undefined;
  /** Coalesced settings write for live controls (sliders, view state); still settings-only. */
  saveSoon() { clearTimeout(this.saveTimer); this.saveTimer = setTimeout(() => void this.save(), 400); }
  onunload() { if (this.saveTimer !== undefined) void this.save(); }
  async apply(settings: Settings) {
    settings = { ...settings, nodeSizing: settings.nodeSizing ?? legacySizing(), declaration: migrateDeclaration(settings.declaration) }; validateSettings(settings); settings.explore = canonicalExplore(settings.explore);
    await this.serialize(async () => {
      this.settings = settings; this.adapter.configure(settings.declaration); this.resetStore();
      // Event registrations are owned by the original adapter; use its debounce only after reload.
      await this.save();
    }); await this.notify();
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
type ReturnPoint = NonNullable<ReturnType<DetailRenderer['returnPoint']>> & { projection: unknown };
export class GraphView extends ItemView {
  private renderer?: Renderer;
  private unsubscribe?: () => void;
  private revision = 0;
  private renderRevision = 0;
  private status!: HTMLElement;
  private statusSummary!: HTMLElement;
  private statusMessage = '';
  private report?: InformationReport;
  private viewFeedbackText = '';
  /** An automatic fallback is not a new user choice. */
  private detailFallback = '';
  /** Breakdown actions: the same Lines/Notes apply as Appearance, and removing one view filter. */
  private informationActions = {
    relationships: () => this.explorePanel?.show('appearance'),
    exclusions: () => { const modal = new Modal(this.app), tab = new GraphSettings(this.plugin); modal.setTitle('Graph declaration'); tab.containerEl = modal.contentEl; tab.display(); modal.open(); },
    duplicates: () => { this.toGroups(); this.explorePanel?.show('members'); const list = this.panel.querySelector<HTMLDetailsElement>('.graph-ng-quarantine'); if (list) { list.open = true; list.querySelector('summary')?.focus(); list.scrollIntoView({ block: 'nearest' }); } },
    display: (nodes: boolean) => this.explorePanel?.confirmRelationshipDisplay(nodes),
    remove: (i: number) => { if (i < this.view.filters.length) this.setView({ ...this.view, filters: this.view.filters.filter((_, j) => j !== i) }); },
    filter: (i: number) => this.explorePanel?.focusFilter(i),
  };
  private viewFeedback(message = '', retry?: () => void) {
    this.viewFeedbackText = message; this.explorePanel?.operation?.(message, retry);
    if (this.status && this.statusSummary) this.statusText = this.statusText;
  }
  private readProgress?: { indexed: number; listed: number };
  private buildProgress = new BuildProgress();
  private layoutWorking = false;
  private layoutStop?: HTMLButtonElement;
  private layoutRing?: SVGCircleElement;
  private layoutStopped = false;
  private layoutControl(active: boolean) {
    if (!this.layoutStop) {
      this.layoutStop = iconButton(this.statusSummary, 'Stop layout', 'circle-stop', 'clickable-icon graph-ng-layout-stop', { title: 'Stop layout', type: 'button' });
      const ring = this.layoutRing = this.layoutStop.querySelector('circle')!;
      ring.before(ring.cloneNode());
      ring.setAttribute('class', 'graph-ng-layout-ring'); ring.setAttribute('pathLength', '100');
    }
    const button = this.layoutStop;
    if (active) this.layoutStopped = false;
    this.statusSummary.toggleClass('graph-ng-layout-active', active);
    this.layoutRing!.setAttribute('stroke-dashoffset', String(100 - this.buildProgress.percent));
    button.style.visibility = active ? 'visible' : 'hidden'; button.disabled = !active;
    button.onclick = () => { this.plugin.pipeline.stopLayout(this.activeRevision); this.layoutStopped = true; button.disabled = true; this.statusText = 'Stopping layout…'; };
  }
  private loading() { return this.layoutWorking || this.contentEl.dataset.state === 'building' ? { stage: this.statusMessage, ...this.readProgress } : undefined; }
  private progressAt = 0;
  private progressText(text: string) { const now = performance.now(); if (now - (this.progressAt ?? 0) >= 100) { this.progressAt = now; this.statusText = text; } }
  private get statusText() { return this.statusMessage; }
  /** Graph information: a short message over structured tiles/issues; the canvas summary shows separate chips. */
  private set statusText(text: string) {
    this.statusMessage = text; this.contentEl.dataset.motion = this.plugin.settings.visuals?.motion ?? 'full';
    this.layoutRing?.setAttribute('stroke-dashoffset', String(100 - this.buildProgress.percent));
    (this.explorePanel as (ExplorePanel & { updateSummary?(): void }) | undefined)?.updateSummary?.();
    const state = this.contentEl.dataset.state;
    renderInformation(this.status, [text, this.detailFallback].filter(Boolean).join(' '), this.layoutWorking ? 'building' : state, this.report, this.explored, this.informationActions, this.loading());
    const health = state === 'error' ? [text] : this.loading() ? [this.loading()!.stage]
      : this.plugin.settings.projectionFile ? ['External aggregate, not verified']
      : this.provisional ? [pendingText(this.report)] : [];
    const chips = [this.viewFeedbackText, this.layoutStopped && !this.loading() && state !== 'error' ? 'Layout stopped' : '', ...health].filter(Boolean), readout = state === 'ready' && !this.provisional && this.report;
    const info = this.statusSummary.querySelector<HTMLElement>('.graph-ng-summary-info') ?? this.statusSummary.createEl('button', { cls: 'graph-ng-summary-info', attr: { 'aria-label': 'Graph information' } });
    info.hidden = !readout && !chips.length;
    info.onclick = () => this.explorePanel?.show('information', info);
    if (this.loading()) {
      let progress = info.querySelector<HTMLElement>('.graph-ng-summary-progress');
      if (!progress) { info.empty(); progress = info.createSpan({ cls: 'graph-ng-summary-progress' }); }
      workingText(progress, this.layoutStopped ? 'Stopping layout…' : chips.join(' '), !this.layoutStopped);
    } else {
      info.empty();
      if (readout) renderReadout(info, accounting(readout, this.explored));
      for (const chip of chips) info.createSpan({ cls: 'graph-ng-summary-chip', text: chip });
    }
    this.statusSummary.querySelector('.graph-ng-summary-help')?.remove();
    if (this.detailFallback) panelHelp(this.statusSummary, 'Notes unavailable', this.detailFallback, 'graph-ng-summary-chip graph-ng-summary-help');
    this.statusSummary.hidden = !chips.length && !readout && !this.detailFallback; this.statusSummary.title = '';
  }
  private stage!: HTMLElement;
  private panel!: HTMLElement;
  private toolbar!: HTMLElement;
  private groupGraph?: GroupProjection;
  private carrierLookup?: ReturnType<typeof indexCarriers>;
  private projection?: RenderProjection;
  private colors?: Uint32Array;
  private provisional = true;
  private activeRevision = 0;
  private detailGeneration = -1;
  private groupGeneration = -1;
  /** Worker view generation and grouping identity of the adopted groupGraph/explored. */
  private viewGeneration = -1;
  private viewSource = '';
  private appliedView?: ExploreView;
  private contributionScope = '';
  private contributionPage: ContributionPage;
  private queuedRefresh?: Promise<void>;
  /** Disclosure sections the user opened; a re-render restores them instead of collapsing. */
  private openSections = new Set<string>();
  private refreshing = false;
  private refreshWork?: Promise<void>;
  private closed = false;
  private positions?: Float32Array;
  private visible?: Uint8Array;
  private predicate?: Predicate;
  private view: ExploreView;
  private explored?: ExploreResult;
  private explorePanel?: ExplorePanel;
  private exploring = false;
  private exploreRequest = 0;
  private exploreCompletion?: (error?: unknown) => void;
  private exploreQueued?: () => void;
  private detailScope?: Uint8Array;
  private scopeName = 'Selected group';
  private pendingCamera?: ViewCamera;
  /** Focus to return to from Groups ("Back to" chip), bound to the projection it indexes. */
  private returnTo?: ReturnPoint;
  private pendingFocus?: ReturnPoint;
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
  private presentation: 'nodes' | 'groups' = 'groups';
  getState() { return { presentation: this.presentation }; }
  async setState(state: { presentation?: unknown }, result: ViewStateResult) {
    this.presentation = state?.presentation === 'nodes' ? 'nodes' : 'groups';
    const shown = this.contentEl.dataset.mode;
    if (this.positions && this.projection && shown !== this.presentation && shown !== 'nodes-building') { if (this.presentation === 'nodes') await this.showDetails(); else this.toGroups(); }
    await super.setState(state, result);
  }
  private rememberPresentation(mode: 'nodes' | 'groups') { this.presentation = mode; this.app.workspace.requestSaveLayout(); }
  getViewType() { return VIEW; }
  getDisplayText() { return 'Graph NG'; }
  getIcon() { return 'git-fork'; }
  async onOpen() {
    this.contentEl.empty(); this.contentEl.addClass('graph-ng-view');
    this.toolbar = this.contentEl.createDiv({ cls: 'graph-ng-toolbar' });
    this.body = this.contentEl.createDiv({ cls: 'graph-ng-body' });
    this.stage = this.body.createDiv({ cls: 'graph-ng-stage' });
    searchable(this.stage, {
      projection: () => this.contentEl.dataset.mode === 'nodes' ? this.projection : undefined,
      rank: (query, visible) => this.detailGeneration === this.activeRevision ? this.plugin.pipeline.request<number[]>(this.activeRevision, { kind: 'search', query, visible }) : Promise.resolve([]),
      filter: query => this.setView({ ...this.view, query }),
    });
    this.statusSummary = this.body.createDiv({ cls: 'graph-ng-summary', attr: { 'aria-live': 'polite' } });
    this.statusSummary.hidden = true;
    this.status = this.body.createDiv({ cls: 'graph-ng-status' });
    this.panel = this.body.createDiv({ cls: 'graph-ng-panel' });
    this.explorePanel = new ExplorePanel(this.body, {
      information: this.status, members: this.panel,
      performanceControls: host => performanceControls(host, this.plugin),
      memberGroups: () => this.groupGraph?.groups, openGroup: id => { void this.drill(id, true); },
      scope: () => this.detailScope ? this.scopeName : 'Workspace', scoped: () => Boolean(this.detailScope),
      presentation: mode => {
        if (mode === 'workspace') {
          if (!this.detailScope) return;
          if (this.detailRenderer && this.contentEl.dataset.mode === 'nodes') {
            if (!this.admitDetail(this.visible!, !this.detailRenderer.gpu, false)) return;
            this.detailScope = undefined; this.detailRenderer.setView(this.visible!, this.renderView()); this.explorePanel?.render(); return;
          }
          this.detailScope = undefined; mode = 'nodes';
        }
        if (mode === 'groups') this.toGroups(); else if (mode !== this.contentEl.dataset.mode) return this.showDetails();
      },
      previewSizing: values => { if (values && !this.detailRenderer) throw new Error('Open Notes first'); this.detailRenderer?.previewSizing(values); },
      sizingReadout: () => this.detailRenderer?.sizingReadout() ?? 'Open Notes to inspect actual radii.',
      applySizing: async values => {
        const renderer = this.detailRenderer, projection = this.projection, scope = this.detailScope, view = this.view, revision = this.activeRevision;
        const current = () => !this.closed && this.detailRenderer === renderer && this.projection === projection && this.detailScope === scope && this.view === view && this.activeRevision === revision;
        try { await this.plugin.commitSizing(values, current); } finally { renderer?.previewSizing(null, true); }
      },
      suggestions: () => this.suggestions(), layoutAdvice: () => { const s = this.stats(); return s && layoutAdvice(s, this.plugin.settings); },
      previewSuggestions: list => this.detailRenderer?.previewSettings(list && suggestionSettings(this.plugin.settings, list)),
      applySuggestions: async list => {
        const renderer = this.detailRenderer, projection = this.projection, revision = this.activeRevision;
        try { await this.plugin.commitSuggestions(list, () => !this.closed && this.detailRenderer === renderer && this.projection === projection && this.activeRevision === revision); }
        finally { renderer?.previewSettings(null); if (this.contentEl.dataset.mode === 'groups') this.showGroups(true); }
      },
      commitSavedView: (saved, expected) => this.plugin.commitSavedView(saved, expected),
      viewCurrent: () => !!this.explored && canonical(this.appliedView) === canonical(this.view),
      savedViewIssue: saved => this.savedViewIssue(saved), openSavedView: saved => this.openSavedView(saved),
      layoutSettled: () => this.layoutSettled, applyLayout: values => this.applyLayout(values), settings: () => this.plugin.settings, result: () => this.explored, loading: () => this.loading(), mode: () => this.contentEl.dataset.mode ?? 'groups',
      policy: () => this.detailRenderer?.policy.reasons ?? [], carriers: () => this.detailRenderer?.carrierCount ?? 0, relationshipNotes: () => this.relationshipNotes(), setRelationshipDisplay: nodes => setRelationshipDisplay(this.plugin, nodes), setView: (view, after) => this.setView(view, after), setColors: colors => this.setColors(colors), preview: (expr, context) => this.previewExpression(expr, context),
      namedViewState: () => this.contentEl.dataset.mode === 'groups' ? 'Groups' : this.detailRenderer?.namedViewState ?? 'Notes',
      lens: () => { const r = this.contentEl.dataset.mode === 'nodes' ? this.detailRenderer : undefined; return { active: !!r && r.lensNode >= 0, available: !!r && (r.lensNode >= 0 || r.selected >= 0 || r.hovered >= 0) }; },
      toggleLens: () => this.detailRenderer?.toggleLens(), toolsChanged: () => this.renderer?.syncTools?.(),
      visualsChanged: labels => { this.plugin.saveSoon(); this.detailRenderer?.refreshVisuals(labels); if (this.contentEl.dataset.mode === 'groups') this.renderer?.refreshTheme?.(); },
      groupColor: code => this.groupColor(code), focusGroup: code => this.focusGroup(code), fit: () => this.detailRenderer?.fitAll(),
      camera: () => this.detailRenderer ? { ...this.detailRenderer.camera } : null, restoreCamera: camera => this.restoreCamera(camera), persist: () => this.plugin.saveSoon(),
    }, this.view, this.toolbar);
    // Creating even a probe GL context can block; the initial group view needs no GPU.
    this.registerEvent(this.app.workspace.on('css-change', () => this.renderer?.refreshTheme?.()));
    this.unsubscribe = this.plugin.subscribe(() => this.refresh());
    const source = this.plugin.propertySource;
    void Promise.resolve().then(() => !this.closed && source === this.plugin.propertySource && source?.load?.()).catch(() => {});
    await this.refresh();
  }
  /** How far the open graph tools panel reaches over the stage from its right edge (CSS px). */
  private toolsOverlap() {
    const tools = this.explorePanel?.root; if (!tools || tools.hidden) return 0;
    const stage = this.stage.getBoundingClientRect(), panel = tools.getBoundingClientRect();
    return panel.width > 0 ? Math.max(0, Math.min(stage.width, stage.right - panel.left)) : 0;
  }
  invalidateSource() { this.explored = undefined; this.explorePanel?.render(); this.contributionPage.clear(); this.groupGeneration = -1; this.revision++; this.renderRevision++; this.provisional = true; if (this.contentEl) this.contentEl.dataset.verified = 'false'; this.renderer?.dispose(); this.renderer = undefined; this.projection = undefined; this.detailGeneration = -1; this.positions = undefined; this.groupGraph = undefined; this.stage?.empty(); this.panel?.empty(); }
  promoteProperties() {
    if (this.closed || this.plugin.settings.projectionFile || !this.groupGraph || this.detailGeneration !== this.activeRevision) return;
    this.provisional = !this.plugin.adapter.factsComplete(); this.contentEl.dataset.verified = String(!this.provisional);
    if (this.report) { this.report.provisional = this.provisional; this.report.linksPending = this.plugin.adapter.linksPending(); this.report.pendingProperties = this.plugin.adapter.pendingProperties(); }
    this.statusText = this.layoutWorking || this.contentEl.dataset.state === 'building' ? this.statusText : this.provisional ? pendingText(this.report) : this.layoutSettled ? '' : 'Layout not settled';
  }
  async onClose() { this.explorePanel?.dispose(); this.contributionPage.clear(); this.closed = true; this.renderRevision++; this.revision++; this.renderer?.dispose(); this.unsubscribe?.(); }
  refresh(): Promise<void> {
    if (this.closed) return Promise.resolve();
    if (this.refreshing) {
      // Coalesce callers onto the next pass, not an indefinitely growing hydration drain.
      const next = () => { this.queuedRefresh = undefined; return this.refresh(); };
      return this.queuedRefresh ??= this.refreshWork!.then(next, next);
    }
    this.refreshing = true;
    return this.refreshWork = this.plugin.serialize(() => this.refreshOnce()).finally(() => {
      this.refreshing = false; if (!this.closed) this.explorePanel?.render();
    });
  }
  performanceChanged() { this.detailRenderer?.refreshVisuals(true); this.explorePanel?.render(); }
  private async refreshOnce() {
    const scope = JSON.stringify([this.plugin.sourceIdentity, this.plugin.settings.projectionFile, this.plugin.settings.groupLevel, this.plugin.settings.declaration.groups, this.view?.group ?? null]);
    if (scope !== this.contributionScope) this.contributionPage.clear();
    this.contributionScope = scope; this.contributionPage.size = this.plugin.settings.listPageSize; this.contributionPage.suspend();
    const rev = ++this.revision, revision = ++this.plugin.nextRevision; this.activeRevision = revision;
    const source = this.plugin.propertySource, propertyRevision = this.plugin.propertyRevision;
    const current = () => !this.closed && rev === this.revision && source === this.plugin.propertySource && propertyRevision === this.plugin.propertyRevision;
    const settings = this.plugin.settings, start = performance.now();
    this.carrierLookup = undefined; this.renderRevision++; this.provisional = true; this.contentEl.dataset.verified = 'false';
    this.report = undefined; this.explored = undefined; this.positions = undefined;
    this.layoutStopped = false; (this.buildProgress ??= new BuildProgress()).start(); this.progressAt = 0; this.readProgress = undefined; this.contentEl.dataset.state = 'building'; this.statusText = this.buildProgress.text(0);
    // Hold the last useful layout, without stale captions, until a progressed replacement exists.
    const heldLayout = this.presentation === 'nodes' ? this.detailRenderer?.beginLayout() : undefined;
    if (this.presentation === 'nodes') this.contentEl.dataset.mode = 'nodes-building';
    let preview: LayoutPreview | undefined;
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
        this.projection = undefined; this.positions = undefined; this.explored = undefined; this.groupGraph = p; this.groupGeneration = revision; this.viewGeneration = -1; this.viewSource = 'external';
        this.contentEl.dataset.state = 'ready'; this.statusText = `External aggregate: ${num(p.groups.length)} groups and ${num(p.groupEdges.length)} counted group pairs. Not verified and not merged with live notes.`;
        this.showGroups(); return;
      }
      const configuredSource = this.sourceKey(this.view), config = { declaration: settings.declaration, layout: settings.layout, source: `${this.plugin.linkProducer}/${this.plugin.sourceIdentity}`, groupLevel: settings.groupLevel, predicate: this.predicate, view: this.view, facetValues: settings.explore?.facetValues, streamEveryIterations: settings.streamEveryIterations };
      // A rebuild from the still-requested view retires an earlier "not applied" message.
      const settled = () => { if (this.viewFeedbackText && config.view === this.view) this.viewFeedback(); };
      const hashes = await this.plugin.pipeline.request<{ declarationHash: string; layoutHash: string; ingestHash: string; held?: boolean }>(revision, { kind: 'configure', config });
      if (!current()) return;
      // A worker already holding this exact generation needs no disk read, decode or cached paint.
      if (settings.persistLayout && !hashes.held) {
        await this.plugin.migrate(revision, hashes.declarationHash);
        const saved = await this.plugin.store.latest(hashes.declarationHash, { source: config.source, layoutHash: hashes.layoutHash, producer: LAYOUT_PRODUCER });
        if (saved) {
          try {
            const cache = await this.plugin.pipeline.request<{ groups?: GroupProjection } | undefined>(revision, { kind: 'load', generation: saved });
            if (cache?.groups && this.presentation !== 'nodes' && current() && !this.predicate && !(this.view && viewNarrows(this.view))) {
              this.projection = undefined; this.positions = undefined; this.groupGraph = cache.groups; this.groupGeneration = -revision; this.viewGeneration = -1; this.viewSource = this.sourceKey(null); this.showGroups(true);
              const c = this.plugin.adapter.coverage(); this.statusText = this.buildProgress.text(0, c.indexed / Math.max(1, c.listed));
              this.contentEl.dataset.cachedPaintMs = String(performance.now() - start); await yieldTask();
            }
          } catch { await this.plugin.store.quarantine(saved.meta); }
        }
      }
      const reset = this.plugin.ingestedHash !== hashes.ingestHash, ingestStart = performance.now();
      for await (const batch of this.plugin.adapter.columns(reset, settings.ingest)) {
        if (!current()) return;
        await this.plugin.pipeline.request(revision, { kind: 'rows', ...batch });
        const c = this.plugin.adapter.coverage(); this.readProgress = { indexed: c.indexed, listed: c.listed };
        this.progressText(this.buildProgress.text(0, c.indexed / Math.max(1, c.listed)));
      }
      const ingestMs = performance.now() - ingestStart;
      this.plugin.ingestedHash = hashes.ingestHash;
      this.plugin.pipeline.onGroups = event => {
        if (event.revision !== revision || !current()) return;
        const groupsAt = performance.now();
        this.appliedView = config.view; this.groupGraph = event.projection; this.groupGeneration = revision; this.viewGeneration = event.view; this.viewSource = configuredSource; if (this.presentation !== 'nodes') this.showGroups(true); settled();
        const painted = performance.now(), firstGroupMs = painted - start;
        this.startupTrace.push({ revision, start, groupsAt, drawMs: painted - groupsAt, firstGroupMs }); if (this.startupTrace.length > 16) this.startupTrace.shift();
        // A queued metadata refresh must not relabel its later paint as cold startup.
        this.contentEl.dataset.firstGroupMs ??= String(firstGroupMs);
        this.contentEl.dataset.refreshGroupMs = String(firstGroupMs);
      };
      this.statusText = this.buildProgress.text(1);
      const projectStart = performance.now(), complete = this.plugin.adapter.factsComplete(); this.provisional = !complete;
      const result = await this.plugin.pipeline.request<ProjectResult>(revision, { kind: 'project', complete: !this.provisional });
      if (!current()) return;
      const projectMs = performance.now() - projectStart;
      if (result.invalidSaved) await this.plugin.store.quarantine(result.invalidSaved);
      const coverage = this.plugin.adapter.coverage(); this.provisional = !this.plugin.adapter.factsComplete();
      this.contentEl.dataset.verified = String(!this.provisional);
      const report: InformationReport = this.report = { nodes: result.nodes, edges: result.edges, listed: coverage.listed, linksPending: this.plugin.adapter.linksPending(), pendingProperties: this.plugin.adapter.pendingProperties(), provisional: this.provisional, unresolved: result.unresolved, duplicates: result.quarantined.length, dropped: result.dropped, missed: result.missed, rows: result.rows, ruleNotes: result.ruleNotes, rules: settings.declaration.edges.map(e => e.name), relationshipNodes: settings.declaration.display.reifiedAsNodes, ...this.vaultCount(settings.declaration) };
      this.statusText = this.buildProgress.text(2);
      this.contentEl.dataset.nodes = String(result.nodes); this.contentEl.dataset.edges = String(result.edges);
      await yieldTask();
      const detail = await this.plugin.pipeline.request<DetailResult>(revision, { kind: 'detail' });
      if (!current()) return;
      this.appliedView = config.view; this.projection = detail.projection; this.detailGeneration = revision; this.viewGeneration = detail.view; this.viewSource = configuredSource; this.visible = detail.visible; this.colors = detail.colors; this.explored = detail.explore; this.renderer?.refreshTheme?.(); this.contentEl.dataset.visibleNodes = String(sum(detail.explore.visible)); this.explorePanel?.render(); this.statusText = this.statusText; settled();
      this.contributionPage.update(this.contributionContext());
      const recycle = (p: Float32Array) => this.plugin.pipeline.recycle(p.buffer as ArrayBuffer);
      preview = new LayoutPreview(async (positions, active) => {
        if (this.gpu.reason === 'Not probed') this.gpu = gpuStatus();
        const bits = this.detailVisible()!, renderRevision = ++this.renderRevision;
        if (!this.admitDetail(bits)) throw new Error(this.detailFallback);
        const previous = this.renderer instanceof DetailRenderer ? this.renderer : undefined;
        this.renderer?.dispose(); this.stage.empty(); this.contentEl.dataset.mode = 'nodes-building';
        const renderer = await DetailRenderer.create(this.stage, this.projection!, positions, bits, settings, () => {}, () => {}, this.colors!, () => active() && renderRevision === this.renderRevision, !this.gpu.available, () => {}, { loading: true, typeHidden: this.renderView().typeHidden });
        if (previous) renderer.adoptCamera(previous);
        this.renderer = renderer; return renderer;
      }, recycle, () => current() && this.presentation === 'nodes', error => {
        this.detailFallback ||= `Layout preview unavailable: ${String(error)}. Showing Groups.`;
        this.showGroups(true); this.statusText = this.statusText;
      });
      this.plugin.pipeline.onPositions = event => {
        if (event.revision === revision && current()) {
          report.progress = { iteration: event.iteration, total: event.total }; this.progressText(this.buildProgress.text(2, event.iteration / Math.max(1, event.total)));
          // One progressed batch in Fast, otherwise two; never the seed. Labels and picking wait; camera stays live.
          if (event.iteration >= (devicePerformance.fast(settings.performance) ? 1 : 2) * settings.streamEveryIterations) { preview!.push(event.positions); return; }
        }
        recycle(event.positions);
      };
      let layout: LayoutResult;
      this.layoutControl(true);
      try { layout = await this.plugin.pipeline.request<LayoutResult>(revision, { kind: 'layout' }); }
      catch (error) { if (String(error).includes('Saved identities')) { await this.plugin.store.quarantine(result.meta); } throw error; }
      finally { this.layoutControl(false); }
      if (!current()) return;
      await preview.finish(true);
      if (!current()) return;
      this.statusText = this.buildProgress.text(3);
      this.positions = layout.positions; this.layoutSettled = layout.settled !== false; if (this.layoutSettled) this.layoutStopped = false; this.explorePanel?.render();
      this.cacheTrace.push({ expected: result.meta.key, stored: layout.stored, nodes: result.nodes, ...coverage, valid: layout.cached }); if (this.cacheTrace.length > 16) this.cacheTrace.shift();
      report.layout = { cached: layout.cached, reused: layout.reused, ms: layout.milliseconds, totalMs: performance.now() - start };
      this.buildProgress.text(4); this.contentEl.dataset.state = 'ready'; this.statusText = this.provisional ? pendingText(report) : this.layoutSettled ? '' : 'Layout not settled';
      this.contentEl.dataset.layoutMs = String(layout.milliseconds); this.contentEl.dataset.cached = String(layout.cached);
      if (this.presentation === 'nodes') await this.showDetails();
      if (current() && !this.provisional) this.plugin.recordPerformance?.({ notes: result.nodes, edges: result.edges, ingestMs, projectMs, groupsMs: Number(this.contentEl.dataset.refreshGroupMs), layoutMs: layout.milliseconds, totalMs: performance.now() - start });
      if (layout.settled !== false && settings.persistLayout && this.plugin.store.committed !== result.meta.key && complete && !this.provisional && (!settings.declaration.edges.some(e => e.kind === 'producer') || this.plugin.adapter.linksResolved)) {
        const generation = await this.plugin.pipeline.request<BinaryGeneration>(revision, { kind: 'encode' });
        if (!current()) return;
        // A failed cache write costs the next open a recompute; it must not fail the drawn graph.
        this.contentEl.dataset.cacheError = await this.plugin.cache(generation, current).then(() => '', String);
      }
    } catch (e) {
      this.plugin.adapter.invalidate(); this.plugin.ingestedHash = ''; this.provisional = true; this.contentEl.dataset.verified = 'false';
      if (current()) { this.report = undefined; this.contentEl.dataset.state = 'error'; if (this.presentation === 'nodes') { this.contentEl.dataset.mode = 'groups'; this.showGroups(true); } this.statusText = `Projection refresh failed: ${String(e)}`; this.contributionPage.fail(`Projection refresh failed: ${String(e)}`); }
    } finally {
      heldLayout?.(false);
      await preview?.finish();
      if (!current()) { this.plugin.adapter.invalidate(); this.plugin.ingestedHash = ''; this.contentEl.dataset.verified = 'false'; }
    }
  }
  /** Groups from Notes: remember the held focus so its group is ringed and a chip leads back. */
  private toGroups() {
    this.detailFallback = ''; this.statusText = this.statusText;
    this.rememberPresentation('groups');
    const back = this.contentEl.dataset.mode === 'nodes' ? this.detailRenderer?.returnPoint() : undefined;
    this.returnTo = back && { ...back, projection: this.projection }; this.showGroups();
  }
  showGroups(preserveSelection = false) {
    if (!preserveSelection) this.contributionPage.clear();
    this.renderRevision++;
    const start = performance.now();
    this.renderer?.dispose(); this.detailRenderer = undefined; this.stage.empty(); this.panel.empty();
    const projection = this.groupGraph, generation = this.groupGeneration, source = this.viewSource; if (!projection) return;
    const settings = this.plugin.settings, size = Math.min(100, settings.groupCanvasPageSize), pages = groupPages(projection, size);
    const back = this.returnTo?.projection === this.projection ? this.returnTo : undefined, ring = back?.group === undefined ? undefined : String(back.group);
    let canvasPage = Math.max(0, Math.floor(pages.ranked.findIndex(g => g.id === ring) / size));
    const draw = (focus = '') => {
      this.renderer?.dispose(); this.stage.empty();
      const selected = pages.canvas(canvasPage);
      this.renderer = new GroupRenderer(this.stage, selected, settings, id => this.drill(id), edge => this.edgeList(edge, projection, generation, source), id => this.groupColor(Number(id)), ring, () => this.toolsOverlap(), pages.ranked[0]?.count);
      if (this.detailFallback) this.stage.createEl('button', { cls: 'graph-ng-back-chip', text: 'Narrow filters to see notes' }).onclick = () => this.explorePanel?.show('filters');
      if (back) this.stage.createEl('button', { cls: 'graph-ng-back-chip', text: 'Back to ' + back.name }).onclick = () => { this.pendingCamera = back.camera; this.pendingFocus = back; void this.showDetails(); };
      const head = this.stage.createDiv({ cls: 'graph-ng-groups-heading' });
      const notes = () => { void this.showDetails(); };
      stateChip(head.createDiv({ cls: 'graph-ng-state-strip' }), 'Groups', '', notes, state => this.explorePanel?.showAppearance(state), state => { if (state === 'Notes') notes(); });
      head.createSpan({ text: `${plural(projection.groups.length, 'group')} by ` });
      const group = this.appliedView?.group ?? settings.declaration.groups[settings.groupLevel];
      const choice = head.createEl('button', { text: settings.projectionFile ? 'declared groups' : group ? groupLabel(group) : 'all notes', cls: 'graph-ng-help-trigger' });
      choice.disabled = !!settings.projectionFile; choice.onclick = () => { this.explorePanel?.show('filters'); this.explorePanel?.root.querySelector<HTMLSelectElement>('[aria-label="Group by"]')?.focus(); };
      head.createSpan({ text: ', largest first' });
      if (size !== settings.groupCanvasPageSize) head.createSpan({ text: ` (${size} groups per page limit)` });
      const controls = this.stage.createDiv({ cls: 'graph-ng-canvas-pager' }); controls.hidden = projection.groups.length <= size;
      const previous = iconButton(controls, 'Previous groups', 'chevron-left'); previous.disabled = canvasPage === 0; previous.onclick = () => { canvasPage--; draw('previous'); };
      controls.createSpan({ text: `Groups ${projection.groups.length ? canvasPage * size + 1 : 0}–${Math.min((canvasPage + 1) * size, projection.groups.length)}, ${projection.groups.length} total` });
      const more = Math.max(0, projection.groups.length - (canvasPage + 1) * size);
      const next = controls.createEl('button', { text: `+${more} more`, attr: { 'aria-label': 'Next groups' } }); next.hidden = next.disabled = !more; next.onclick = () => { canvasPage++; draw('next'); };
      controls.createEl('button', { text: 'List' }).onclick = () => this.explorePanel?.show('members');
      if (focus) (focus === 'previous' && !previous.disabled ? previous : !next.disabled ? next : previous).focus();
      this.contentEl.dataset.canvasGroups = String(selected.groups.length);
    };
    draw();
    this.paginate(pages.ranked, (g, host) => { const b = host.createEl('button', { cls: 'graph-ng-count-row', attr: { 'data-group': g.id } }); b.createSpan({ text: g.label }); b.createSpan({ cls: 'graph-ng-count', text: plural(g.count, 'note') }); b.onclick = () => this.drill(g.id); }, this.panel, 'graph-ng-group-controls', 'Groups');
    const edges = this.section('relationships'); disclosure(edges, `Relationships (${plural(projection.groupEdges.length, 'group pair')})`);
    this.paginate(projection.groupEdges, (edge, host) => {
      host.createEl('button', { text: `${pages.labels.get(edge.a)} ↔ ${pages.labels.get(edge.b)} (${plural(edge.total, 'edge')})`, cls: 'graph-ng-edge' }).onclick = () => this.edgeList(edge, projection, generation, source);
    }, disclosureBody(edges));
    if (this.projection?.quarantined.length) {
      const conflicts = this.section('quarantine', 'graph-ng-quarantine');
      disclosure(conflicts, `${this.projection.quarantined.length} notes share an ID (excluded)`);
      this.paginate(this.projection.quarantined, (note, host) => { host.createEl('button', { text: `${note.path} (${note.id})` }).onclick = () => this.openPath(note.path); }, disclosureBody(conflicts));
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
  /** Connection card: reuse an open note tab, a new tab, or a split to the right. */
  private openNote(path: string, mode: 'reuse' | 'tab' | 'split') {
    const file = this.app.vault.getAbstractFileByPath(path), w = this.app.workspace;
    if (!(file instanceof TFile)) { new Notice('The referenced note is not available locally.'); return; }
    const leaf = mode === 'split' ? w.getLeaf('split', 'vertical') : (mode === 'reuse' && w.getLeavesOfType('markdown').find(l => !l.getViewState().pinned)) || w.getLeaf('tab');
    void leaf.openFile(file).then(() => w.revealLeaf(leaf)).catch(() => new Notice('Could not open the note'));
  }
  private copyLink(path: string) {
    const file = this.app.vault.getAbstractFileByPath(path);
    const link = `[[${file instanceof TFile ? this.app.metadataCache.fileToLinktext(file, '', true) : path.replace(/\.md$/, '')}]]`;
    void navigator.clipboard.writeText(link).then(() => new Notice('Link copied'), () => new Notice('Could not copy the link'));
  }
  private paginate<T>(items: readonly T[], render: (item: T, host: HTMLElement) => void, host = this.panel, listClass = 'graph-ng-list', noun = 'Items') {
    let index = 0; const size = this.plugin.settings.listPageSize, root = host.createDiv({ cls: 'graph-ng-pagination' });
    const controls = root.createDiv({ cls: 'graph-ng-page-controls' }), previous = controls.createEl('button', { text: 'Previous page' });
    const label = controls.createSpan(), next = controls.createEl('button', { text: 'Next page' }), list = root.createDiv({ cls: listClass });
    controls.hidden = items.length <= size;
    const draw = () => {
      list.empty(); for (const item of page(items, index, size)) render(item, list);
      previous.disabled = index === 0; next.disabled = (index + 1) * size >= items.length;
      label.textContent = `${noun} ${num(items.length ? index * size + 1 : 0)}–${num(Math.min((index + 1) * size, items.length))}, ${num(items.length)} total`;
    };
    previous.onclick = () => { index--; draw(); }; next.onclick = () => { index++; draw(); }; draw();
  }
  /** Search the fetched group dictionary; render only the configured page, never a full tree. */
  private memberList<T>(items: readonly T[], path: (item: T) => string, browse = false) {
    if (!browse) this.panel.createEl('button', { text: 'Back to groups' }).onclick = () => this.showGroups();
    const search = this.panel.createEl('input', { attr: { type: 'search', placeholder: 'Search name or folder…', 'aria-label': 'Search available group members' } });
    const rows = this.panel.createDiv({ cls: 'graph-ng-members' });
    const draw = () => {
      const query = search.value.trim().toLocaleLowerCase(); rows.empty();
      const filtered = query ? items.filter(item => path(item).toLocaleLowerCase().includes(query)) : items;
      rows.createDiv({ text: plural(filtered.length, query ? 'matching note' : 'available note'), cls: 'graph-ng-explore-note', attr: { role: 'status' } });
      this.paginate(filtered, (item, host) => {
        const full = path(item), parts = full.split('/'), name = parts.pop()!.replace(/\.md$/, ''), button = host.createEl('button', { cls: 'graph-ng-member', attr: { 'aria-label': `Open ${full}` } });
        button.createSpan({ text: name });
        if (parts.length) button.createEl('small', { text: parts.join('/') });
        button.onclick = () => this.openPath(full);
      }, rows, 'graph-ng-list', 'Notes');
    };
    search.oninput = draw;
    rows.onkeydown = e => {
      const buttons = [...rows.querySelectorAll<HTMLButtonElement>('.graph-ng-member')], index = buttons.indexOf(document.activeElement as HTMLButtonElement);
      if (index < 0 || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
      e.preventDefault(); buttons[e.key === 'Home' ? 0 : e.key === 'End' ? buttons.length - 1 : Math.max(0, Math.min(buttons.length - 1, index + (e.key === 'ArrowDown' ? 1 : -1)))]?.focus();
    };
    draw();
  }
  private async drill(id: string, browse = false) {
    this.contributionPage.clear();
    const group = this.groupGraph?.groups.find(g => g.id === id); if (!group) return;
    if (!browse) this.scopeName = group.label;
    this.explorePanel?.show('members');
    this.panel.empty();
    const heading = this.panel.createDiv({ cls: 'graph-ng-member-heading' }), title = browse ? heading.createDiv({ cls: 'graph-ng-row' }) : heading;
    if (browse) iconButton(title, 'Back to groups', 'arrow-left').onclick = () => this.explorePanel?.browseGroups(id);
    title.createEl('strong', { text: group.label });
    heading.createSpan({ text: `${plural(group.count, 'note')} in group${this.provisional ? ' (provisional)' : ''}` });
    const revision = this.activeRevision, projection = this.projection, renderRevision = browse ? this.renderRevision : ++this.renderRevision, view = this.viewGeneration;
    if (projection && !currentDetailGeneration(revision, this.activeRevision, this.detailGeneration)) { new Notice('Member dictionary is updating; try this group again when verification finishes.'); return; }
    const status = this.panel.createDiv({ text: 'Loading members…', attr: { role: 'status', 'aria-live': 'polite' } });
    const current = () => revision === this.activeRevision && view === this.viewGeneration && (!projection || currentDetailGeneration(revision, this.activeRevision, this.detailGeneration)) && renderRevision === this.renderRevision && !this.closed && this.panel.contains(status);
    const back = () => { if (!browse) this.panel.createEl('button', { text: 'Back to groups' }).onclick = () => this.showGroups(); };
    // An obsolete answer never fills the panel, but a status it still owns must not stay "Loading".
    const stale = () => { if (!this.closed && this.panel.contains(status)) { status.textContent = 'Members out of date. Select the group again.'; back(); } };
    let members: Uint32Array | undefined;
    try { members = projection ? await this.plugin.pipeline.request<Uint32Array>(revision, { kind: 'members', group: id, view }) : undefined; }
    catch {
      if (current()) { status.textContent = 'Could not load members. Return to groups and select this group again.'; back(); } else stale();
      return;
    }
    if (!current()) { stale(); return; }
    status.remove();
    if (!members || !projection) {
      if (group.openPath) this.panel.createEl('button', { text: 'Open group note' }).onclick = () => this.openPath(group.openPath!);
      const local = group.identityPrefix ? this.plugin.adapter.snapshot().filter(r => this.plugin.settings.declaration.identity.some(k => typeof r.properties[k.key] === 'string' && (r.properties[k.key] as string).startsWith(group.identityPrefix!))) : [];
      if (local.length) this.memberList(local, row => row.path, browse);
      else this.panel.createDiv({ text: 'Producer aggregate: member bodies are not included. No local members matched its declared identity prefix.' });
      return;
    }
    const p = projection;
    if (browse) { this.memberList(Array.from(members), i => renderPath(p, i), true); return; }
    try { if (this.gpu.reason === 'Not probed') this.gpu = await this.plugin.pipeline.request<typeof this.gpu | undefined>(revision, { kind: 'gpu' }) ?? gpuStatus(); }
    catch (error) { new Notice(`GPU probe failed: ${String(error)}. Use group member lists.`); }
    if (revision !== this.activeRevision || renderRevision !== this.renderRevision || this.closed) return;
    if (this.gpu.available && this.positions) { const bits = new Uint8Array(p.nodeCount); for (const i of members) bits[i] = 1; this.detailScope = bits; this.showDetails(bits, false); }
    this.memberList(Array.from(members), i => renderPath(p, i));
  }
  private contributionHeading(edge?: GroupProjection['groupEdges'][number]) {
    this.panel.empty();
    this.panel.createEl('strong', { text: edge ? Object.entries(edge.typeCounts).map(([t, n]) => `${t}: ${num(n)}`).join(', ') : 'Contributing relationships' });
    if (edge?.directional) { this.panel.createDiv({ text: `A → B: ${JSON.stringify(edge.directional.aToB)}` }); this.panel.createDiv({ text: `B → A: ${JSON.stringify(edge.directional.bToA)}` }); }
  }
  private async edgeList(edge: GroupProjection['groupEdges'][number], clickedGraph = this.groupGraph, clickedGeneration = this.groupGeneration, clickedSource = this.viewSource) {
    this.explorePanel?.show('members');
    this.contributionPage.clear();
    if (!this.plugin.settings.projectionFile) {
      this.contributionPage.select(edge.a, edge.b, clickedGeneration, clickedGraph, clickedSource);
      this.contributionPage.update(this.contributionContext());
      return;
    }
    this.contributionHeading(edge);
    const renderRevision = ++this.renderRevision;
    if (!this.carrierLookup) {
      const status = this.panel.createDiv({ text: 'Resolving relationship notes…', attr: { role: 'status' } });
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
  private contributionContext(): ContributionContext {
    return { active: this.activeRevision, groups: this.groupGeneration, detail: this.detailGeneration, level: this.plugin.settings.groupLevel, projection: this.projection, graph: this.groupGraph, values: this.explored?.groupKeys, view: this.viewGeneration, source: this.viewSource };
  }
  /** Grouping identity: the runtime group source (or declared default at the configured level). */
  private sourceKey(view: ExploreView | null | undefined) {
    return `${canonical(view?.group ?? null)}@${this.plugin.settings.groupLevel}`;
  }
  private renderContributionPanel() {
    const pager = this.contributionPage; if (!pager.selection || this.closed || !this.panel) return;
    this.contributionHeading(pager.edge);
    const status = this.panel.createDiv({ cls: 'graph-ng-contribution-status', attr: { role: 'status', 'data-state': pager.status }, text: pager.message });
    if (pager.status === 'error') status.createEl('button', { text: 'Retry' }).onclick = () => pager.retry(this.contributionContext());
    if (pager.status !== 'ready' || !pager.result) return;
    const { total, items } = pager.result, root = this.panel.createDiv({ cls: 'graph-ng-pagination' }), controls = root.createDiv();
    const previous = controls.createEl('button', { text: 'Previous page' }), next = controls.createEl('button', { text: 'Next page' });
    previous.disabled = pager.offset === 0; next.disabled = pager.offset + pager.size >= total;
    previous.onclick = () => pager.move(-1, this.contributionContext()); next.onclick = () => pager.move(1, this.contributionContext());
    controls.createSpan({ text: ` ${total ? pager.offset + 1 : 0}–${Math.min(pager.offset + pager.size, total)}, ${total} total ` });
    for (const r of items) { const item = root.createDiv({ cls: 'graph-ng-contribution' }); item.createSpan({ text: `${r.source} → ${r.target} [${r.type}] ` }); if (r.carrier) item.createEl('button', { text: r.carrier }).onclick = () => this.openPath(r.carrier!); }
  }
  /** Prepare CPU coordinates, persist, then commit on the existing renderer/context. */
  private layoutSettled = true;
  private async applyLayout(values: PhysicsValues) {
    const revision = this.activeRevision, projection = this.projection, old = this.detailRenderer;
    const current = generationCurrent(() => [this.closed, this.activeRevision, this.projection, this.positions, this.plugin.settings.layout, canonical(this.plugin.settings.layout), this.renderRevision, this.detailRenderer, this.detailScope, this.visible, this.explored]);
    await this.plugin.serialize(async () => {
      let token: CoordinateToken | undefined, finish: ((committed: boolean) => void) | undefined, committed = false, working = false, streamError: unknown;
      const previousStream = this.plugin.pipeline.onPositions;
      const ready = () => current() && (!token || token.current());
      try {
        if (this.closed || !current() || !projection || this.detailGeneration !== revision || this.plugin.settings.projectionFile) throw new Error('Layout unavailable or generation changed');
        const next = physicsSettings(this.plugin.settings, values);
        this.layoutWorking = working = true; this.layoutStopped = false; (this.buildProgress ??= new BuildProgress()).start(); this.progressAt = 0; this.statusText = this.buildProgress.text(2);
        finish = old?.beginLayout();
        this.plugin.pipeline.onPositions = event => {
          if (event.revision !== revision || !current() || streamError) { this.plugin.pipeline.recycle(event.positions.buffer as ArrayBuffer); return; }
          this.progressText(this.buildProgress.text(2, event.iteration / Math.max(1, event.total)));
          if (event.iteration > 0 && finish) { try { old!.streamPositions(event.positions); } catch (e) { streamError = e; } }
          else this.plugin.pipeline.recycle(event.positions.buffer as ArrayBuffer);
        };
        this.layoutControl(true);
        const result = await this.plugin.pipeline.request<LayoutResult>(revision, { kind: 'recompute', options: next.layout, initial: this.positions!.slice() });
        this.plugin.pipeline.onPositions = previousStream;
        requireLayout(current); if (streamError) throw streamError;
        this.statusText = this.buildProgress.text(3);
        if (old && this.contentEl.dataset.mode === 'nodes') token = await old.preparePositions(result.positions, current);
        await this.plugin.commitLayout(values, ready, () => {
          token?.commit();
          this.positions = result.positions; this.layoutSettled = result.settled !== false; if (this.layoutSettled) this.layoutStopped = false;
          committed = true;
        });
        // The worker adopts only after settings and visible coordinates commit. A failed
        // derived-cache write must not roll back the already committed renderer.
        if (result.settled !== undefined) {
          await this.plugin.pipeline.request(revision, { kind: 'adoptLayout' });
          if (result.settled && this.plugin.settings.persistLayout && !this.provisional && (!this.plugin.settings.declaration.edges.some(e => e.kind === 'producer') || this.plugin.adapter.linksResolved)) {
            const generation = await this.plugin.pipeline.request<BinaryGeneration>(revision, { kind: 'encode' });
            this.contentEl.dataset.cacheError = await this.plugin.cache(generation, () => !this.closed && this.activeRevision === revision && this.positions === result.positions).then(() => '', String);
          }
        }
      } finally {
        this.layoutControl(false); this.plugin.pipeline.onPositions = previousStream; token?.discard();
        try { finish?.(committed); }
        finally { if (working) { this.layoutWorking = false; this.statusText = this.provisional ? pendingText(this.report) : this.layoutSettled ? '' : 'Layout not settled'; } }
      }
    });
  }
  /** Renderer masks for the current explore result: group codes, collapsed groups, hidden types. */
  private renderView(): RenderView {
    const r = this.explored; if (!r) return {};
    const collapsed = new Uint8Array(r.groupKeys.length), keys = new Set(this.view.collapsedGroups), types = new Set(this.view.hiddenTypes);
    r.groupKeys.forEach((k, i) => { if (keys.has(k)) collapsed[i] = 1; });
    return { groupCodes: r.groupCodes, groupLabels: r.groupLabels, collapsed, typeHidden: Uint8Array.from(r.types, t => types.has(t) ? 1 : 0), colors: this.colors };
  }
  savedViewIssue(saved: SavedView): string {
    try {
      validateSaved([saved]);
      const s = this.plugin.settings, r = this.explored;
      if (s.projectionFile) return 'This graph contains aggregate groups, not note rows. These saved note views cannot be opened here.';
      if (this.closed || !this.projection || !r || this.refreshing || this.detailGeneration !== this.activeRevision || this.contentEl.dataset.mode === 'nodes-building') return 'Graph is loading. You can save a definition; opening is unavailable.';
      if (this.detailScope) return 'A selected group is limiting this graph. Use Workspace scope before opening this view.';
      const group = saved.view.group ?? s.declaration.groups[s.groupLevel];
      const needed = [...saved.view.filters.flatMap(f => predicateColumn(f) ?? []), ...(group ? [sourceColumn(group)].flatMap(k => k ?? []) : [])];
      const missing = needed.filter(k => !r.facets.some(f => f.key === k));
      if (missing.length) return `Requires projected property: ${[...new Set(missing)].join(', ')}. Not opened; graph configuration unchanged.`;
      const absent = [...saved.view.hiddenColors.filter(k => k !== NO_COLOR && !s.declaration.colors.some(c => c.name === k)), ...saved.view.hiddenTypes.filter(k => !r.types.includes(k))];
      if (absent.length) return `Not present in this projection: ${absent.join(', ')}. Review the saved definition before opening.`;
      return '';
    } catch (error) { return String(error); }
  }
  async openSavedView(saved: SavedView) {
    saved = structuredClone(saved);
    const issue = this.savedViewIssue(saved); if (issue) throw new Error(issue);
    const current = generationCurrent(() => [this.closed, this.activeRevision, this.projection, this.detailScope, this.renderRevision, this.detailRenderer, this.plugin.sourceIdentity, canonical(this.plugin.settings.declaration), this.plugin.settings.groupLevel, this.plugin.settings.projectionFile]);
    await new Promise<void>((resolve, reject) => this.setView(saved.view, () => {
      // Never switch representation, expand scope or construct a renderer to restore a bookmark.
      this.detailRenderer?.clearTrail();
      if (saved.camera && this.contentEl.dataset.mode === 'nodes') this.detailRenderer?.flyTo(saved.camera.x, saved.camera.y, saved.camera.ratio);
    }, undefined, error => error ? reject(error) : resolve(), current));
  }
  /** Latest-wins worker view recompute; no re-projection, relayout or renderer rebuild. */
  setView(view: ExploreView, after?: () => void, colors?: GraphDeclaration['colors'], completion?: (error?: unknown) => void, current?: () => boolean) {
    if (this.plugin.settings.projectionFile) { completion?.(new Error('Note views are unavailable in aggregate graphs.')); return; }
    this.exploreCompletion?.(new Error('View request superseded')); this.exploreCompletion = completion;
    const request = this.exploreRequest = (this.exploreRequest ?? 0) + 1;
    const owns = () => !this.closed && request === this.exploreRequest;
    this.exploreQueued = undefined;
    const finish = (error?: unknown) => { if (request === this.exploreRequest) { this.exploreCompletion = undefined; completion?.(error); } };
    const needed = [...view.filters.flatMap(f => predicateColumn(f) ?? []), ...(view.group ? [sourceColumn(view.group)].flatMap(k => k ?? []) : [])];
    const known = new Set(this.explored?.facets.map(f => f.key));
    const missing = needed.filter(k => !known.has(k));
    if (missing.length && completion) { finish(new Error('Requires projected property. Not opened.')); return; }
    if (missing.length) {
      this.view = view; const settings = this.plugin.settings; settings.explore.view = canonicalView(view);
      this.viewFeedback('Rebuilding the projection for this view… Displayed graph may still show the previous result.');
      void (async () => {
        try {
          await this.plugin.apply({ ...settings, declaration: { ...settings.declaration, columns: [...new Set([...settings.declaration.columns, ...missing])] } });
          if (owns()) this.viewFeedback();
        } catch (error) {
          if (owns()) this.viewFeedback(`View not applied: ${String(error)}. Requested settings retained; storage may be incomplete and the displayed graph is unchanged.`, () => { if (owns()) this.setView(structuredClone(view), after, colors); });
        }
      })();
      return;
    }
    this.view = view; this.plugin.settings.explore.view = canonicalView(view); this.plugin.saveSoon();
    const run = async () => {
      this.exploring = true;
      const revision = this.activeRevision, started = performance.now();
      try {
        if (current && !current()) throw new Error('Graph configuration changed. Review this view again.');
        if (!this.projection || !currentDetailGeneration(revision, this.activeRevision, this.detailGeneration)) throw new Error('Projection generation changed');
        const sent = view, result = await this.plugin.pipeline.request<ViewResult>(revision, { kind: 'explore', view: sent, colors, facetValues: this.plugin.settings.explore.facetValues });
        if (this.closed || revision !== this.activeRevision || request !== this.exploreRequest || (current && !current())) throw new Error('View request superseded or generation changed');
        if (completion) {
          // Group keys belong to the requested grouping, not the displayed one.
          // Validate the existing worker result before adopting it; no extra evaluation.
          const absent = [...sent.hiddenGroups, ...sent.collapsedGroups].filter(k => !result.explore.groupKeys.includes(k));
          if (absent.length) throw new Error(`Not present in the saved grouping: ${absent.join(', ')}. Review the saved definition before opening.`);
        }
        // One admission for every caller, on the scope-intersected mask the renderer would draw.
        const detail = this.contentEl.dataset.mode === 'nodes' ? this.detailRenderer : undefined, scope = this.detailScope;
        const fits = !detail || this.admitDetail(scope ? result.explore.visible.map((v, i) => v & scope[i]!) : result.explore.visible, !detail.gpu, !completion);
        if (!fits && completion) throw new Error('Detail limit exceeded; displayed graph is unchanged');
        this.appliedView = sent; this.explored = result.explore; this.colors = result.colors; this.visible = result.explore.visible; this.groupGraph = result.groups; this.groupGeneration = revision;
        this.viewGeneration = result.view; this.viewSource = this.sourceKey(sent);
        this.contentEl.dataset.exploreMs = String(performance.now() - started); const g = this.view.group; this.contentEl.dataset.groupSource = !g ? 'declared' : g.from === 'folder' ? `folder:${g.depth}` : g.from === 'expr' ? 'expression' : `${g.from}:${g.key}`; this.contentEl.dataset.visibleNodes = String(sum(result.explore.visible));
        this.contributionPage.update(this.contributionContext()); this.statusText = this.statusText;
        if (detail && fits) detail.setView(this.detailVisible()!, this.renderView());
        else if (detail || this.contentEl.dataset.mode === 'groups') { this.showGroups(true); if (this.presentation === 'nodes' && fits) await this.showDetails(); }
        this.explorePanel?.setState(this.view); after?.(); if (owns()) this.viewFeedback(); finish();
      } catch (error) {
        finish(error);
        // A saved-view Open reports through its caller; its retry is Open, which re-runs every check.
        if (!completion && owns() && !String(error).includes('generation changed') && !String(error).includes('Expression superseded')) {
          this.viewFeedback(`View not applied: ${String(error)}. Requested settings may differ from the displayed graph.`, () => { if (owns()) this.setView(structuredClone(view), after, colors); });
        }
      } finally {
        this.exploring = false; const next = this.exploreQueued; this.exploreQueued = undefined; if (next) void next();
      }
    };
    if (this.exploring) { this.exploreQueued = run; this.plugin.pipeline.cancelEvaluation('explore'); } else void run();
  }
  /** Markdown notes in the vault, and per declared excluded folder those under it (first match), as the adapter keeps them. */
  private vaultCount(d: GraphDeclaration) {
    const folders = (d.exclude ?? []).map(folderPath), counts = folders.map(() => 0), files = this.app.vault.getMarkdownFiles();
    for (const f of files) { const i = folders.findIndex(x => f.path.startsWith(x + '/')); if (i >= 0) counts[i]!++; }
    return { vault: files.length, excluded: folders.map((f, i): [string, number] => [f, counts[i]!]) };
  }
  private noteCount?: [RenderProjection, number];
  /** Distinct relationship-note rows behind loaded edges; the same count in Lines and Nodes. */
  private relationshipNotes() {
    const p = this.projection; if (!p) return 0;
    if (this.noteCount?.[0] !== p) { const rows = new Set<number>(); for (const c of p.carrier) if (c !== 0xffffffff) rows.add(c); this.noteCount = [p, rows.size]; }
    return this.noteCount[1];
  }
  private statsCache?: [RenderProjection, GraphStats];
  /** Suggestions for the loaded note graph; null until one is open. Stats cached per projection. */
  private stats() {
    const r = this.detailRenderer; if (!r) return;
    const p = r.projection, c = this.statsCache?.[0] === p ? this.statsCache : this.statsCache = [p, graphStats(p.offsets, p.source.length, r.carrierCount, 0, p.source, p.target)];
    return { ...c[1], groups: this.explored?.groupKeys.length ?? 0 };
  }
  private suggestions(): Suggestion[] | null {
    const s = this.stats(); return s ? recommend(s, this.plugin.settings) : null;
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
  private admitDetail(bits: Uint8Array, software = !this.gpu.available, fallback = true) {
    try {
      const s = this.plugin.settings;
      if (software) canvasDetailEdges(this.projection!, bits, s.canvasMaxDetailNodes, s.canvasMaxDetailEdges);
      return true;
    } catch (e) {
      const s = this.plugin.settings, count = sum(bits);
      const reason = e instanceof CanvasLimit ? count > s.canvasMaxDetailNodes ? `${num(count)} notes exceed this renderer's ${num(s.canvasMaxDetailNodes)}-note limit` : `More than ${num(s.canvasMaxDetailEdges)} edges exceed this renderer's edge limit` : String(e);
      if (fallback) { this.detailFallback = `${reason}. ${CANVAS_FALLBACK}`; this.statusText = this.statusText; } else new Notice(this.statusText = reason);
      return false;
    }
  }
  private detailVisible() { return this.detailScope ? this.visible?.map((v, i) => v & this.detailScope![i]!) : this.visible; }
  async showDetails(bits = this.detailVisible(), clearPanel = true) {
    const focus = this.pendingFocus; this.pendingFocus = undefined;
    if (this.contentEl.dataset.state === 'building') { this.rememberPresentation('nodes'); return; }
    if (!this.projection || !this.positions || !bits) { new Notice('Notes are not ready; Groups remains usable.'); return; }
    this.rememberPresentation('nodes');
    const renderRevision = ++this.renderRevision; this.contentEl.dataset.mode = 'nodes-building'; this.returnTo = undefined;
    try {
      if (this.gpu.reason === 'Not probed') this.gpu = await this.plugin.pipeline.request<typeof this.gpu | undefined>(this.activeRevision, { kind: 'gpu' }) ?? gpuStatus();
      if (renderRevision !== this.renderRevision || this.closed) return;
      if (!this.admitDetail(bits)) { this.showGroups(true); return; }
      const preview = this.renderer instanceof DetailRenderer && this.renderer !== this.detailRenderer ? this.renderer : undefined;
      if (preview) preview.canvas.style.position = 'absolute';
      else { this.renderer?.dispose(); this.stage.empty(); }
      if (clearPanel) { this.contributionPage.clear(); this.panel.empty(); }
      const projection = this.projection;
      this.detailRenderer = await DetailRenderer.create(this.stage, projection, this.positions, bits, this.plugin.settings, i => this.openPath(renderPath(projection, i)), () => this.toGroups(), this.colors!, () => renderRevision === this.renderRevision, !this.gpu.available, () => {
        if (renderRevision !== this.renderRevision || this.closed) return;
        this.gpu = { available: false, reason: 'WebGL context could not be restored' };
        this.showGroups(); void this.showDetails(bits, clearPanel);
      }, this.renderView());
      const moved = preview && this.detailRenderer.adoptCamera(preview);
      preview?.dispose();
      this.plugin.recordPerformance?.({ notes: projection.nodeCount, edges: projection.source.length, labelsMs: this.detailRenderer.timings.labels, labelUploadMs: this.detailRenderer.timings.labelUpload });
      this.renderer = this.detailRenderer; this.contentEl.dataset.mode = 'nodes'; this.detailFallback = ''; this.statusText = this.statusText;
      const detailGeneration = this.detailGeneration;
      this.detailRenderer.describeEdges = edges => this.plugin.pipeline.request(detailGeneration, { kind: 'relationships', edges });
      this.detailRenderer.openPath = path => this.openPath(path);
      this.detailRenderer.openNote = (path, mode) => this.openNote(path, mode);
      this.detailRenderer.copyLink = path => this.copyLink(path);
      this.detailRenderer.noteTitle = path => {
        const title: unknown = this.app.metadataCache.getCache(path)?.frontmatter?.title;
        return typeof title === 'string' ? title.slice(0, 256) : '';
      };
      this.detailRenderer.measureTools = () => this.toolsOverlap(); this.detailRenderer.syncTools?.();
      this.detailRenderer.showMenu = obsidianMenu(this.app, Menu, path => { const f = this.app.vault.getAbstractFileByPath(path); return f instanceof TFile ? f : null; }, this.leaf);
      this.detailRenderer.onSizingChange = () => { this.explorePanel?.updateSizingReadout(); this.explorePanel?.updateLensControl(); };
      this.detailRenderer.onViewStateChange = () => this.explorePanel?.updateViewState();
      this.detailRenderer.tuneViewState = state => this.explorePanel?.showAppearance(state);
      this.detailRenderer.showViewGroups = () => this.toGroups();
      this.detailRenderer.onLensChange = () => this.explorePanel?.updateLensControl();
      this.detailRenderer.onMoreConnections = focus => this.detailRenderer?.showConnections(focus);
      this.detailRenderer.onHub = group => { const key = this.explored?.groupKeys[group]; if (key !== undefined) this.setView({ ...this.view, collapsedGroups: this.view.collapsedGroups.filter(k => k !== key) }, () => this.focusGroup(group)); };
      if (this.pendingCamera) { const c = this.pendingCamera; this.pendingCamera = undefined; this.detailRenderer.flyTo(c.x, c.y, c.ratio); }
      else if (!moved) this.detailRenderer.fitAll(0);
      if (focus?.projection === this.projection) this.detailRenderer.focusNote(focus.node, focus.lens);
      this.explorePanel?.render();
    } catch (e) { if (renderRevision !== this.renderRevision) return; this.gpu = { available: false, reason: String(e) }; this.detailFallback = `Notes could not be drawn: ${String(e)}. Showing Groups.`; this.showGroups(); this.statusText = ''; }
  }
}
const CANVAS_FALLBACK = 'Showing Groups. Narrow filters to see notes.';
/** Whether a view hides anything relative to the unfiltered declared grouping. */
const viewNarrows = (v: ExploreView) => Boolean(v.query.trim() || v.filters.length || v.group || v.hiddenGroups.length || v.hiddenColors.length || v.hiddenTypes.length);
class GraphSettings extends PluginSettingTab {
  constructor(private plugin: GraphPlugin) { super(plugin.app, plugin); }
  display() {
    this.containerEl.empty();
    const controls = this.containerEl.createDiv();
    const redraw = () => { controls.empty(); performanceControls(controls, this.plugin, redraw); }; redraw();
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
