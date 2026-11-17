import { setIcon } from 'obsidian';
import { workingText } from './working';
import { panelHelp, disclosure, disclosureBody, settingRow, settingSelect, panelButton, iconButton } from './panel-help';
import { everythingView, folderPredicate, folderView } from './saved-views';
import { sizingValues, sizingSettings, MAX_NODE_RADIUS, type NodeSizingValues } from './node-sizing';
import { physicsSettings, presetValues, PHYSICS_FIELDS, PHYSICS_PRESETS, type PhysicsKey, type PhysicsValues } from './physics-controls';
import { editAsExpression, builderPredicate, checked } from './core/expr/engine';
import { validate } from './core/expr/syntax';
import { filterSummary, setToggles, toggleable, toggledValues } from './filter-summary';
import { countSpan, num, plural, statRow, sum } from './graph-information';
import { suggestions } from './core/expr/autocomplete';
import { declaredKeys } from './core/columns';
import { describePredicate, groupLabel, NO_COLOR, VIEW_LIMITS, validateSaved, validateView, type ExploreResult, type ExploreView, type SavedView, type ViewCamera } from './core/explore';
import { canonical, validateDerivedGroup, validatePredicate, type GraphDeclaration, type GroupSource, type Predicate, type Scalar } from './core/declaration';
import { defaults, defaultVisuals, type EdgeMode, type Settings, type Visuals } from './settings';
import { progressiveSlider, type Curve, type SliderOptions } from './progressive-slider';
/** Slider travel per numeric layout control; typed values outside the span stay unclamped. */
const PHYSICS_CURVES: Partial<Record<PhysicsKey, Curve>> = { hubGravity: { min: 0, max: 10 }, familyPull: { min: 0, max: 10 }, scalingRatio: { min: .1, max: 100, log: true }, gravity: { min: 0, max: 20, k: 3 }, slowDown: { min: .1, max: 100, log: true }, iterations: { min: 1, max: 1000, log: true, int: true }, barnesHutTheta: { min: .1, max: 3, k: 2 } };
import { recommendedPhysics, suggestionCopy, type Suggestion } from './recommend';
/** The view owns the worker, renderer and persistence; the panel only edits state. */
export interface PanelHost {
  settings(): Settings;
  loading?(): { stage: string; indexed?: number; listed?: number } | undefined;
  information?: HTMLElement;
  members?: HTMLElement;
  memberGroups?(): readonly { id: string; label: string; count: number }[] | undefined;
  openGroup?(id: string): void;
  scope?(): string;
  scoped?(): boolean;
  presentation?(mode: string): void;
  preview(expr: string, context: 'filter' | 'group'): Promise<{ matched: number; total: number; groups?: number }>;
  result(): ExploreResult | undefined;
  viewCurrent?(): boolean;
  mode(): string;
  policy(): string[];
  /** Edge notes (reified edges drawn as nodes) in the detail view; 0 otherwise. */
  carriers(): number;
  /** Relationship notes (reified edge carriers) in the loaded projection, either display. */
  relationshipNotes?(): number;
  /** Lines/Nodes switch through the settings apply path; rejects leave the displayed graph. */
  setRelationshipDisplay?(nodes: boolean): Promise<void>;
  setView(view: ExploreView, after?: () => void): void;
  commitSavedView?(saved: SavedView | null, expected: SavedView | null): Promise<void>;
  savedViewIssue?(saved: SavedView): string;
  openSavedView?(saved: SavedView): Promise<void>;
  setColors(colors: GraphDeclaration['colors']): Promise<void>;
  visualsChanged(labels: boolean): void;
  lens?(): { active: boolean; available: boolean };
  /** The panel opened, closed or switched tool: the graph re-measures the room it leaves. */
  toolsChanged?(): void;
  toggleLens?(): void;
  groupColor(code: number): string;
  focusGroup(code: number): void;
  fit(): void;
  camera(): ViewCamera | null;
  restoreCamera(camera: ViewCamera): void;
  persist(): void;
  applyLayout(values: PhysicsValues): Promise<void>;
  layoutSettled?(): boolean;
  previewSizing?(values: NodeSizingValues | null): void;
  applySizing?(values: NodeSizingValues): Promise<void>;
  sizingReadout?(): string;
  suggestions?(): Suggestion[] | null;
  /** Named layout fix for the loaded graph; only ever fills the physics draft. */
  layoutAdvice?(): { gravity: number; reason: string } | undefined;
  previewSuggestions?(list: Suggestion[] | null): void;
  applySuggestions?(list: Suggestion[]): Promise<void>;
}
type Section = 'filters' | 'groups' | 'colors' | 'edges' | 'display' | 'views' | 'physics';
type Tool = 'views' | 'filters' | 'appearance' | 'layout' | 'information' | 'members';
const TOOLS: [Tool, string, string][] = [['views', 'Saved views', 'bookmark'], ['filters', 'Filters', 'list-filter'], ['appearance', 'Appearance', 'palette'], ['layout', 'Layout', 'move'], ['information', 'Graph information', 'info'], ['members', 'Members', 'list']];
function toolButton(host: HTMLElement, text: string, icon: string) {
  const button = iconButton(host, text, icon, 'graph-ng-tool', { title: text });
  button.createSpan({ cls: 'graph-ng-tool-label', text });
  return button;
}
const SECTIONS: Record<string, [Section, string][]> = { views: [['views', 'Saved views']], filters: [['filters', 'Filters'], ['groups', 'Grouping'], ['edges', 'Relationships']], appearance: [['display', 'Appearance'], ['colors', 'Color rules']], layout: [['physics', 'Layout']] };
const PULL_IN = 'Pull in notes';
/** Reified rules make relationship notes; only then is Lines/Nodes a choice. */
export const hasReified = (d: GraphDeclaration) => d.edges.some(e => e.kind === 'reified');
/** One apply with only `display.reifiedAsNodes` flipped; query, filters and scope stay in settings. */
export async function setRelationshipDisplay(plugin: { settings: Settings; apply(s: Settings): Promise<void> }, nodes: boolean) {
  const s = plugin.settings; if (s.declaration.display.reifiedAsNodes === nodes) return;
  await plugin.apply({ ...s, declaration: { ...s.declaration, display: { ...s.declaration.display, reifiedAsNodes: nodes } } });
}
let expressionPanelId = 0;
const parseRaw = (raw: string): Scalar => { try { const v: unknown = JSON.parse(raw); return v === null || ['string', 'number', 'boolean'].includes(typeof v) ? v as Scalar : raw; } catch { return raw; } };
/** One nonmodal overlay; opening tools never changes the canvas rectangle or graph. */
export class ExplorePanel {
  readonly root: HTMLElement;
  private expressionPanelId = ++expressionPanelId;
  private viewDefinitions = new Set<string>();
  private viewDraft?: { saved: SavedView; folder?: string; configuration: string };
  private viewCollision?: SavedView;
  private viewSaved?: SavedView;
  private viewMessage = '';
  private viewBusy = false;
  private openRequest = 0;
  private viewOrigin?: string;
  private physicsDraft?: Record<PhysicsKey, string | boolean>;
  private physicsAdvanced = false;
  private sizingDraft?: Record<keyof NodeSizingValues, string>;
  private sizingMessage = '';
  private sizingBusy = false;
  private lensButton?: HTMLInputElement;
  private physicsError = '';
  private physicsBusy = false;
  /** Draft before the last preset or reset; `applied` once Apply ran with the preset values. */
  private physicsUndo?: { values: Record<PhysicsKey, string | boolean>; name: string; applied: boolean };
  private disposed = false;
  private adding = false;
  private toggleKey?: string;
  private drafts = new Map<string, string>();
  private expressionTimers = new Set<ReturnType<typeof setTimeout>>();
  private counts: HTMLElement;
  private search!: HTMLInputElement;
  private body: HTMLElement;
  private alert: HTMLElement;
  private invalid: HTMLElement;
  private feedback: HTMLElement;
  private tool: Tool = 'views';
  private opener?: HTMLElement;
  private title: HTMLElement;
  private closeButton: HTMLButtonElement;
  private toolbar: HTMLElement;
  private buttons = new Map<Tool, HTMLButtonElement>();
  private representations = new Map<string, HTMLButtonElement>();
  private workspaceButton: HTMLButtonElement;
  private sizingPreview = false;
  private suggestPreview = false;
  private suggestBusy = false;
  private suggestMessage = '';
  private guards: (() => void)[] = [];
  private groupLimit: number;
  private searchTimer: ReturnType<typeof setTimeout> | undefined;
  private get settings() { return this.host.settings(); }
  constructor(parent: HTMLElement, private host: PanelHost, private view: ExploreView, toolbar?: HTMLElement) {
    const s = host.settings(); this.groupLimit = s.explore.legendPageSize;
    this.toolbar = toolbar ?? parent.createDiv({ cls: 'graph-ng-toolbar' });
    this.root = parent.createDiv({ cls: 'graph-ng-explore', attr: { role: 'region', 'aria-label': 'Graph tools', id: `graph-ng-controls-${this.expressionPanelId}` } });
    const head = this.root.createDiv({ cls: 'graph-ng-explore-head' });
    this.title = head.createEl('h3', { text: 'Views' });
    this.closeButton = iconButton(head, 'Close graph tools', 'x', 'clickable-icon graph-ng-explore-close');
    this.closeButton.onclick = () => this.close();
    this.closeButton.onblur = () => { this.saveFocus = false; };
    this.root.onkeydown = e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.close(); } };
    this.counts = this.root.createDiv({ cls: 'graph-ng-explore-counts' });
    this.alert = this.root.createDiv({ cls: 'graph-ng-explore-error', attr: { role: 'alert' } });
    // Panel validation and view-operation feedback are separate messages; neither erases the other.
    this.invalid = this.alert.createDiv(); this.feedback = this.alert.createDiv();
    this.body = this.root.createDiv({ cls: 'graph-ng-explore-body' });
    const representations = this.toolbar.createDiv({ cls: 'graph-ng-representations', attr: { role: 'group', 'aria-label': 'Graph representation and scope' } });
    for (const [mode, label, icon] of [['nodes', 'Notes', 'file-text'], ['groups', 'Groups', 'network']]) {
      const button = toolButton(representations, label!, icon!); this.representations.set(mode!, button);
      button.onclick = () => this.host.presentation?.(mode!);
    }
    this.workspaceButton = toolButton(representations, 'Workspace scope', 'expand');
    this.workspaceButton.onclick = () => this.host.presentation?.('workspace');
    this.search = this.toolbar.createEl('input', { cls: 'graph-ng-explore-search', attr: { type: 'search', placeholder: 'Search notes…', 'aria-label': 'Search note names and IDs', spellcheck: 'false' } });
    this.search.maxLength = VIEW_LIMITS.query; this.search.value = view.query;
    this.search.oninput = () => { clearTimeout(this.searchTimer); if (this.settings.projectionFile) return; this.searchTimer = setTimeout(() => { if (!this.disposed && !this.settings.projectionFile) this.update({ query: this.search.value }); }, 160); };
    const tools = this.toolbar.createDiv({ cls: 'graph-ng-tools', attr: { role: 'group', 'aria-label': 'Graph panels' } });
    for (const [tool, text, icon] of TOOLS) {
      const button = toolButton(tools, text, icon); button.setAttribute('aria-controls', this.root.id);
      this.buttons.set(tool, button); button.onclick = () => this.root.hidden || this.tool !== tool ? this.show(tool, button) : this.close();
    }
    if (host.information) this.root.appendChild(host.information);
    if (host.members) this.root.appendChild(host.members);
    this.root.hidden = !s.explore.panelOpen; this.layout();
  }
  show(tool: Tool, opener: HTMLElement | undefined = this.buttons.get(tool)) {
    this.saveFocus = false;
    if (this.tool === 'appearance' && tool !== this.tool) this.endPreview();
    if (this.tool === 'views' && tool !== this.tool && !this.viewBusy) { this.viewDraft = undefined; this.viewCollision = undefined; }
    this.tool = tool; this.opener = opener ?? this.buttons.get('views'); this.root.hidden = false;
    this.settings.explore.panelOpen = true; this.host.persist(); this.layout(); this.closeButton.focus({ preventScroll: true });
  }
  close() {
    this.saveFocus = false;
    this.endPreview(); if (!this.viewBusy) { this.viewDraft = undefined; this.viewCollision = undefined; } this.root.hidden = true; this.settings.explore.panelOpen = false; this.host.persist(); this.layout();
    this.opener?.focus({ preventScroll: true });
  }
  private endPreview() {
    // Submitted sizing transactions retain their existing generation/acknowledgement contract.
    if (this.sizingPreview && !this.sizingBusy) { this.host.previewSizing?.(null); this.sizingPreview = false; this.sizingMessage = 'Preview ended. Draft not saved.'; }
    if (this.suggestPreview && !this.suggestBusy) { this.host.previewSuggestions?.(null); this.suggestPreview = false; this.suggestMessage = ''; }
  }
  dispose() { this.host.previewSizing?.(null); this.disposed = true; this.expressionTimers.forEach(clearTimeout); clearTimeout(this.searchTimer); this.root.remove(); }
  setState(view: ExploreView) { this.view = view; if (document.activeElement !== this.search) this.search.value = view.query; this.render(); }
  operation(message: string, retry?: () => void) {
    this.feedback.textContent = message;
    if (!retry) return;
    const button = this.feedback.createEl('button', { text: 'Retry view' });
    // Re-issuing replaces this button; keep keyboard focus on a stable, enabled control.
    button.onclick = () => { if (document.activeElement === button) this.closeButton.focus({ preventScroll: true }); retry(); };
  }
  /** A view that would fail settings validation is never applied or persisted. */
  private update(patch: Partial<ExploreView>, after?: () => void) {
    const next = { ...this.view, ...patch };
    try { validateView(next); } catch (e) { this.invalid.textContent = `Not applied: ${e instanceof Error ? e.message : String(e)}`; return; }
    this.invalid.textContent = ''; this.view = next; this.host.setView(this.view, after); this.render();
  }
  private toolTitle() { return this.tool === 'members' ? 'Groups & members' : TOOLS.find(([tool]) => tool === this.tool)![1]; }
  private layout() {
    this.title.textContent = this.toolTitle();
    for (const [tool, button] of this.buttons) button.setAttribute('aria-expanded', String(!this.root.hidden && tool === this.tool));
    if (this.host.information) this.host.information.hidden = this.root.hidden || this.tool !== 'information';
    if (this.host.members) {
      this.host.members.hidden = this.root.hidden || this.tool !== 'members';
      if (this.tool === 'members' && !this.host.members.children.length) this.browseGroups();
    }
    this.body.hidden = this.root.hidden || this.tool === 'information' || this.tool === 'members'; this.render();
    this.host.toolsChanged?.();
  }
  private memberQuery = '';
  private memberRoot?: HTMLElement;
  private memberGroups?: ReturnType<NonNullable<PanelHost['memberGroups']>>;
  /** Browse the existing group dictionary without changing the graph or its scope. */
  browseGroups(focus?: string) {
    const panel = this.host.members; if (!panel) return;
    const searching = panel.contains(document.activeElement) && document.activeElement?.getAttribute('aria-label') === 'Find a group';
    panel.empty(); const host = this.memberRoot = panel.createDiv();
    const groups = this.memberGroups = this.host.memberGroups?.();
    if (!groups?.length) { this.note(host, groups ? 'No groups in this view.' : 'Groups are loading…'); return; }
    const search = groups.length > this.settings.listPageSize || this.memberQuery ? host.createEl('input', { attr: { type: 'search', placeholder: 'Find a group…', 'aria-label': 'Find a group' } }) : undefined;
    if (search) { search.value = this.memberQuery; if (searching) search.focus(); }
    const list = host.createDiv({ cls: 'graph-ng-legend graph-ng-group-legend' });
    const more = panelButton(host, 'Show more groups', () => { limit += this.settings.listPageSize; draw(); });
    let limit = this.settings.listPageSize;
    const draw = () => {
      list.empty(); const query = this.memberQuery.trim().toLocaleLowerCase(), matches = groups.filter(g => g.label.toLocaleLowerCase().includes(query));
      if (focus) limit = Math.max(limit, matches.findIndex(g => g.id === focus) + 1);
      for (const group of matches.slice(0, limit)) {
        const row = list.createDiv({ cls: 'graph-ng-legend-row' });
        const swatch = row.createSpan({ cls: 'graph-ng-swatch' }); swatch.style.background = this.host.groupColor(Number(group.id)); swatch.style.gridColumn = '2';
        const button = panelButton(row, group.label, () => this.host.openGroup?.(group.id), false, 'graph-ng-legend-name', { 'aria-label': `Open members of ${group.label}` });
        countSpan(row, plural(group.count, 'note'));
        if (group.id === focus) button.focus();
      }
      if (!matches.length) this.note(list, 'No matching groups.');
      more.hidden = matches.length <= limit; focus = undefined;
    };
    if (search) search.oninput = () => { this.memberQuery = search.value; limit = this.settings.listPageSize; draw(); };
    draw();
  }
  /** Progress-only update: no control rebuild, focus changes or draft work. */
  updateSummary(): void {
    if (this.root.hidden || this.disposed) return;
    const external = Boolean(this.settings.projectionFile);
    this.summary(external, external ? undefined : this.host.result());
  }
  render() {
    const external = Boolean(this.settings.projectionFile), r = external ? undefined : this.host.result();
    this.search.disabled = external;
    this.search.title = external ? 'Note search is unavailable in aggregate graphs.' : 'Search note names and IDs';
    this.search.setAttribute('aria-label', this.search.title);
    if (external) { clearTimeout(this.searchTimer); this.search.value = this.view.query; }
    this.summary(external, r);
    const named = this.settings.explore.savedViews.find(s => canonical(s.view) === canonical(this.settings.explore.view));
    this.buttons.get('views')!.title = named ? `Saved views (requested: ${named.name})` : 'Saved views (requested settings)';
    this.buttons.get('filters')!.dataset.count = this.view.filters.length ? String(this.view.filters.length) : '';
    for (const [mode, button] of this.representations) button.setAttribute('aria-pressed', String(this.host.mode() === mode));
    this.workspaceButton.hidden = this.workspaceButton.disabled = !this.host.scoped?.();
    if (this.workspaceButton.hidden && document.activeElement === this.workspaceButton) this.representations.get('nodes')!.focus();
    if (this.tool === 'members' && this.host.members && (!this.host.members.children.length || this.memberRoot && this.host.members.contains(this.memberRoot) && this.memberGroups !== this.host.memberGroups?.())) this.browseGroups();
    if (this.body.hidden) return;
    // Re-render rebuilds controls; changing labels use a stable action identity.
    const active = document.activeElement instanceof HTMLElement && this.body.contains(document.activeElement) ? document.activeElement : null;
    const selection = active instanceof HTMLInputElement ? [active.selectionStart, active.selectionEnd] as const : undefined;
    const name = (e: HTMLElement) => `${e.tagName}|${e.getAttribute('aria-label') ?? e.textContent}`, focusName = active ? name(active) : '', focusKey = active?.getAttribute('data-focus-key');
    this.expressionTimers.forEach(clearTimeout); this.expressionTimers.clear();
    const scroll = this.body.scrollTop; this.body.empty(); this.guards = [];
    for (const [id, title] of SECTIONS[this.tool] ?? []) {
      const section = this.body.createEl('section', { cls: `graph-ng-explore-section graph-ng-explore-${id}` });
      // The panel title already names a section that shares it (Appearance, Layout, Saved views).
      if (title !== this.toolTitle()) section.createEl('h4', { text: title });
      const content = section.createDiv();
      if (!r && id !== 'display' && id !== 'views' && id !== 'physics') { this.note(content, external ? 'External aggregate has no note rows to filter or regroup.' : 'Awaiting projection.'); continue; }
      this[id](content, r!);
    }
    this.body.scrollTop = scroll;
    if (focusName) { const replacement = [...this.body.querySelectorAll<HTMLElement>('button,input,select,summary')].find(e => !(e as HTMLButtonElement).disabled && (focusKey != null ? e.getAttribute('data-focus-key') === focusKey : name(e) === focusName)); replacement?.focus({ preventScroll: true }); if (replacement instanceof HTMLInputElement && selection && replacement.type === 'text') replacement.setSelectionRange(selection[0], selection[1]); }
  }
  /** Open Filters on filter `at`'s chip (no such chip: just the panel); a negative `at` focuses the search box. */
  focusFilter(at: number) {
    if (at < 0) return this.search.focus();
    this.show('filters'); const chip = this.body.querySelectorAll<HTMLElement>('.graph-ng-chip')[at];
    chip?.addClass('is-focused'); chip?.querySelector('button')?.focus();
  }
  /** Notes shown and edges drawn; what the view hides is one row leading to the breakdown. The scope is named only inside a selected group. */
  private summaryKey?: string;
  private summary(external: boolean, r?: ExploreResult) {
    const progress = this.counts.querySelector<HTMLElement>('.graph-ng-working-status'), loading = this.host.loading?.();
    const key = JSON.stringify([external, this.host.scoped?.(), this.host.scope?.(), r && sum(r.visible), r?.visibleEdges]);
    this.counts.hidden = this.tool === 'information';
    if (progress && loading && this.summaryKey === key) { workingText(progress, loading.stage, true); return; }
    this.summaryKey = key; progress?.remove(); this.counts.empty();
    const status = (host: HTMLElement, text: string, busy: boolean) => { const label = progress ?? host.createSpan(); if (progress) host.appendChild(progress); workingText(label, text, busy); };
    if (this.host.scoped?.()) this.counts.createDiv({ cls: 'graph-ng-scope-name', text: `In ${this.host.scope?.()}` });
    if (external || !r) { status(this.note(this.counts, ''), loading?.stage ?? (external ? 'External aggregate' : 'Waiting for projection…'), !!loading); return; }
    const stats = this.counts.createDiv({ cls: 'graph-ng-stats' });
    const shown = sum(r.visible), notes = r.nodes - shown, edges = r.edges - r.visibleEdges;
    statRow(stats, 'circle-dot', loading ? 'Notes shown so far' : 'Notes shown', num(shown)); statRow(stats, 'spline', loading ? 'Edges drawn so far' : 'Edges drawn', num(r.visibleEdges));
    if (loading) { status(statRow(stats, 'loader', '', '', 'graph-ng-loading-counts').querySelector<HTMLElement>('.graph-ng-stat-label')!, loading.stage, true); return; }
    if (notes || edges) statRow(stats, 'eye-off', 'Hidden, see why', `${plural(notes, 'note')}, ${plural(edges, 'edge')}`, '', () => this.show('information'));
  }
  private note(host: HTMLElement, text: string) { return host.createDiv({ cls: 'graph-ng-explore-note', text }); }
  /** One bounded text editor serves filters, colours and custom group values. */
  private expressionField(host: HTMLElement, r: ExploreResult, label: string, context: 'filter' | 'group', submit: (expr: string) => void) {
    const details = host.createEl('details', { cls: 'graph-ng-expression' }); details.open = this.drafts.has(label);
    disclosure(details, label); const body = disclosureBody(details);
    const input = body.createEl('input', { attr: { type: 'text', 'aria-label': label, placeholder: context === 'filter' ? 'note.status == "open"' : 'note.category', spellcheck: 'false' } });
    input.value = this.drafts.get(label) ?? '';
    const completions = body.createEl('datalist'), id = `graph-ng-expr-${this.expressionPanelId}-${label.split(' ').join('-')}`; completions.id = id; input.setAttribute('list', id);
    const feedback = body.createEl('pre', { cls: 'graph-ng-expression-status', attr: { role: 'status', 'aria-live': 'polite' } });
    const apply = body.createEl('button', { text: context === 'group' ? 'Group by expression' : 'Apply expression', cls: 'mod-cta' });
    const sync = () => {
      this.drafts.set(label, input.value);
      completions.empty(); for (const value of suggestions(input.value.slice(0, input.selectionStart ?? input.value.length), [...declaredKeys(this.settings.declaration), ...r.facets.map(f => f.key)])) completions.createEl('option', { value });
      const result = validate(input.value, context); apply.disabled = !result.ok; feedback.toggleClass('graph-ng-explore-error', !result.ok);
      if (!result.ok) { const error = result.errors[0]!; feedback.textContent = `At ${error.pos + 1}: ${error.message}\n${' '.repeat(Math.min(error.pos, 80))}^`; return; }
      const shape = context === 'filter' ? builderPredicate(result.ast) : undefined;
      feedback.textContent = shape ? `Builder form: ${filterSummary(shape).text}. Counting…` : 'Custom expression. Counting…';
      const source = input.value, timer = setTimeout(() => {
        this.expressionTimers.delete(timer);
        void this.host.preview(source, context).then(count => {
          if (input.isConnected && source === input.value) feedback.textContent = `${plural(count.matched, 'matching note')}${count.groups === undefined ? '' : `, in ${plural(count.groups, 'group')}`}`;
        }).catch(e => { if (input.isConnected && source === input.value) feedback.textContent = String(e).includes('generation changed') ? 'Projection changed; edit to refresh count' : `Preview: ${String(e)}`; });
      }, 150); this.expressionTimers.add(timer);
    };
    let pending: ReturnType<typeof setTimeout> | undefined;
    input.oninput = () => { if (pending) { clearTimeout(pending); this.expressionTimers.delete(pending); } const before = new Set(this.expressionTimers); sync(); pending = [...this.expressionTimers].find(t => !before.has(t)); };
    apply.onclick = () => { try { const ast = checked(input.value, context); const source = editAsExpression(context === 'filter' ? { kind: 'expr', expr: input.value } : { from: 'expr', expr: input.value }); if (!source.text) throw new Error(source.reason); submit(source.text); } catch (e) { feedback.textContent = String(e); } };
    details.ontoggle = () => { if (details.open && context === 'group' && !input.value && this.view.group) { input.value = editAsExpression(this.view.group).text ?? ''; if (input.value) sync(); } };
    if (input.value) sync(); else apply.disabled = true;
  }
  private filters(host: HTMLElement, r: ExploreResult) {
    const filters = this.view.filters;
    // Per-filter counts only when the result is for exactly these filters.
    const hidden = r.filters && canonical(r.filters.slice(0, filters.length)) === canonical(filters) ? r.filterHidden : undefined;
    // Chips: summary opens help, never edits the filter; actions stay separate.
    const chips = host.createDiv({ cls: 'graph-ng-chips', attr: { role: 'list', 'aria-label': 'Active filters' } });
    const icon = (parent: HTMLElement, label: string, name: string, cls = '') => iconButton(parent, label, name, `clickable-icon graph-ng-chip-action ${cls}`);
    this.view.filters.forEach((f, i) => {
      const chip = chips.createDiv({ cls: 'graph-ng-chip', attr: { role: 'listitem' } }), summary = filterSummary(f);
      panelHelp(chip, summary.text, describePredicate(f), summary.code ? 'graph-ng-chip-text graph-ng-chip-code' : 'graph-ng-chip-text');
      if (hidden) countSpan(chip, `${plural(hidden[i]!, 'note')} hidden`);
      const converted = editAsExpression(f), edit = icon(chip, `Edit filter ${i + 1} as expression`, 'pencil');
      edit.disabled = !converted.text;
      edit.onclick = () => { this.drafts.set(`Edit filter ${i + 1}`, converted.text!); this.render(); };
      if (f.kind !== 'expr') {
        const builder = chip.createEl('details', { cls: 'graph-ng-chip-json' });
        disclosure(builder, 'JSON', { 'aria-label': `Edit builder filter ${i + 1} as JSON` });
        const body = disclosureBody(builder), input = body.createEl('textarea', { attr: { 'aria-label': `Builder filter ${i + 1}` } }); input.value = JSON.stringify(f, null, 2);
        const error = body.createDiv({ cls: 'graph-ng-explore-error', attr: { role: 'alert' } });
        panelButton(body, 'Save builder entry', () => { try { const value: unknown = JSON.parse(input.value); validatePredicate(value); this.update({ filters: this.view.filters.map((p, j) => j === i ? value : p) }); } catch (e) { error.textContent = String(e); } });
      }
      const remove = icon(chip, `Remove filter: ${summary.text}`, 'x', 'graph-ng-remove');
      remove.onclick = () => { this.update({ filters: this.view.filters.filter((_, j) => j !== i) }); (this.body.querySelectorAll<HTMLButtonElement>('.graph-ng-remove')[i] ?? this.search).focus(); };
      if (this.drafts.has(`Edit filter ${i + 1}`)) this.expressionField(chip, r, `Edit filter ${i + 1}`, 'filter', expr => { this.drafts.delete(`Edit filter ${i + 1}`); this.update({ filters: this.view.filters.map((p, j) => j === i ? { kind: 'expr', expr } : p) }); });
    });
    this.filterToggles(host, r);
    const add = host.createEl('details', { cls: 'graph-ng-add-filter' }); add.open = this.adding || this.drafts.has('Filter expression');
    add.ontoggle = () => { this.adding = add.open; };
    disclosure(add, 'Add filter');
    this.predicateForm(disclosureBody(add), r, 'Add filter', p => { this.adding = false; this.update({ filters: [...this.view.filters, p] }); });
  }
  /** One checkbox per value of a small, complete facet; unticking hides the value through an ordinary filter. */
  private filterToggles(host: HTMLElement, r: ExploreResult) {
    const eligible = r.facets.filter(f => f.distinct === f.values.length && f.values.length > 1 && f.values.length <= 24 && toggleable(f.values.map(v => v.raw)));
    const owner = eligible.find(f => toggledValues(this.view.filters, f.key, []).owned.length), g = this.view.group;
    const facet = eligible.find(f => f.key === this.toggleKey) ?? owner ?? eligible.find(f => g?.from === 'key' && f.key === g.key) ?? eligible[0];
    if (!facet) return;
    const box = host.createDiv({ cls: 'graph-ng-toggles', attr: { role: 'group', 'aria-label': `Show notes by ${facet.key}` } }), head = box.createDiv({ cls: 'graph-ng-toggle-head' });
    head.createSpan({ text: 'Show by' });
    const select = head.createEl('select', { attr: { 'aria-label': 'Show by property' } });
    for (const f of eligible) select.createEl('option', { value: f.key, text: f.key }).selected = f === facet;
    select.onchange = () => { this.toggleKey = select.value; this.render(); };
    const present = facet.values.map(v => v.raw).filter(v => v !== 'undefined'), { hidden } = toggledValues(this.view.filters, facet.key, present);
    for (const v of facet.values) {
      const row = box.createEl('label', { cls: 'graph-ng-toggle' }), tick = row.createEl('input', { attr: { type: 'checkbox', 'aria-label': `Show ${v.label}`, 'data-focus-key': `toggle:${facet.key}:${v.raw}` } });
      tick.checked = !hidden.has(v.raw);
      tick.onchange = () => { const next = new Set(hidden); if (tick.checked) next.delete(v.raw); else next.add(v.raw); this.update({ filters: setToggles(this.view.filters, facet.key, present, next) }); };
      row.createSpan({ cls: 'graph-ng-stat-label', text: v.label }); countSpan(row, v.count);
    }
  }
  /** Property choices are exactly the materialized declared columns, plus folder prefixes. */
  private predicateForm(host: HTMLElement, r: ExploreResult, action: string, submit: (p: Predicate) => void, extra?: (row: HTMLElement) => void) {
    const filter = action === 'Add filter', form = host.createDiv({ cls: filter ? 'graph-ng-form graph-ng-builder' : 'graph-ng-form', attr: filter ? { role: 'group', 'aria-label': 'Add filter' } : {} }); extra?.(form);
    const property = form.createEl('select', { attr: { 'aria-label': 'Property' } });
    for (const f of r.facets) property.createEl('option', { value: `k:${f.key}`, text: f.key });
    property.createEl('option', { value: 'folder', text: 'Folder' });
    const op = form.createEl('select', { attr: { 'aria-label': 'Operator' } });
    for (const [v, t] of [['eq', 'is'], ['in', 'is any of'], ['exists', 'exists']]) op.createEl('option', { value: v, text: t });
    const values = form.createEl('select', { attr: { 'aria-label': 'Value' } }), folder = form.createEl('input', { attr: { type: 'text', placeholder: 'Folder/Subfolder', 'aria-label': 'Folder prefix' } });
    // Native options cannot align a count column; the selection's note count sits beside the picker.
    const matched = countSpan(form, ''); matched.setAttribute('aria-live', 'polite');
    const count = () => { const facet = r.facets.find(f => `k:${f.key}` === property.value), picked = new Set([...values.selectedOptions ?? []].map(o => o.value)), n = facet?.values.reduce((a, v) => a + (picked.has(v.raw) ? v.count : 0), 0) ?? 0; matched.textContent = values.hidden || !picked.size ? '' : plural(n, 'note'); };
    const sync = () => {
      const isFolder = property.value === 'folder'; op.hidden = isFolder; folder.hidden = !isFolder;
      values.hidden = isFolder || op.value === 'exists'; values.multiple = op.value === 'in'; values.size = op.value === 'in' ? 5 : 1; values.empty();
      const facet = r.facets.find(f => `k:${f.key}` === property.value);
      for (const v of facet?.values ?? []) values.createEl('option', { value: v.raw, text: v.label });
      if (facet && facet.distinct > facet.values.length) values.createEl('option', { text: `… ${facet.distinct - facet.values.length} more (increase the value limit)`, attr: { disabled: 'true' } });
      count();
    };
    property.onchange = op.onchange = sync; values.onchange = count; sync();
    const add = form.createEl('button', { text: action, cls: filter ? 'graph-ng-add' : 'mod-cta' }), error = form.createDiv({ cls: 'graph-ng-explore-error', attr: { role: 'alert' } });
    add.onclick = () => {
      try {
        const key = property.value.slice(2); let p: Predicate;
        if (property.value === 'folder') p = folderPredicate(folder.value);
        else if (op.value === 'exists') p = { kind: 'exists', key };
        else if (op.value === 'in') p = { kind: 'in', key, values: [...values.selectedOptions].map(o => parseRaw(o.value)) };
        else { if (!values.value) throw new Error('Choose a value'); p = { kind: 'eq', key, value: parseRaw(values.value) }; }
        validatePredicate(p); if (p.kind === 'in' && !p.values.length) throw new Error('Choose at least one value');
        error.textContent = ''; submit(p);
      } catch (e) { error.textContent = e instanceof Error ? e.message : String(e); }
    };
    this.expressionField(host, r, action === 'Add filter' ? 'Filter expression' : 'Rule expression', 'filter', expr => submit({ kind: 'expr', expr }));
  }
  private groups(host: HTMLElement, r: ExploreResult) {
    const d = this.settings.declaration, row = settingRow(host, 'Group by', 'graph-ng-select');
    const select = row.createEl('select', { attr: { 'aria-label': 'Group by' } });
    const options: [string, GroupSource | null][] = [['Declared default', null], ...d.groups.map(g => [groupLabel(g), g] as [string, GroupSource])];
    for (const f of r.facets) if (!d.groups.some(g => g.from === 'key' && g.key === f.key)) options.push([`Property: ${f.key}`, { from: 'key', key: f.key }]);
    for (let depth = 1; depth <= 4; depth++) if (!d.groups.some(g => g.from === 'folder' && g.depth === depth && g.prefix === undefined)) options.push([`Folder depth ${depth}`, { from: 'folder', depth }]);
    options.forEach(([label, g], i) => { const o = select.createEl('option', { value: String(i), text: label }); o.selected = canonical(g) === canonical(this.view.group); });
    if (this.view.group && !options.some(([, g]) => canonical(g) === canonical(this.view.group))) { options.push([groupLabel(this.view.group), this.view.group]); select.createEl('option', { value: String(options.length - 1), text: options.at(-1)![0] }).selected = true; }
    select.onchange = () => this.update({ group: options[Number(select.value)]![1], hiddenGroups: [], collapsedGroups: [] });
    const advanced = host.createEl('details', { cls: 'graph-ng-group-advanced' });
    advanced.open = this.drafts.has('Group expression');
    disclosure(advanced, 'Advanced grouping'); const body = disclosureBody(advanced);
    this.derivedForm(body, r);
    this.expressionField(body, r, 'Group expression', 'group', expr => this.update({ group: { from: 'expr', expr }, hiddenGroups: [], collapsedGroups: [] }));
    const disabled = this.settings.explore.disabledDerived;
    if (disabled.length) {
      const note = host.createDiv({ cls: 'graph-ng-explore-note graph-ng-disabled-derive', attr: { role: 'status' } });
      note.createSpan({ text: `Disabled: regex-derived groups are no longer supported. Recreate with segment or prefix. ${disabled.map(d => `${d.location}: ${d.key} /${d.pattern}/`).join('; ')}. ` });
      panelButton(note, 'Dismiss', () => { this.settings.explore.disabledDerived = []; this.host.persist(); this.render(); });
    }
    const nodes = this.host.mode() === 'nodes', actions = host.createDiv({ cls: 'graph-ng-row graph-ng-group-actions' });
    const order = Array.from(r.groupKeys.keys()).filter(i => r.groupTotals[i]).sort((a, b) => r.groupTotals[b]! - r.groupTotals[a]! || a - b);
    if (nodes) {
      const all = order.map(i => r.groupKeys[i]!).filter(k => k.length <= VIEW_LIMITS.keyLength), collapse = actions.createEl('button', { text: 'Collapse all' });
      collapse.disabled = all.length > VIEW_LIMITS.keys; if (collapse.disabled) panelHelp(actions, 'Group limit', `Collapse up to ${num(VIEW_LIMITS.keys)} groups at once.`);
      collapse.onclick = () => this.update({ collapsedGroups: all });
      panelButton(actions, 'Expand all', () => this.update({ collapsedGroups: [] }));
    }
    if (this.view.hiddenGroups.length) panelButton(actions, 'Show all', () => this.update({ hiddenGroups: [] }));
    const list = host.createDiv({ cls: 'graph-ng-legend graph-ng-group-legend', attr: { role: 'list', 'aria-label': 'Groups and notes shown' } }), hidden = new Set(this.view.hiddenGroups), collapsed = new Set(this.view.collapsedGroups);
    for (const i of order.slice(0, this.groupLimit)) {
      const key = r.groupKeys[i]!, label = r.groupLabels[i]!, item = list.createDiv({ cls: 'graph-ng-legend-row', attr: { role: 'listitem' } });
      const eye = item.createEl('input', { attr: { type: 'checkbox', 'aria-label': `Show ${label}` } }); eye.checked = !hidden.has(key);
      // Persisted keys are capped; an over-long key cannot be hidden or collapsed by name.
      const storable = key.length <= VIEW_LIMITS.keyLength; eye.disabled = !storable && eye.checked;
      eye.onchange = () => this.update({ hiddenGroups: eye.checked ? this.view.hiddenGroups.filter(k => k !== key) : [...this.view.hiddenGroups, key] });
      item.createSpan({ cls: 'graph-ng-swatch' }).style.background = this.host.groupColor(i);
      const name = item.createEl('button', { cls: 'graph-ng-legend-name', text: label, attr: { 'aria-label': `${nodes ? 'Frame' : 'Open members of'} ${label}` } });
      name.onclick = () => this.host.focusGroup(i);
      this.legendCount(item, r.groupVisible[i]!, r.groupTotals[i]!, 'note');
      if (nodes) {
        const fold = iconButton(item, `${collapsed.has(key) ? 'Expand' : 'Collapse'} ${label}`, collapsed.has(key) ? 'plus' : 'minus', 'graph-ng-fold clickable-icon', { 'data-focus-key': `group-fold:${key}`, 'aria-pressed': String(collapsed.has(key)) }); fold.disabled = !storable && !collapsed.has(key);
        fold.onclick = () => this.update({ collapsedGroups: collapsed.has(key) ? this.view.collapsedGroups.filter(k => k !== key) : [...this.view.collapsedGroups, key] }, collapsed.has(key) ? () => this.host.focusGroup(i) : undefined);
      }
    }
    const notes = nodes ? this.host.carriers() : 0;
    if (notes) panelHelp(host, plural(notes, 'relationship note'), 'Drawn smaller and beneath other notes. Appearance controls their color and visibility when zoomed out.');
    if (order.length > this.groupLimit) panelButton(host, `Show ${Math.min(this.settings.explore.legendPageSize, order.length - this.groupLimit)} more, ${num(order.length - this.groupLimit)} groups left`, () => { this.groupLimit += this.settings.explore.legendPageSize; this.render(); });
  }
  /** Group by a bounded transform of an existing value; no note needs a new property. */
  private derivedForm(host: HTMLElement, r: ExploreResult) {
    const details = host.createEl('details', { cls: 'graph-ng-derived' }); disclosure(details, 'Group by part of a value'); const body = disclosureBody(details);
    // Visible labels; the stored transform keeps its 0-based segment index (-1 = last).
    const form = body.createDiv({ cls: 'graph-ng-derive-grid' });
    const field = <K extends 'select' | 'input'>(label: string, tag: K, attr: Record<string, string>) => { const l = form.createEl('label', { cls: 'graph-ng-field' }), caption = l.createSpan({ text: label }); return [l.createEl(tag, { attr: { 'aria-label': label, ...attr } }), caption] as const; };
    const [source] = field('Derive from', 'select', {});
    source.createEl('option', { value: '$identity', text: 'ID' }); source.createEl('option', { value: '$path', text: 'Path' });
    for (const f of r.facets) source.createEl('option', { value: f.key, text: f.key });
    const [kind] = field('Take', 'select', {});
    for (const [v, t] of [['segment', 'One part'], ['prefix', 'First parts']]) kind.createEl('option', { value: v, text: t });
    const [delimiter] = field('Split at', 'input', { type: 'text', value: ':', maxlength: '8' });
    const [n, caption] = field('Part (0 = first, -1 = last)', 'input', { type: 'number', value: '0', min: '-64', max: '63' });
    kind.onchange = () => { const prefix = kind.value === 'prefix', label = prefix ? 'Number of parts' : 'Part (0 = first, -1 = last)'; caption.textContent = label; n.setAttribute('aria-label', label); if (prefix && Number(n.value) < 1) n.value = '1'; };
    const error = body.createDiv({ cls: 'graph-ng-explore-error', attr: { role: 'alert' } });
    panelButton(form, 'Group', () => {
      const transform = kind.value === 'prefix' ? { kind: 'prefix' as const, delimiter: delimiter.value, segments: Number(n.value) } : { kind: 'segment' as const, delimiter: delimiter.value, index: Number(n.value) };
      const group: GroupSource = { from: 'derived', key: source.value, transform };
      try { validateDerivedGroup(group); error.textContent = ''; this.update({ group, hiddenGroups: [], collapsedGroups: [] }); } catch (e) { error.textContent = e instanceof Error ? e.message : String(e); }
    }, false, 'graph-ng-add');
  }
  private colors(host: HTMLElement, r: ExploreResult) {
    const d = this.settings.declaration, hidden = new Set(this.view.hiddenColors), list = host.createDiv({ cls: 'graph-ng-legend' });
    const toggle = (name: string, on: boolean) => this.update({ hiddenColors: on ? this.view.hiddenColors.filter(n => n !== name) : [...this.view.hiddenColors, name] });
    d.colors.forEach((rule, i) => {
      const item = list.createDiv({ cls: 'graph-ng-legend-row' }), eye = item.createEl('input', { attr: { type: 'checkbox', 'aria-label': `Show ${rule.name}` } });
      eye.checked = !hidden.has(rule.name); eye.onchange = () => toggle(rule.name, eye.checked);
      if (/^#[0-9a-f]{6}$/i.test(rule.color)) {
        const swatch = item.createEl('input', { cls: 'graph-ng-color', attr: { type: 'color', 'aria-label': `Color for ${rule.name}` } }); swatch.value = rule.color;
        swatch.onchange = () => void this.host.setColors(d.colors.map((c, j) => j === i ? { ...c, color: swatch.value } : c));
      } else item.createSpan({ cls: 'graph-ng-swatch', attr: { title: rule.color } }).style.background = rule.color;
      item.createSpan({ cls: 'graph-ng-legend-name', text: rule.name, attr: { title: describePredicate(rule.predicate) } });
      countSpan(item, r.colorCounts[i]!);
      const up = item.createEl('button', { cls: 'clickable-icon', text: '↑', attr: { 'aria-label': `Move ${rule.name} earlier (first match wins)` } }); up.disabled = i === 0;
      up.onclick = () => { const next = d.colors.slice(); [next[i - 1], next[i]] = [next[i]!, next[i - 1]!]; void this.host.setColors(next); };
      panelButton(item, '×', () => void this.host.setColors(d.colors.filter((_, j) => j !== i)), false, 'clickable-icon', { 'aria-label': `Delete rule ${rule.name}` });
    });
    const rest = list.createDiv({ cls: 'graph-ng-legend-row' }), eye = rest.createEl('input', { attr: { type: 'checkbox', 'aria-label': 'Show notes matching no rule' } });
    eye.checked = !hidden.has(NO_COLOR); eye.onchange = () => toggle(NO_COLOR, eye.checked);
    rest.createSpan({ cls: 'graph-ng-legend-name', text: this.settings.visuals.autoPalette ? 'No rule (group colors)' : 'No rule' });
    countSpan(rest, r.colorCounts[d.colors.length]!);
    panelHelp(host, 'Rule order', 'The first matching rule sets the color. Changing colors does not move notes.');
    let name: HTMLInputElement, color: HTMLInputElement;
    this.predicateForm(host, r, 'Add rule', p => {
      const label = name.value.trim(); if (!label) throw new Error('Name the rule'); if (d.colors.some(c => c.name === label)) throw new Error('Rule names must be unique');
      void this.host.setColors([...d.colors, { name: label, color: color.value, predicate: p }]);
    }, form => {
      name = form.createEl('input', { attr: { type: 'text', placeholder: 'Rule name', 'aria-label': 'Rule name' } });
      color = form.createEl('input', { cls: 'graph-ng-color', attr: { type: 'color', 'aria-label': 'Rule color' } }); color.value = '#e6a23c';
    });
  }
  private legendCount(host: HTMLElement, visible: number, total: number, noun: string) {
    const count = countSpan(host, plural(visible, noun));
    if (visible < total) count.createEl('small', { text: plural(total - visible, `hidden ${noun}`) });
  }
  private edges(host: HTMLElement, r: ExploreResult) {
    if (this.host.setRelationshipDisplay && hasReified(this.settings.declaration)) this.relationshipDisplay(host);
    const hidden = new Set(this.view.hiddenTypes), list = host.createDiv({ cls: 'graph-ng-legend graph-ng-type-legend', attr: { role: 'list', 'aria-label': 'Relationship types and edges shown' } });
    r.types.forEach((type, i) => {
      const item = list.createDiv({ cls: 'graph-ng-legend-row', attr: { role: 'listitem' } }), eye = item.createEl('input', { attr: { type: 'checkbox', 'aria-label': `Show ${type} relationships` } });
      eye.checked = !hidden.has(type); eye.onchange = () => this.update({ hiddenTypes: eye.checked ? this.view.hiddenTypes.filter(t => t !== type) : [...this.view.hiddenTypes, type] });
      item.createSpan({ cls: 'graph-ng-legend-name', text: type });
      this.legendCount(item, r.typeVisible[i]!, r.typeTotals[i]!, 'edge');
    });
    if (!r.types.length) this.note(list, 'No relationships.');
    this.flag(host, 'edgeDirection', 'Show direction (fade from source to target)');
  }
  private flag(host: HTMLElement, key: { [K in keyof Visuals]: Visuals[K] extends boolean ? K : never }[keyof Visuals], label: string, labels = false) {
    const row = settingRow(host, label, 'graph-ng-toggle'), box = row.querySelector('input')!;
    box.checked = this.settings.visuals[key];
    box.onchange = () => { this.settings.visuals[key] = box.checked; this.host.visualsChanged(labels); this.guards.forEach(update => update()); };
  }
  private slider(host: HTMLElement, label: string, curve: Curve, get: () => number, set: (v: number) => void, labels = false, more: Partial<SliderOptions> = {}) {
    const { min, max } = curve, [, name = label, unit] = /^(.+) \((px|ms)\)$/.exec(label) ?? [];
    const { number } = progressiveSlider(host, { label, name, unit, curve, value: String(get()), attr: { min: String(min), max: String(max) }, ...more, changed: value => {
      const n = value.trim() ? Number(value) : NaN, valid = Number.isFinite(n) && n >= min && n <= max;
      number.setAttribute('aria-invalid', String(!valid)); if (!valid) return;
      set(n); this.host.visualsChanged(false); this.guards.forEach(update => update());
    }, commit: labels ? () => this.host.visualsChanged(true) : undefined });
  }
  private guard(host: HTMLElement, effect: string) {
    const box = host.createEl('details', { cls: 'graph-ng-guard' });
    const summary = disclosure(box).querySelector('.graph-ng-disclosure-label')!, reason = disclosureBody(box);
    const update = () => { const reasons = this.host.policy().filter(r => r.includes(effect) || r.includes('software renderer')); box.hidden = !reasons.length; summary.textContent = `${effect[0]!.toUpperCase() + effect.slice(1)} ${reasons.some(r => r.includes('limited')) ? 'limited' : 'turned off'} by the performance guard`; reason.textContent = reasons.join('; '); };
    this.guards.push(update); update();
  }
  private physics(host: HTMLElement) {
    const applied = (): Record<PhysicsKey, string | boolean> => { const l = this.settings.layout; return Object.fromEntries(PHYSICS_FIELDS.map(([key]) => { const v = key === 'iterations' ? l.iterations : l.force[key]; return [key, typeof v === 'boolean' ? v : String(v)]; })) as Record<PhysicsKey, string | boolean>; };
    const draft = this.physicsDraft ??= applied();
    const fill = (values: Required<PhysicsValues>, name: string) => { this.physicsUndo = { values: { ...draft }, name, applied: false }; for (const [key] of PHYSICS_FIELDS) { const v = values[key]; draft[key] = typeof v === 'boolean' ? v : String(v); } this.physicsError = ''; this.render(); };
    const size = this.host.result(), recommended = recommendedPhysics(size?.nodes ?? 1000, size?.edges ?? 3000);
    panelHelp(host, 'How changes apply', 'Apply layout saves these changes and recomputes note positions. The graph stays framed until you pan or zoom.');
    const presets = settingRow(host, 'Presets', 'graph-ng-presets', 'Groups apart loosens the layout; Fill the screen tightens it. Faster uses fewer steps; presets stay drafts until Apply.').createDiv({ cls: 'graph-ng-setting-line', attr: { role: 'group', 'aria-label': 'Layout presets' } });
    const label = presets.createEl('label', { cls: 'graph-ng-preset-choice' });
    label.createSpan({ cls: 'graph-ng-sr-only', text: 'Layout preset' });
    const names = ['Recommended', ...PHYSICS_PRESETS.map(([name]) => name)], select = label.createEl('select');
    for (const name of names) select.createEl('option', { text: name, value: name });
    select.value = names.includes(this.physicsUndo?.name ?? '') ? this.physicsUndo!.name : 'Recommended'; select.disabled = this.physicsBusy;
    panelButton(presets, 'Use preset', () => fill(select.value === 'Recommended' ? recommended : presetValues(select.value, recommended), select.value), this.physicsBusy);
    const advice = this.host.layoutAdvice?.();
    if (advice) {
      // Keeps every other draft value; only turns Strong gravity on with a measured pull.
      const suggestion = host.createDiv({ cls: 'graph-ng-setting-line' });
      panelButton(suggestion, PULL_IN, () => fill({ ...draft, strongGravityMode: true, gravity: advice.gravity } as unknown as Required<PhysicsValues>, PULL_IN), this.physicsBusy);
      panelHelp(suggestion, 'Why pull them in?', advice.reason);
    }
    const undo = this.physicsUndo;
    if (undo) {
      const button = iconButton(presets, 'Undo preset', 'undo-2'); button.disabled = this.physicsBusy;
      button.onclick = () => { Object.assign(draft, undo.values); this.physicsUndo = undefined; if (undo.applied) void run(); else this.render(); };
    }
    const summarize = () => {
      const now = applied(), diff = PHYSICS_FIELDS.filter(([key]) => draft[key] !== now[key]); changes.empty(); changes.hidden = !diff.length;
      if (diff.length) {
        const details = changes.createEl('details'); disclosure(details, plural(diff.length, 'change')); const body = disclosureBody(details);
        const show = (v: string | boolean) => typeof v === 'boolean' ? (v ? 'on' : 'off') : v;
        for (const [key, title] of diff) statRow(body, 'minus', title, `${show(now[key])} → ${show(draft[key])}`);
      }
    };
    const basic = host.createDiv(), advanced = host.createEl('details', { cls: 'graph-ng-physics-advanced' });
    disclosure(advanced, 'Advanced layout'); const body = disclosureBody(advanced); advanced.open = this.physicsAdvanced; advanced.ontoggle = () => { this.physicsAdvanced = advanced.open; };
    for (const [key, title, help, more] of PHYSICS_FIELDS) {
      if (key === 'familyPull' && !this.settings.declaration.hierarchy) continue;
      const parent = more ? body : basic, value = draft[key], def = recommended[key];
      if (typeof value === 'boolean') {
        const row = settingRow(parent, title, 'graph-ng-toggle graph-ng-physics-field', help), input = row.querySelector('input')!;
        input.disabled = this.physicsBusy; input.checked = value; input.onchange = () => { draft[key] = input.checked; summarize(); };
      } else progressiveSlider(parent, { label: title, desc: help, curve: PHYSICS_CURVES[key]!, value, def: def as number, disabled: this.physicsBusy, cls: 'graph-ng-physics-field', attr: { step: key === 'iterations' ? '1' : 'any', ...((key === 'familyPull' || key === 'hubGravity') ? { min: '0', max: '10' } : key === 'gravity' ? { min: '0' } : key === 'iterations' ? { min: '1' } : {}) }, changed: v => { draft[key] = v; summarize(); } });
    }
    host.createDiv({ cls: 'graph-ng-explore-error', text: this.physicsError, attr: { role: 'alert' } });
    const unsettled = this.host.layoutSettled?.() === false;
    if (unsettled) this.note(host, 'Layout not settled');
    const actions = host.createDiv({ cls: 'graph-ng-layout-actions' });
    const apply = actions.createEl('button', { cls: 'mod-cta' }); workingText(apply, this.physicsBusy ? 'Recomputing…' : unsettled ? 'Keep refining' : 'Apply layout', this.physicsBusy);
    const changes = actions.createDiv({ cls: 'graph-ng-layout-changes', attr: { 'aria-live': 'polite' } }); summarize();
    apply.disabled = this.physicsBusy;
    apply.onclick = () => run();
    const run = async () => {
      if (this.physicsBusy || this.disposed) return;
      try {
        const values = Object.fromEntries(PHYSICS_FIELDS.map(([key]) => { const v = draft[key]; return [key, typeof v === 'boolean' ? v : v.trim() ? Number(v) : NaN]; })) as unknown as PhysicsValues;
        physicsSettings(this.settings, values);
        this.physicsBusy = true; this.physicsError = ''; this.render();
        await this.host.applyLayout(values);
        if (this.physicsUndo) this.physicsUndo.applied = true;
      } catch (e) { this.physicsError = `Not applied: ${e instanceof Error ? e.message : String(e)}`; }
      finally { this.physicsBusy = false; if (!this.disposed) this.render(); }
    };
  }
  updateLensControl() {
    if (!this.lensButton) return;
    const state = this.host.lens?.();
    this.lensButton.disabled = !state?.available; this.lensButton.checked = !!state?.active;
  }
  updateSizingReadout() {
    const readout = this.body.querySelector('.graph-ng-sizing-readout');
    if (readout) readout.textContent = this.host.sizingReadout?.() ?? '';
  }
  private nodes(host: HTMLElement) {
    const group = host.createDiv({ cls: 'graph-ng-nodes' }); group.createEl('h4', { text: 'Nodes' });
    const current = sizingValues(this.settings);
    const draft = this.sizingDraft ??= { radius: String(current.radius), prominence: String(current.prominence), compensation: String(current.compensation * 100), floor: String(current.floor * 100), curve: current.curve };
    const sync: (() => void)[] = [];
    const tune = (value: string) => {
      draft.radius = String(Math.max(1, Number(draft.radius) || 1)); draft.prominence = value;
      sync.forEach(update => update()); preview(); this.updateSizingReadout();
    };
    progressiveSlider(group, { label: 'Hub size', unit: '×', desc: 'Live preview from 1× to 25×. Keeps a base of at least 1 px; other advanced values stay unchanged. None/Balanced/Strong presets also reset the curve to Linear, shrinking to 0% and retained base to 100%. Apply sizing saves; Restore cancels.', curve: { min: 1, max: 25 }, value: draft.prominence, def: 5, attr: { min: '1', max: '25' }, disabled: this.sizingBusy || !this.host.previewSizing, changed: tune });
    const presets = group.createDiv({ cls: 'graph-ng-form' });
    for (const [label, value] of [['None', 1], ['Balanced', 5], ['Strong', 9]] as const) panelButton(presets, label, () => { Object.assign(draft, { curve: 'linear', compensation: '0', floor: '100' }); tune(String(value)); this.render(); }, this.sizingBusy || !this.host.previewSizing);
    group.createDiv({ cls: 'graph-ng-explore-note graph-ng-sizing-readout', text: this.host.sizingReadout?.() ?? '' });
    const advanced = group.createEl('details'); disclosure(advanced, 'Advanced sizing'); const body = disclosureBody(advanced);
    const fields: [Exclude<keyof NodeSizingValues, 'curve'>, string, string, Curve][] = [
      ['radius', 'Node size', 'px', { min: .01, max: 20, k: 3 }],
      ['compensation', 'Shrink crowded dots', '%', { min: 0, max: 100 }], ['floor', 'Retain base size', '%', { min: .1, max: 100, k: 2 }],
    ];
    const help = { radius: 'Dot radius before zoom and crowding adjustments. Type a larger value for larger dots.', prominence: 'Largest hub radius compared with an unconnected note. 1 keeps dots the same size.', compensation: 'How much crowding shrinks dots, not the space between them. 0 turns shrinking off.', floor: 'Minimum base radius kept after crowding shrink, not a percentage of hub size. Applies equally to every note. Tiny dots also have a one-device-pixel radius minimum.' };
    const message = group.createDiv({ cls: 'graph-ng-explore-note', attr: { role: 'status', 'aria-live': 'polite' } }); message.textContent = this.sizingMessage;
    const changed = (key: keyof NodeSizingValues, value: string) => { draft[key] = value; this.sizingPreview = false; this.host.previewSizing?.(null); this.sizingMessage = message.textContent = 'Draft not previewed or saved.'; };
    const curve = settingSelect(body, 'Size by connections', 'Chooses how connection counts change dot sizes. Previous keeps the earlier sizing curve.', [['sqrt', 'Square root'], ['log', 'Logarithmic'], ['linear', 'Linear'], ['legacy', 'Previous']], draft.curve, value => changed('curve', value), 'graph-ng-select', this.sizingBusy);
    sync.push(() => { curve.value = draft.curve; });
    const base = sizingValues(defaults('links')), initial = { ...base, compensation: base.compensation * 100, floor: base.floor * 100 };
    for (const [key, title, unit, range] of fields) {
      const field = progressiveSlider(body, { label: title, unit, desc: help[key], curve: range, value: draft[key], def: initial[key], disabled: this.sizingBusy, cls: 'graph-ng-sizing-row', attr: { min: key === 'prominence' ? '1' : '0', max: String(key === 'radius' ? MAX_NODE_RADIUS : key === 'prominence' ? 25 : 100) }, changed: value => changed(key, value) });
      sync.push(() => field.sync(draft[key]));
    }
    const values = () => {
      const parsed = Object.fromEntries(Object.entries(draft).map(([key, value]) => [key, key === 'curve' ? value : value.trim() ? Number(value) : NaN])) as unknown as NodeSizingValues;
      parsed.compensation /= 100; parsed.floor /= 100; sizingSettings(this.settings, parsed); return parsed;
    };
    const preview = () => { try { this.host.previewSizing?.(values()); this.sizingPreview = true; this.sizingMessage = 'Previewing. Not saved.'; } catch (e) { this.host.previewSizing?.(null); this.sizingPreview = false; this.sizingMessage = `Not previewed: ${String(e)}`; } message.textContent = this.sizingMessage; };
    const actions = group.createDiv({ cls: 'graph-ng-form' });
    panelButton(actions, 'Preview sizing', preview, this.sizingBusy || !this.host.previewSizing);
    const apply = actions.createEl('button'); workingText(apply, this.sizingBusy ? 'Saving…' : 'Apply sizing', this.sizingBusy); apply.disabled = this.sizingBusy || !this.host.applySizing;
    apply.onclick = async () => {
      if (this.sizingBusy || this.disposed) return;
      try { const v = values(); this.sizingBusy = true; this.render(); await this.host.applySizing!(v); this.sizingDraft = undefined; this.sizingPreview = false; this.sizingMessage = 'Saved'; }
      catch (e) { this.host.previewSizing?.(null); this.sizingMessage = `Not saved: ${String(e)}. Preview cleared.`; }
      finally { this.sizingBusy = false; if (!this.disposed) this.render(); }
    };
    panelButton(actions, 'Restore sizing', () => { this.host.previewSizing?.(null); this.sizingDraft = undefined; this.sizingPreview = false; this.sizingMessage = 'Saved sizing restored'; this.render(); }, this.sizingBusy);
  }
  /** Opinionated defaults for the loaded graph's shape. Preview is unsaved; only Apply writes. */
  private suggested(host: HTMLElement) {
    const list = this.host.suggestions?.(); if (list === undefined) return;
    const box = host.createDiv({ cls: 'graph-ng-nodes' }); box.createEl('h4', { text: 'Suggested for this graph' });
    const message = box.createDiv({ cls: 'graph-ng-explore-note', attr: { role: 'status', 'aria-live': 'polite' } }); message.textContent = this.suggestMessage;
    if (!list) return void this.note(box, 'Open Notes first.');
    if (!list.length) return void this.note(box, 'Settings already match.');
    const apply = async (items: Suggestion[]) => {
      if (this.suggestBusy || this.disposed) return;
      try { this.suggestBusy = true; this.render(); await this.host.applySuggestions!(items); this.suggestMessage = 'Saved'; }
      catch (e) { this.suggestMessage = `Not saved: ${e}`; }
      finally { this.suggestPreview = false; this.suggestBusy = false; if (!this.disposed) this.render(); }
    };
    for (const item of list) {
      const row = box.createDiv({ cls: 'graph-ng-suggestion-row' });
      panelHelp(row.createDiv({ cls: 'graph-ng-suggestion' }), suggestionCopy(item), item.reason);
      panelButton(row, 'Apply', () => apply([item]), this.suggestBusy || !this.host.applySuggestions, '', { 'aria-label': `Apply ${item.label}` });
    }
    const actions = box.createDiv({ cls: 'graph-ng-actions' });
    panelButton(actions, this.suggestPreview ? 'End preview' : 'Preview', () => {
      this.suggestPreview = !this.suggestPreview; this.host.previewSuggestions!(this.suggestPreview ? list : null);
      this.suggestMessage = this.suggestPreview ? 'Previewing. Not saved.' : ''; this.render();
    }, this.suggestBusy || !this.host.previewSuggestions);
    const all = actions.createEl('button', { cls: 'mod-cta' }); workingText(all, this.suggestBusy ? 'Saving…' : 'Apply all', this.suggestBusy); all.disabled = this.suggestBusy || !this.host.applySuggestions; all.onclick = () => apply(list);
  }
  private display(host: HTMLElement) {
    const s = this.settings, v = s.visuals;
    type NumericVisual = { [K in keyof Visuals]: Visuals[K] extends number ? K : never }[keyof Visuals];
    const initial = defaultVisuals(), slider = (key: NumericVisual, label: string, curve: Curve, desc?: string, labels = false, parent = host) =>
      this.slider(parent, label, curve, () => v[key], value => { v[key] = value; }, labels, { def: initial[key], desc });
    const choice = <K extends 'edgeCompositing' | 'emphasis' | 'labelStyle' | 'namePriority' | 'motion' | 'clickFraming' | 'cardPlacement'>(parent: HTMLElement, key: K, label: string, desc: string, options: [Visuals[K], string][], labels = false) =>
      settingSelect(parent, label, desc, options, v[key] ?? 'anchored', value => { v[key] = value as Visuals[K]; this.host.visualsChanged(labels); if (labels) this.render(); });
    this.suggested(host);
    this.nodes(host);
    panelHelp(host.createEl('h4'), 'Live appearance', 'These controls save immediately in plugin settings, not saved views. Closing the panel ends any preview.');
    this.slider(host, 'Label density', { min: .25, max: 3, log: true }, () => s.labelDensity, x => { s.labelDensity = x; }, true, { def: 1 });
    this.edgeMode(host);
    choice(host, 'edgeCompositing', 'Edge compositing', 'Density reduces faint overlap; Blend keeps the original strokes. Canvas uses Blend.', [['blend', 'Blend (default)'], ['density', 'Density']]);
    slider('edgeOpacity', 'Edge opacity', { min: 0, max: 1, k: 2.5 }, '0 hides every edge, including highlights; 1 is fully opaque. Relationships remain available in Filters.');
    slider('edgeColorMix', 'Edge color blend', { min: 0, max: 1 });
    slider('glow', 'Glow', { min: 0, max: 1, k: 2 });
    this.guard(host, 'glow');
    slider('curvature', 'Curvature', { min: 0, max: .5, k: 1.5 });
    this.flag(host, 'curvedEdges', 'Curved edges');
    this.guard(host, 'curves');
    this.flag(host, 'groupHalos', 'Group halos (faint tint behind groups at mid zoom)');
    this.guard(host, 'halos');
    this.flag(host, 'autoPalette', 'Group colors (when no rule matches)');
    if (this.host.toggleLens) {
      this.lensButton = settingRow(host, 'Connection lens', 'graph-ng-toggle', 'Brings the selected note’s direct connections into rings temporarily. Follows selection. L toggles it; Escape closes it.').querySelector('input')!;
      this.lensButton.onchange = () => { this.host.toggleLens?.(); this.updateLensControl(); };
      this.updateLensControl();
    }
    choice(host, 'cardPlacement', 'Card placement', 'Side uses a sheet when space is tight. Auto switches earlier.', [['auto', 'Auto (default)'], ['side', 'Side'], ['sheet', 'Bottom sheet']]);
    choice(host, 'clickFraming', 'Click framing (experimental)', 'Move only when needed. Off only uncovers the selected note. Respects Motion.', [['off', 'Off (default)'], ['center', 'Center when hidden'], ['fit-neighbours', 'Fit connections']]);
    settingSelect(host, 'Click a note', 'Highlight shows direct connections, neighbours of neighbours and dimmed context. Relationship notes count with their endpoints. Ctrl/Cmd-click opens a note; touch shows its card.', [['highlight', 'Highlight connections (default)'], ['card', 'Open the card only'], ['open', 'Open the note']], v.clickOpens ? 'open' : v.hoverHighlight ? 'highlight' : 'card', value => { v.clickOpens = value === 'open'; if (value !== 'open') v.hoverHighlight = value === 'highlight'; this.host.visualsChanged(false); });
    const details = host.createEl('details', { cls: 'graph-ng-highlight-options' }); disclosure(details, 'Finding connections'); const find = disclosureBody(details);
    choice(find, 'emphasis', 'Highlight emphasis', 'Adaptive (default) limits growth in large neighbourhoods. Scale keeps the original magnification.', [['adaptive', 'Adaptive'], ['scale', 'Scale']]);
    slider('tierMinSize', 'Highlighted size target (px)', { min: 0, max: 16, k: 1.5 }, 'Adaptive reduces this target for large neighbourhoods; Scale uses it as a minimum. 0 disables neighbour size targets.', false, find);
    for (const [key, label] of [
      ['tierRings', 'Connection rings (around the focus and direct connections)'],
      ['focusEdges', 'Strong focus edges (fade the rest)'],
      ['offscreenPips', 'Off-screen arrows (point to direct connections)'],
      ['tierLegend', 'Connection counts (show a legend for each tier)'],
      ['focusRipple', 'Selection ripple'],
      ['bridgesFirst', 'Bridges first: rank connections to other groups higher'],
      ['breadcrumb', 'Visited notes (show a trail along the top)'],
      ['minimap', 'Minimap (hidden under 500 px wide)'],
    ] as const) this.flag(find, key, label);
    choice(host, 'labelStyle', 'Label style', 'Names show the most connected notes that fit without overlapping. Zoom in for more. Anchored names stay one size; Ranked names grow with connection count.', [['anchored', 'Anchored'], ['ranked', 'Ranked']], true);
    choice(host, 'namePriority', 'Name which notes', 'Selection always names direct connections before unrelated hubs. All that fit uses the existing bounded candidate pool, not every note at once.', [['connected', 'Most connected (default)'], ['selection', 'Selection and its connections'], ['all', 'All that fit']], true);
    if ((v.labelStyle ?? 'anchored') === 'ranked') {
      this.flag(host, 'labelFade', 'Fade labels (by zoom and importance)', true);
      slider('labelTierScale', 'Label size range', { min: 1, max: 1.6, k: 1.5 }, 'Focus and well-connected notes get larger names. 1 keeps names one size.', true);
    }
    choice(host, 'motion', 'Motion', 'All modes respect your system’s reduced-motion setting. Reduced and Off settle immediately.', [['full', 'Full (default)'], ['reduced', 'Reduced'], ['off', 'Off']]);
    this.flag(host, 'labelPlates', 'Label backgrounds');
    this.flag(host, 'zoomAdapt', 'Adapt to zoom: fade crowded edges and shrink hubs when zoomed out');
    if (this.host.setRelationshipDisplay && hasReified(s.declaration)) this.relationshipDisplay(host);
    if (this.host.carriers()) {
      slider('carrierOpacity', 'Relationship-note opacity', { min: 0, max: 1, k: 2 });
      slider('carrierSize', 'Relationship-note size', { min: .001, max: 4, k: 2 });
      this.flag(host, 'carrierTint', 'Endpoint colors (for relationship notes)');

    }
  }
  /** Edges: All / Focus only / Off. Live, saved with plugin settings. */
  private edgeMode(host: HTMLElement) {
    const v = this.settings.visuals, row = settingRow(host, 'Edges', 'graph-ng-segmented', 'Focus only draws edges just for the selected note and its connections.');
    const line = row.createDiv({ cls: 'graph-ng-setting-line', attr: { role: 'group', 'aria-label': 'Edges' } });
    const modes: [EdgeMode, string][] = [['all', 'All'], ['focus', 'Focus only'], ['off', 'Off']];
    const buttons = modes.map(([mode, text]) => {
      const button = line.createEl('button', { text, attr: { 'aria-pressed': String(v.edgeMode === mode) } });
      button.onclick = () => { v.edgeMode = mode; buttons.forEach((b, i) => b.setAttribute('aria-pressed', String(modes[i]![0] === mode))); this.host.visualsChanged(false); };
      return button;
    });
  }
  confirmRelationshipDisplay(nodes: boolean) { this.relationPending = nodes; this.show('appearance'); this.body.querySelector('.graph-ng-relation-confirm')?.scrollIntoView({ block: 'nearest' }); }
  private relationBusy = false;
  private relationMessage = '';
  private relationPending?: boolean;
  private relationshipDisplay(host: HTMLElement) {
    const nodes = this.settings.declaration.display.reifiedAsNodes, count = this.host.relationshipNotes?.() ?? 0;
    const row = host.createDiv({ cls: 'graph-ng-row graph-ng-segmented', attr: { role: 'group', 'aria-label': 'Relationship notes' } });
    panelHelp(row, 'Relationship notes');
    for (const [value, text] of [[false, 'Lines'], [true, 'Notes']] as const) {
      const button = row.createEl('button', { text, attr: { 'aria-pressed': String(nodes === value) } }); button.disabled = this.relationBusy || nodes === value;
      button.onclick = () => { this.relationPending = value; this.render(); };
    }
    if (nodes) settingSelect(host, 'Relationship lines', 'Auto folds tiny dots; Through the note keeps both legs; Direct joins the endpoints.', [['auto', 'Auto (default)'], ['through', 'Through the note'], ['direct', 'Direct']], this.settings.visuals.carrierLines, value => { this.settings.visuals.carrierLines = value as Visuals['carrierLines']; this.settings.visuals.carrierLod = value !== 'through'; this.host.visualsChanged(false); });
    if (this.relationPending !== undefined && this.relationPending !== nodes) {
      const value = this.relationPending, confirm = host.createDiv({ cls: 'graph-ng-relation-confirm' });
      const total = Math.max(0, (this.host.result()?.nodes ?? 0) + (value ? count : -count));
      this.note(confirm, `Switch to ${value ? 'Notes' : 'Lines'}? Rebuilds the layout${total ? ` for up to ${num(total)} notes` : ''}.`);
      panelButton(confirm, 'Cancel', () => { this.relationPending = undefined; this.render(); });
      panelButton(confirm, 'Switch', async () => {
        this.relationPending = undefined; this.relationBusy = true; this.relationMessage = 'Rebuilding graph…'; this.render();
        try { await this.host.setRelationshipDisplay!(value); this.relationMessage = ''; }
        catch (e) { this.relationMessage = `Not switched: ${String(e)}. The displayed graph is unchanged.`; }
        finally { this.relationBusy = false; if (!this.disposed) this.render(); }
      }, this.relationBusy);
    }
    if (this.relationMessage) workingText(host.createDiv({ cls: 'graph-ng-explore-note', attr: { role: 'status' } }), this.relationMessage, this.relationBusy);
  }
  private viewDefinition(host: HTMLElement, saved: SavedView) {
    const v = saved.view, none = (x: string[]) => x.join(', ') || '(none)';
    const rows = [['Search', v.query || '(none)'], ['Filters', v.filters.map(describePredicate).join('; ') || '(none)'], ['Grouping', v.group ? groupLabel(v.group) : 'Current declared default'], ['Hidden groups', none(v.hiddenGroups)], ['Collapsed', none(v.collapsedGroups)], ['Hidden colors', none(v.hiddenColors)], ['Hidden relationships', none(v.hiddenTypes)], ['Camera', saved.camera ? 'Saved camera applies in Notes' : 'Keep current camera when opened']];
    const box = host.createDiv({ cls: 'graph-ng-explore-note' });
    for (const [label, value] of rows) box.createDiv({ text: `${label}: ${value}` });
  }
  private viewConfiguration() { return canonical([this.settings.declaration, this.settings.groupLevel, this.settings.projectionFile]); }
  private saveFocus = false;
  private async saveViewDraft(expected: SavedView | null) {
    const draft = this.viewDraft; if (!draft || this.viewBusy) return;
    try {
      if (draft.configuration !== this.viewConfiguration()) { draft.configuration = this.viewConfiguration(); this.viewCollision = undefined; throw new Error('Graph configuration changed. Review this view again.'); }
      const saved = draft.folder === undefined ? structuredClone(draft.saved) : folderView(draft.folder, draft.saved.name);
      saved.name = saved.name.trim(); validateSaved([saved]);
      this.saveFocus = !this.root.hidden && this.tool === 'views' && this.body.contains(document.activeElement);
      if (this.saveFocus) this.closeButton.focus({ preventScroll: true });
      this.viewBusy = true; this.viewMessage = 'Saving…'; this.render();
      await this.host.commitSavedView!(saved, expected);
      this.viewDraft = undefined; this.viewCollision = undefined; this.viewSaved = saved;
      this.viewMessage = `Saved ‘${saved.name}’. Current graph unchanged.`;
    } catch (error) { this.viewMessage = `View was not saved: ${String(error)}`; }
    finally {
      this.viewBusy = false;
      if (!this.disposed) {
        this.render();
        if (this.saveFocus && !this.root.hidden && this.tool === 'views' && document.activeElement === this.closeButton) {
          [...this.body.querySelectorAll<HTMLButtonElement>('button')].find(button => !button.disabled && !button.getAttribute('aria-describedby'))?.focus({ preventScroll: true });
        }
      }
      this.saveFocus = false;
    }
  }
  private viewOpen(host: HTMLElement, saved: SavedView, label = 'Open') {
    const issue = this.host.savedViewIssue?.(saved) ?? '';
    if (issue) this.note(host, issue);
    panelButton(host, label, async () => {
      const request = ++this.openRequest;
      this.viewMessage = `Opening ‘${saved.name}’… Requested view; displayed graph may still show the previous result.`; this.render();
      try { await this.host.openSavedView!(saved); if (request === this.openRequest) { this.viewOrigin = saved.name; this.viewMessage = `Opened ‘${saved.name}’.${saved.camera && this.host.mode() !== 'nodes' ? ' Saved camera applies in Notes.' : ''}`; } }
      catch (error) { if (request === this.openRequest) this.viewMessage = `Could not finish opening ‘${saved.name}’: ${String(error)}. Displayed graph may still show the previous result.`; }
      if (!this.disposed) this.render();
    }, Boolean(issue), '', { 'aria-label': `Open view ${saved.name}` });
  }
  private views(host: HTMLElement) {
    workingText(host.createDiv({ attr: { role: 'status', 'aria-live': 'polite' } }), this.viewMessage, this.viewBusy || this.viewMessage.startsWith('Opening '));
    const back = () => { this.viewDraft = undefined; this.viewCollision = undefined; this.viewSaved = undefined; this.viewMessage = ''; this.render(); this.body.querySelector<HTMLButtonElement>('button')?.focus(); };
    const draft = this.viewDraft;
    if (draft) {
      host.createEl('h4', { text: 'Prepare view' });
      const form = host.createDiv({ cls: 'graph-ng-form' });
      const name = form.createEl('input', { attr: { type: 'text', 'aria-label': 'Saved view name', placeholder: 'View name', maxlength: String(VIEW_LIMITS.viewName) } }); name.value = draft.saved.name; name.disabled = this.viewBusy;
      name.oninput = () => { draft.saved.name = name.value; this.viewCollision = undefined; this.render(); };
      let folder: HTMLInputElement | undefined;
      if (draft.folder !== undefined) {
        folder = form.createEl('input', { attr: { type: 'text', 'aria-label': 'Folder prefix', placeholder: 'Folder/Subfolder' } }); folder.value = draft.folder; folder.disabled = this.viewBusy;
        folder.oninput = () => {
          if (!draft.saved.name || draft.saved.name === `${draft.folder} focus`) draft.saved.name = `${folder!.value} focus`;
          draft.folder = folder!.value; this.viewCollision = undefined; this.render();
        };
      }
      this.note(host, 'Definition preview');
      try { this.viewDefinition(host, draft.folder === undefined ? draft.saved : folderView(draft.folder, draft.saved.name)); }
      catch (error) { this.note(host, String(error)); }
      panelHelp(host, 'What opening changes', 'Opening replaces search, filters and hidden-item choices; matches are checked then. Current appearance, layout and relationship declarations stay unchanged.');
      panelButton(host, 'Save view', () => {
        const target = this.settings.explore.savedViews.find(v => v.name === draft.saved.name.trim());
        if (target) { this.viewCollision = structuredClone(target); this.render(); } else void this.saveViewDraft(null);
      }, this.viewBusy, 'mod-cta');
      if (this.viewCollision) {
        this.note(host, `A view named ‘${this.viewCollision.name}’ already exists.`);
        const expected = this.viewCollision;
        panelButton(host, 'Replace existing view', () => { void this.saveViewDraft(expected); }, this.viewBusy);
        panelButton(host, 'Keep editing', () => { this.viewCollision = undefined; this.render(); }, this.viewBusy);
      }
      panelButton(host, 'Cancel', back, this.viewBusy);
      return;
    }
    if (this.viewSaved) { this.viewOpen(host, this.viewSaved); panelButton(host, 'Back to views', back); return; }
    const s = this.settings;
    const start = host.createDiv({ cls: 'graph-ng-saved-record' });
    start.createSpan({ cls: 'graph-ng-saved-name', text: 'Show everything' });
    const actions = start.createDiv({ cls: 'graph-ng-row' });
    this.viewOpen(actions, everythingView(this.view));
    const help = panelHelp(actions, '', 'Clears search, filters, hidden items and collapsed groups. Keeps grouping and camera. Views save filters, grouping and camera in plugin settings, not files. Appearance, layout and selected-group scope stay unchanged. Active compares filters and grouping; the camera restores on Open. Declared exclusions still apply.');
    const info = help.parentElement!.querySelector('button')!; info.setAttribute('aria-label', 'About saved views and Show everything'); setIcon(info, 'info');
    if (!s.explore.savedViews.length) this.note(host, 'No saved views yet.');
    for (const saved of s.explore.savedViews) {
      const item = host.createDiv({ cls: 'graph-ng-saved-record' });
      const name = item.createDiv({ cls: 'graph-ng-saved-name', text: saved.name });
      const matches = canonical(saved.view) === canonical(this.view), active = matches && this.host.viewCurrent?.() !== false && !this.host.scoped?.() && !this.host.loading?.();
      if (active) this.viewOrigin ??= saved.name;
      if (active || !matches && this.viewOrigin === saved.name) {
        const state = name.createSpan({ cls: 'graph-ng-view-state' });
        if (active) { setIcon(state.createSpan(), 'check'); item.dataset.active = 'true'; }
        state.createSpan({ text: active ? 'Active' : 'Modified' });
      }
      const definition = item.createEl('details'); definition.open = this.viewDefinitions.has(saved.name);
      definition.ontoggle = () => { if (definition.open) this.viewDefinitions.add(saved.name); else this.viewDefinitions.delete(saved.name); };
      disclosure(definition, 'View definition', { 'aria-label': `View definition: ${saved.name}` }); this.viewDefinition(disclosureBody(definition), saved);
      const actions = item.createDiv({ cls: 'graph-ng-row' });
      this.viewOpen(actions, saved);
      const remove = iconButton(actions, `Delete view ${saved.name}`, 'trash-2'); remove.disabled = this.viewBusy; remove.onclick = async () => {
        this.viewBusy = true; this.viewMessage = 'Saving…'; this.render();
        try { await this.host.commitSavedView!(null, saved); this.viewMessage = `Deleted ‘${saved.name}’. Current graph unchanged.`; }
        catch (error) { this.viewMessage = `View was not deleted: ${String(error)}`; }
        finally { this.viewBusy = false; if (!this.disposed) this.render(); }
      };
    }
    const prepare = (folder?: string) => {
      this.viewSaved = undefined; this.viewMessage = ''; this.viewCollision = undefined;
      this.viewDraft = { saved: { name: '', view: structuredClone(this.view), camera: this.host.camera() }, folder, configuration: this.viewConfiguration() }; this.render();
      this.body.querySelector<HTMLInputElement>('input')?.focus();
    };
    panelButton(host, 'Save current view…', () => prepare(), this.viewBusy);
    host.createEl('h4', { text: 'Starting points' });
    panelHelp(host, 'Focus on a folder', 'Explore one folder using the current graph’s relationships. Prepare a view without changing the graph.');
    panelButton(host, 'Set up folder view…', () => prepare(''), this.viewBusy);
  }
}
