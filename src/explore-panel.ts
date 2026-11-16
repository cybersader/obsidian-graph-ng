import { panelHelp, disclosure } from './panel-help';
import { folderPredicate, folderView } from './saved-views';
import { setIcon } from 'obsidian';
import { sizingValues, sizingSettings, MAX_NODE_RADIUS, type NodeSizingValues } from './node-sizing';
import { physicsSettings, presetValues, PHYSICS_FIELDS, PHYSICS_PRESETS, type PhysicsKey, type PhysicsValues } from './physics-controls';
import { editAsExpression, builderPredicate, checked } from './core/expr/engine';
import { validate } from './core/expr/syntax';
import { filterSummary, hiddenClause, setToggles, toggleable, toggledValues } from './filter-summary';
import { countSpan, num, plural, shownHidden, statRow, sum } from './graph-information';
import { suggestions } from './core/expr/autocomplete';
import { declaredKeys } from './core/columns';
import { describePredicate, groupLabel, NO_COLOR, VIEW_LIMITS, validateSaved, validateView, type ExploreResult, type ExploreView, type SavedView, type ViewCamera } from './core/explore';
import { canonical, validateDerivedGroup, validatePredicate, type GraphDeclaration, type GroupSource, type Predicate, type Scalar } from './core/declaration';
import { defaults, defaultVisuals, type EdgeMode, type Settings, type Visuals } from './settings';
import { progressiveSlider, type Curve, type SliderOptions } from './progressive-slider';
/** Slider travel per numeric layout control; typed values outside the span stay unclamped. */
const PHYSICS_CURVES: Partial<Record<PhysicsKey, Curve>> = { scalingRatio: { min: .1, max: 100, log: true }, gravity: { min: 0, max: 20, k: 3 }, slowDown: { min: .1, max: 100, log: true }, iterations: { min: 1, max: 1000, log: true, int: true }, barnesHutTheta: { min: .1, max: 3, k: 2 } };
import { recommendedPhysics, suggestionCopy, type Suggestion } from './recommend';
/** The view owns the worker, renderer and persistence; the panel only edits state. */
export interface PanelHost {
  settings(): Settings;
  loading?(): { stage: string } | undefined;
  information?: HTMLElement;
  members?: HTMLElement;
  scope?(): string;
  scoped?(): boolean;
  presentation?(mode: string): void;
  preview(expr: string, context: 'filter' | 'group'): Promise<{ matched: number; total: number; groups?: number }>;
  result(): ExploreResult | undefined;
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
const TOOLS: [Tool, string, string][] = [['views', 'Saved views', 'bookmark'], ['filters', 'Filters', 'list-filter'], ['appearance', 'Appearance', 'palette'], ['layout', 'Layout', 'move'], ['information', 'Graph information', 'info']];
function toolButton(host: HTMLElement, text: string, icon: string) {
  const button = host.createEl('button', { cls: 'graph-ng-tool', attr: { 'aria-label': text, title: text } });
  setIcon(button, icon); button.createSpan({ cls: 'graph-ng-tool-label', text });
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
/** Short setting name; explanations share the same on-demand help as sliders. */
function settingRow(host: HTMLElement, label: string, cls: string, desc?: string) {
  const row = host.createEl(cls.includes('graph-ng-toggle') ? 'label' : 'div', { cls: `graph-ng-setting ${cls}` }), [, name = label, a, b] = (!desc && /^(.+?)(?: \((.+)\)|: (.+))$/.exec(label)) || [];
  if (row.tagName === 'LABEL') row.createEl('input', { attr: { type: 'checkbox', 'aria-label': name } });
  panelHelp(row, name, desc ?? a ?? b, 'graph-ng-setting-name');
  return row;
}
let expressionPanelId = 0;
const parseRaw = (raw: string): Scalar => { try { const v: unknown = JSON.parse(raw); return v === null || ['string', 'number', 'boolean'].includes(typeof v) ? v as Scalar : raw; } catch { return raw; } };
/** One nonmodal overlay; opening tools never changes the canvas rectangle or graph. */
export class ExplorePanel {
  readonly root: HTMLElement;
  private expressionPanelId = ++expressionPanelId;
  private viewDraft?: { saved: SavedView; folder?: string; configuration: string };
  private viewCollision?: SavedView;
  private viewSaved?: SavedView;
  private viewMessage = '';
  private viewBusy = false;
  private openRequest = 0;
  private physicsDraft?: Record<PhysicsKey, string | boolean>;
  private physicsNote = '';
  private physicsAdvanced = false;
  private sizingDraft?: Record<keyof NodeSizingValues, string>;
  private sizingMessage = '';
  private sizingBusy = false;
  private lensButton?: HTMLButtonElement;
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
    this.closeButton = head.createEl('button', { cls: 'clickable-icon graph-ng-explore-close', attr: { 'aria-label': 'Close graph tools', title: 'Close graph tools' } });
    setIcon(this.closeButton, 'x');
    this.closeButton.onclick = () => this.close();
    this.closeButton.onblur = () => { this.saveFocus = false; };
    this.root.onkeydown = e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.close(); } };
    this.counts = this.root.createDiv({ cls: 'graph-ng-explore-counts' });
    this.alert = this.root.createDiv({ cls: 'graph-ng-explore-error', attr: { role: 'alert' } });
    // Panel validation and view-operation feedback are separate messages; neither erases the other.
    this.invalid = this.alert.createDiv(); this.feedback = this.alert.createDiv();
    this.body = this.root.createDiv({ cls: 'graph-ng-explore-body' });
    const representations = this.toolbar.createDiv({ cls: 'graph-ng-representations', attr: { role: 'group', 'aria-label': 'Graph representation and scope' } });
    for (const [mode, label, icon] of [['nodes', 'Notes', 'file-text'], ['groups', 'Group overview', 'network']]) {
      const button = toolButton(representations, label!, icon!); this.representations.set(mode!, button);
      button.onclick = () => this.host.presentation?.(mode!);
    }
    const members = toolButton(representations, 'Members', 'list'); this.buttons.set('members', members); members.setAttribute('aria-controls', this.root.id); members.onclick = () => this.show('members', members);
    this.workspaceButton = toolButton(representations, 'Workspace scope', 'expand');
    this.workspaceButton.title = 'Leave the selected group; keep search and filters';
    this.workspaceButton.onclick = () => this.host.presentation?.('workspace');
    for (const [tool, text, icon] of TOOLS) {
      const button = toolButton(this.toolbar, text, icon); button.setAttribute('aria-controls', this.root.id); button.setAttribute('aria-expanded', 'false');
      this.buttons.set(tool, button); button.onclick = () => this.root.hidden || this.tool !== tool ? this.show(tool, button) : this.close();
      if (tool === 'views') {
        this.search = this.toolbar.createEl('input', { cls: 'graph-ng-explore-search', attr: { type: 'search', placeholder: 'Search notes…', 'aria-label': 'Search note names and IDs', spellcheck: 'false' } });
        this.search.maxLength = VIEW_LIMITS.query; this.search.value = view.query;
        this.search.oninput = () => { clearTimeout(this.searchTimer); if (this.settings.projectionFile) return; this.searchTimer = setTimeout(() => { if (!this.disposed && !this.settings.projectionFile) this.update({ query: this.search.value }); }, 160); };
      }
    }
    if (host.information) this.root.appendChild(host.information);
    if (host.members) this.root.appendChild(host.members);
    this.root.hidden = !s.explore.panelOpen; this.search = this.search!; this.layout();
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
  private toolTitle() { return this.tool === 'members' ? 'Groups & members' : this.tool === 'views' ? 'Saved views' : TOOLS.find(([tool]) => tool === this.tool)![1]; }
  private layout() {
    this.title.textContent = this.toolTitle();
    for (const [tool, button] of this.buttons) button.setAttribute('aria-expanded', String(!this.root.hidden && tool === this.tool));
    if (this.host.information) this.host.information.hidden = this.root.hidden || this.tool !== 'information';
    if (this.host.members) {
      this.host.members.hidden = this.root.hidden || this.tool !== 'members';
      if (this.tool === 'members' && !this.host.members.children.length) {
        this.note(this.host.members, 'Select a group to browse its available members.');
        this.host.members.createEl('button', { text: 'Group overview' }).onclick = () => this.host.presentation?.('groups');
      }
    }
    this.body.hidden = this.root.hidden || this.tool === 'information' || this.tool === 'members'; this.render();
    this.host.toolsChanged?.();
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
    this.buttons.get('filters')!.querySelector('.graph-ng-tool-label')!.textContent = `Filters${this.view.filters.length ? ` (${this.view.filters.length})` : ''}`;
    for (const [mode, button] of this.representations) button.setAttribute('aria-pressed', String(this.host.mode() === mode));
    this.workspaceButton.disabled = !this.host.scoped?.();
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
  private summary(external: boolean, r?: ExploreResult) {
    this.counts.empty();
    if (this.host.scoped?.()) this.counts.createDiv({ cls: 'graph-ng-scope-name', text: `In ${this.host.scope?.()}` });
    const loading = this.host.loading?.();
    if (external || !r) { this.note(this.counts, loading?.stage ?? (external ? 'External aggregate' : 'Waiting for projection…')); return; }
    const stats = this.counts.createDiv({ cls: 'graph-ng-stats' });
    const shown = sum(r.visible), notes = r.nodes - shown, edges = r.edges - r.visibleEdges;
    statRow(stats, 'circle-dot', loading ? 'Notes shown so far' : 'Notes shown', num(shown)); statRow(stats, 'spline', loading ? 'Edges drawn so far' : 'Edges drawn', num(r.visibleEdges));
    if (loading) { statRow(stats, 'loader', loading.stage, '', 'graph-ng-loading-counts'); return; }
    if (notes || edges) statRow(stats, 'eye-off', 'Hidden, see why', `${plural(notes, 'note')}, ${plural(edges, 'edge')}`, '', () => this.show('information'));
  }
  private note(host: HTMLElement, text: string) { return host.createDiv({ cls: 'graph-ng-explore-note', text }); }
  /** One bounded text editor serves filters, colours and custom group values. */
  private expressionField(host: HTMLElement, r: ExploreResult, label: string, context: 'filter' | 'group', submit: (expr: string) => void) {
    const details = host.createEl('details', { cls: 'graph-ng-expression' }); details.open = this.drafts.has(label);
    disclosure(details, label);
    const input = details.createEl('input', { attr: { type: 'text', 'aria-label': label, placeholder: context === 'filter' ? 'note.status == "open"' : 'note.category', spellcheck: 'false' } });
    input.value = this.drafts.get(label) ?? '';
    const completions = details.createEl('datalist'), id = `graph-ng-expr-${this.expressionPanelId}-${label.split(' ').join('-')}`; completions.id = id; input.setAttribute('list', id);
    const feedback = details.createEl('pre', { cls: 'graph-ng-expression-status', attr: { role: 'status', 'aria-live': 'polite' } });
    const apply = details.createEl('button', { text: context === 'group' ? 'Group by expression' : 'Apply expression', cls: 'mod-cta' });
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
    if (input.value) sync(); else apply.disabled = true;
  }
  private filters(host: HTMLElement, r: ExploreResult) {
    const filters = this.view.filters, count = filters.length;
    // Per-filter counts only when the result is for exactly these filters.
    const hidden = r.filters && canonical(r.filters.slice(0, count)) === canonical(filters) ? r.filterHidden : undefined, total = hidden && sum(hidden.slice(0, count));
    const sentence = host.createDiv({ cls: 'graph-ng-filter-sentence', attr: { role: 'status' } });
    if (!count) sentence.textContent = 'No filters. Every note is shown.';
    else {
      const clause = hiddenClause(filters[0]!);
      sentence.createSpan({ text: `Hiding ${total === undefined ? 'notes' : plural(total, 'note')} ${count > 1 ? `with ${count} filters` : clause.code ? 'not matching ' : clause.text}` });
      if (count === 1 && clause.code) sentence.createEl('code', { text: clause.text });
    }
    // Pills: readable summary, then small labelled icon actions. Text is never a click target.
    const chips = host.createDiv({ cls: 'graph-ng-chips', attr: { role: 'list', 'aria-label': 'Active filters' } });
    const icon = (parent: HTMLElement, label: string, name: string, cls = '') => { const b = parent.createEl('button', { cls: `clickable-icon graph-ng-chip-action ${cls}`, attr: { 'aria-label': label, title: label } }); setIcon(b, name); return b; };
    this.view.filters.forEach((f, i) => {
      const chip = chips.createDiv({ cls: 'graph-ng-chip', attr: { role: 'listitem' } }), summary = filterSummary(f), description = describePredicate(f);
      chip.createSpan({ cls: summary.code ? 'graph-ng-chip-text graph-ng-chip-code' : 'graph-ng-chip-text', text: summary.text, attr: { title: description } });
      if (hidden) countSpan(chip, hidden[i]!, 'Notes this filter hides that no earlier filter hides');
      const converted = editAsExpression(f), edit = icon(chip, `Edit filter ${i + 1} as expression`, 'pencil');
      edit.disabled = !converted.text; if (converted.reason) edit.title = converted.reason;
      edit.onclick = () => { this.drafts.set(`Edit filter ${i + 1}`, converted.text!); this.render(); };
      if (f.kind !== 'expr') {
        const builder = chip.createEl('details', { cls: 'graph-ng-chip-json' });
        setIcon(builder.createEl('summary', { attr: { 'aria-label': `Edit builder filter ${i + 1} as JSON` } }), 'braces');
        const input = builder.createEl('textarea', { attr: { 'aria-label': `Builder filter ${i + 1}` } }); input.value = JSON.stringify(f, null, 2);
        const error = builder.createDiv({ cls: 'graph-ng-explore-error', attr: { role: 'alert' } });
        builder.createEl('button', { text: 'Save builder entry' }).onclick = () => { try { const value: unknown = JSON.parse(input.value); validatePredicate(value); this.update({ filters: this.view.filters.map((p, j) => j === i ? value : p) }); } catch (e) { error.textContent = String(e); } };
      }
      const remove = icon(chip, 'Remove filter', 'x', 'graph-ng-remove'); remove.title = `Remove filter: ${summary.text}`;
      remove.onclick = () => { this.update({ filters: this.view.filters.filter((_, j) => j !== i) }); (this.body.querySelectorAll<HTMLButtonElement>('.graph-ng-remove')[i] ?? this.search).focus(); };
      if (this.drafts.has(`Edit filter ${i + 1}`)) this.expressionField(chip, r, `Edit filter ${i + 1}`, 'filter', expr => { this.drafts.delete(`Edit filter ${i + 1}`); this.update({ filters: this.view.filters.map((p, j) => j === i ? { kind: 'expr', expr } : p) }); });
    });
    this.filterToggles(host, r);
    const add = host.createEl('details', { cls: 'graph-ng-add-filter' }); add.open = this.adding || this.drafts.has('Filter expression');
    add.ontoggle = () => { this.adding = add.open; };
    disclosure(add, 'Add filter');
    this.predicateForm(add, r, 'Add filter', p => { this.adding = false; this.update({ filters: [...this.view.filters, p] }); }, true);
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
  private predicateForm(host: HTMLElement, r: ExploreResult, action: string, submit: (p: Predicate) => void, operators: boolean, extra?: (row: HTMLElement) => void) {
    const filter = action === 'Add filter', form = host.createDiv({ cls: filter ? 'graph-ng-form graph-ng-builder' : 'graph-ng-form', attr: filter ? { role: 'group', 'aria-label': 'Add filter' } : {} }); extra?.(form);
    const property = form.createEl('select', { attr: { 'aria-label': 'Property' } });
    for (const f of r.facets) property.createEl('option', { value: `k:${f.key}`, text: f.key });
    property.createEl('option', { value: 'folder', text: 'Folder' });
    const op = form.createEl('select', { attr: { 'aria-label': 'Operator' } });
    for (const [v, t] of operators ? [['eq', 'is'], ['in', 'is any of'], ['exists', 'exists']] : [['eq', 'is'], ['exists', 'exists']]) op.createEl('option', { value: v, text: t });
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
    const d = this.settings.declaration, row = host.createDiv({ cls: 'graph-ng-row' });
    const select = row.createEl('select', { attr: { 'aria-label': 'Group by' } });
    const options: [string, GroupSource | null][] = [['Declared default', null], ...d.groups.map(g => [groupLabel(g), g] as [string, GroupSource])];
    for (const f of r.facets) if (!d.groups.some(g => g.from === 'key' && g.key === f.key)) options.push([`Property: ${f.key}`, { from: 'key', key: f.key }]);
    for (let depth = 1; depth <= 4; depth++) if (!d.groups.some(g => g.from === 'folder' && g.depth === depth && g.prefix === undefined)) options.push([`Folder depth ${depth}`, { from: 'folder', depth }]);
    options.forEach(([label, g], i) => { const o = select.createEl('option', { value: String(i), text: label }); o.selected = canonical(g) === canonical(this.view.group); });
    if (this.view.group && !options.some(([, g]) => canonical(g) === canonical(this.view.group))) { options.push([groupLabel(this.view.group), this.view.group]); select.createEl('option', { value: String(options.length - 1), text: options.at(-1)![0] }).selected = true; }
    select.onchange = () => this.update({ group: options[Number(select.value)]![1], hiddenGroups: [], collapsedGroups: [] });
    this.derivedForm(host, r);
    this.expressionField(host, r, 'Group expression', 'group', expr => this.update({ group: { from: 'expr', expr }, hiddenGroups: [], collapsedGroups: [] }));
    if (this.view.group && this.view.group.from !== 'expr') { const converted = editAsExpression(this.view.group), edit = host.createEl('button', { text: 'Edit group as expression' }); edit.disabled = !converted.text; edit.title = converted.reason ?? ''; edit.onclick = () => { this.drafts.set('Group expression', converted.text!); this.render(); }; }
    const disabled = this.settings.explore.disabledDerived;
    if (disabled.length) {
      const note = host.createDiv({ cls: 'graph-ng-explore-note graph-ng-disabled-derive', attr: { role: 'status' } });
      note.createSpan({ text: `Disabled: regex-derived groups are no longer supported. Recreate with segment or prefix — ${disabled.map(d => `${d.location}: ${d.key} /${d.pattern}/`).join('; ')}. ` });
      note.createEl('button', { text: 'Dismiss' }).onclick = () => { this.settings.explore.disabledDerived = []; this.host.persist(); this.render(); };
    }
    const nodes = this.host.mode() === 'nodes', actions = host.createDiv({ cls: 'graph-ng-row' });
    const order = Array.from(r.groupKeys.keys()).filter(i => r.groupTotals[i]).sort((a, b) => r.groupTotals[b]! - r.groupTotals[a]! || a - b);
    if (nodes) {
      const all = order.map(i => r.groupKeys[i]!).filter(k => k.length <= VIEW_LIMITS.keyLength), collapse = actions.createEl('button', { text: 'Collapse all' });
      collapse.disabled = all.length > VIEW_LIMITS.keys; if (collapse.disabled) collapse.title = `More than ${VIEW_LIMITS.keys.toLocaleString()} groups; collapse individually`;
      collapse.onclick = () => this.update({ collapsedGroups: all });
      actions.createEl('button', { text: 'Expand all' }).onclick = () => this.update({ collapsedGroups: [] });
    }
    if (this.view.hiddenGroups.length) actions.createEl('button', { text: 'Show all' }).onclick = () => this.update({ hiddenGroups: [] });
    const list = host.createDiv({ cls: 'graph-ng-legend', attr: { role: 'list' } }), hidden = new Set(this.view.hiddenGroups), collapsed = new Set(this.view.collapsedGroups);
    for (const i of order.slice(0, this.groupLimit)) {
      const key = r.groupKeys[i]!, label = r.groupLabels[i]!, item = list.createDiv({ cls: 'graph-ng-legend-row', attr: { role: 'listitem' } });
      const eye = item.createEl('input', { attr: { type: 'checkbox', 'aria-label': `Show ${label}` } }); eye.checked = !hidden.has(key);
      // Persisted keys are capped; an over-long key cannot be hidden or collapsed by name.
      const storable = key.length <= VIEW_LIMITS.keyLength; eye.disabled = !storable && eye.checked;
      eye.onchange = () => this.update({ hiddenGroups: eye.checked ? this.view.hiddenGroups.filter(k => k !== key) : [...this.view.hiddenGroups, key] });
      item.createSpan({ cls: 'graph-ng-swatch' }).style.background = this.host.groupColor(i);
      const name = item.createEl('button', { cls: 'graph-ng-legend-name', text: label, attr: { title: `${label} — ${nodes ? 'frame this group' : 'open members'}` } });
      name.onclick = () => this.host.focusGroup(i);
      countSpan(item, shownHidden(r.groupVisible[i]!, r.groupTotals[i]!));
      if (nodes) {
        const fold = item.createEl('button', { cls: 'graph-ng-fold clickable-icon', text: collapsed.has(key) ? '⊕' : '⊖', attr: { 'data-focus-key': `group-fold:${key}`, 'aria-label': `${collapsed.has(key) ? 'Expand' : 'Collapse'} ${label}`, 'aria-pressed': String(collapsed.has(key)) } }); fold.disabled = !storable && !collapsed.has(key);
        fold.onclick = () => this.update({ collapsedGroups: collapsed.has(key) ? this.view.collapsedGroups.filter(k => k !== key) : [...this.view.collapsedGroups, key] }, collapsed.has(key) ? () => this.host.focusGroup(i) : undefined);
      }
    }
    const notes = nodes ? this.host.carriers() : 0;
    if (notes) panelHelp(host, plural(notes, 'relationship note'), 'Drawn smaller and beneath other notes. Appearance controls their color and visibility when zoomed out.');
    if (order.length > this.groupLimit) host.createEl('button', { text: `Show ${Math.min(this.settings.explore.legendPageSize, order.length - this.groupLimit)} more, ${num(order.length - this.groupLimit)} groups left` }).onclick = () => { this.groupLimit += this.settings.explore.legendPageSize; this.render(); };
  }
  /** Group by a bounded transform of an existing value; no note needs a new property. */
  private derivedForm(host: HTMLElement, r: ExploreResult) {
    const details = host.createEl('details', { cls: 'graph-ng-derived' }); disclosure(details, 'Group by part of a value');
    // Visible labels; the stored transform keeps its 0-based segment index (-1 = last).
    const form = details.createDiv({ cls: 'graph-ng-derive-grid' });
    const field = <K extends 'select' | 'input'>(label: string, tag: K, attr: Record<string, string>) => { const l = form.createEl('label', { cls: 'graph-ng-field' }), caption = l.createSpan({ text: label }); return [l.createEl(tag, { attr: { 'aria-label': label, ...attr } }), caption] as const; };
    const [source] = field('Derive from', 'select', {});
    source.createEl('option', { value: '$identity', text: 'ID' }); source.createEl('option', { value: '$path', text: 'Path' });
    for (const f of r.facets) source.createEl('option', { value: f.key, text: f.key });
    const [kind] = field('Take', 'select', {});
    for (const [v, t] of [['segment', 'One part'], ['prefix', 'First parts']]) kind.createEl('option', { value: v, text: t });
    const [delimiter] = field('Split at', 'input', { type: 'text', value: ':', maxlength: '8' });
    const [n, caption] = field('Part (0 = first, -1 = last)', 'input', { type: 'number', value: '0', min: '-64', max: '63' });
    kind.onchange = () => { const prefix = kind.value === 'prefix', label = prefix ? 'Number of parts' : 'Part (0 = first, -1 = last)'; caption.textContent = label; n.setAttribute('aria-label', label); if (prefix && Number(n.value) < 1) n.value = '1'; };
    const error = details.createDiv({ cls: 'graph-ng-explore-error', attr: { role: 'alert' } });
    form.createEl('button', { text: 'Group', cls: 'graph-ng-add' }).onclick = () => {
      const transform = kind.value === 'prefix' ? { kind: 'prefix' as const, delimiter: delimiter.value, segments: Number(n.value) } : { kind: 'segment' as const, delimiter: delimiter.value, index: Number(n.value) };
      const group: GroupSource = { from: 'derived', key: source.value, transform };
      try { validateDerivedGroup(group); error.textContent = ''; this.update({ group, hiddenGroups: [], collapsedGroups: [] }); } catch (e) { error.textContent = e instanceof Error ? e.message : String(e); }
    };
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
      item.createEl('button', { cls: 'clickable-icon', text: '×', attr: { 'aria-label': `Delete rule ${rule.name}` } }).onclick = () => void this.host.setColors(d.colors.filter((_, j) => j !== i));
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
    }, true, form => {
      name = form.createEl('input', { attr: { type: 'text', placeholder: 'Rule name', 'aria-label': 'Rule name' } });
      color = form.createEl('input', { cls: 'graph-ng-color', attr: { type: 'color', 'aria-label': 'Rule color' } }); color.value = '#e6a23c';
    });
  }
  private edges(host: HTMLElement, r: ExploreResult) {
    const hidden = new Set(this.view.hiddenTypes), list = host.createDiv({ cls: 'graph-ng-legend' });
    r.types.forEach((type, i) => {
      const item = list.createDiv({ cls: 'graph-ng-legend-row' }), eye = item.createEl('input', { attr: { type: 'checkbox', 'aria-label': `Show ${type} relationships` } });
      eye.checked = !hidden.has(type); eye.onchange = () => this.update({ hiddenTypes: eye.checked ? this.view.hiddenTypes.filter(t => t !== type) : [...this.view.hiddenTypes, type] });
      item.createSpan({ cls: 'graph-ng-legend-name', text: type });
      countSpan(item, shownHidden(r.typeVisible[i]!, r.typeTotals[i]!));
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
    const summary = disclosure(box).querySelector('.graph-ng-disclosure-label')!, reason = box.createDiv();
    const update = () => { const reasons = this.host.policy().filter(r => r.includes(effect) || r.includes('software renderer')); box.hidden = !reasons.length; summary.textContent = `${effect[0]!.toUpperCase() + effect.slice(1)} ${reasons.some(r => r.includes('limited')) ? 'limited' : 'turned off'} by the performance guard`; reason.textContent = reasons.join('; '); };
    this.guards.push(update); update();
  }
  private physics(host: HTMLElement) {
    const applied = (): Record<PhysicsKey, string | boolean> => { const l = this.settings.layout; return Object.fromEntries(PHYSICS_FIELDS.map(([key]) => { const v = key === 'iterations' ? l.iterations : l.force[key]; return [key, typeof v === 'boolean' ? v : String(v)]; })) as Record<PhysicsKey, string | boolean>; };
    const draft = this.physicsDraft ??= applied();
    const fill = (values: Required<PhysicsValues>, note: string, name: string) => { this.physicsUndo = { values: { ...draft }, name, applied: false }; for (const [key] of PHYSICS_FIELDS) { const v = values[key]; draft[key] = typeof v === 'boolean' ? v : String(v); } this.physicsError = ''; this.physicsNote = note; this.render(); };
    const size = this.host.result(), recommended = recommendedPhysics(size?.nodes ?? 1000, size?.edges ?? 3000);
    panelHelp(host, 'Layout drafts', 'Changes stay here until Apply and recompute. Fit graph is separate.');
    const presets = settingRow(host, 'Presets', 'graph-ng-presets', 'Groups apart loosens the layout; Fill the screen tightens it. Faster uses fewer steps; presets stay drafts until Apply.').createDiv({ cls: 'graph-ng-setting-line', attr: { role: 'group', 'aria-label': 'Layout presets' } });
    const reset = presets.createEl('button', { text: 'Recommended' });
    reset.disabled = this.physicsBusy;
    reset.onclick = () => fill(recommended, 'Recommended values for this graph loaded.', 'Recommended');
    for (const [name] of PHYSICS_PRESETS) {
      const b = presets.createEl('button', { text: name }); b.disabled = this.physicsBusy;
      b.onclick = () => fill(presetValues(name, recommended), `${name} loaded.`, name);
    }
    const advice = this.host.layoutAdvice?.();
    if (advice) {
      // Keeps every other draft value; only turns Strong gravity on with a measured pull.
      const fix = presets.createEl('button', { text: PULL_IN }); fix.disabled = this.physicsBusy;
      fix.onclick = () => fill({ ...draft, strongGravityMode: true, gravity: advice.gravity } as unknown as Required<PhysicsValues>, `${PULL_IN} loaded. Apply and recompute to see it.`, PULL_IN);
      panelHelp(host, 'Why pull them in?', advice.reason);
    }
    const undo = this.physicsUndo, back =presets.createEl('button', { text: 'Undo preset' });
    back.disabled = this.physicsBusy || !undo;
    back.onclick = () => { if (!undo) return; Object.assign(draft, undo.values); this.physicsUndo = undefined; this.physicsNote = `${undo.name} undone.`; if (undo.applied) void run(); else this.render(); };
    const changes = host.createDiv({ cls: 'graph-ng-layout-changes', attr: { 'aria-live': 'polite' } }), show = (v: string | boolean) => typeof v === 'boolean' ? (v ? 'on' : 'off') : v;
    const summarize = () => {
      const now = applied(), diff = PHYSICS_FIELDS.filter(([key]) => draft[key] !== now[key]); changes.empty();
      if (this.physicsNote) changes.createDiv({ text: this.physicsNote });
      if (!diff.length) changes.createDiv({ text: 'No pending changes.' });
      else {
        const details = changes.createEl('details'); disclosure(details, plural(diff.length, 'pending change'));
        for (const [key, title] of diff) statRow(details, 'minus', title, `${show(now[key])} → ${show(draft[key])}`);
      }
    };
    const basic = host.createDiv(), advanced = host.createEl('details', { cls: 'graph-ng-physics-advanced' });
    disclosure(advanced, 'Advanced layout'); advanced.open = this.physicsAdvanced; advanced.ontoggle = () => { this.physicsAdvanced = advanced.open; };
    for (const [key, title, help, more] of PHYSICS_FIELDS) {
      const parent = more ? advanced : basic, value = draft[key], def = recommended[key];
      if (typeof value === 'boolean') {
        const row = settingRow(parent, title, 'graph-ng-toggle graph-ng-physics-field', help), input = row.querySelector('input')!;
        input.disabled = this.physicsBusy; input.checked = value; input.onchange = () => { draft[key] = input.checked; summarize(); };
      } else progressiveSlider(parent, { label: title, desc: help, curve: PHYSICS_CURVES[key]!, value, def: def as number, disabled: this.physicsBusy, cls: 'graph-ng-physics-field', attr: { step: key === 'iterations' ? '1' : 'any', ...(key === 'gravity' ? { min: '0' } : key === 'iterations' ? { min: '1' } : {}) }, changed: v => { draft[key] = v; summarize(); } });
    }
    summarize();
    host.createDiv({ cls: 'graph-ng-explore-error', text: this.physicsError, attr: { role: 'alert' } });
    const actions = host.createDiv({ cls: 'graph-ng-form' });
    const apply = actions.createEl('button', { text: this.physicsBusy ? 'Recomputing…' : 'Apply and recompute', cls: 'mod-cta' });
    apply.disabled = this.physicsBusy;
    apply.onclick = () => run();
    const run = async () => {
      if (this.physicsBusy || this.disposed) return;
      try {
        const values = Object.fromEntries(PHYSICS_FIELDS.map(([key]) => { const v = draft[key]; return [key, typeof v === 'boolean' ? v : v.trim() ? Number(v) : NaN]; })) as unknown as PhysicsValues;
        physicsSettings(this.settings, values);
        this.physicsBusy = true; this.physicsError = ''; this.physicsNote = ''; this.render();
        await this.host.applyLayout(values);
        if (this.physicsUndo) this.physicsUndo.applied = true;
      } catch (e) { this.physicsError = `Not applied: ${e instanceof Error ? e.message : String(e)}`; }
      finally { this.physicsBusy = false; if (!this.disposed) this.render(); }
    };
  }
  updateLensControl() {
    if (!this.lensButton) return;
    const state = this.host.lens?.();
    this.lensButton.disabled = !state?.available; this.lensButton.setAttribute('aria-pressed', String(!!state?.active));
    this.lensButton.textContent = state?.active ? 'Connection lens: on' : 'Connection lens: off';
  }
  updateSizingReadout() { /* Renderer compatibility: no live sizing paragraph. */ }
  private nodes(host: HTMLElement) {
    const group = host.createDiv({ cls: 'graph-ng-nodes' }); group.createEl('h4', { text: 'Nodes' });
    const current = sizingValues(this.settings);
    const draft = this.sizingDraft ??= { radius: String(current.radius), prominence: String(current.prominence), compensation: String(current.compensation * 100), floor: String(current.floor * 100), curve: current.curve };
    panelHelp(group, 'Sizing drafts', 'Preview is temporary; Apply saves predictable sizing. Restore returns to your saved sizes.');
    const fields: [Exclude<keyof NodeSizingValues, 'curve'>, string, string, Curve][] = [
      ['radius', 'Node size', 'px', { min: .01, max: 20, k: 3 }], ['prominence', 'Hub size limit', '×', { min: 1, max: 9, k: 2 }],
      ['compensation', 'Shrink crowded dots', '%', { min: 0, max: 100 }], ['floor', 'Smallest dot size', '%', { min: .1, max: 100, k: 2 }],
    ];
    const help = { radius: 'Dot radius before zoom and crowding adjustments. Type a larger value for larger dots.', prominence: 'Largest hub radius compared with an unconnected note. 1 keeps dots the same size.', compensation: 'How much crowding shrinks dots, not the space between them. 0 turns shrinking off.', floor: 'Minimum size kept after shrinking, as a percentage of the requested size. Must be greater than 0.' };
    const message = group.createDiv({ cls: 'graph-ng-explore-note', attr: { role: 'status', 'aria-live': 'polite' } }); message.textContent = this.sizingMessage;
    const changed = (key: keyof NodeSizingValues, value: string) => { draft[key] = value; this.sizingPreview = false; this.host.previewSizing?.(null); this.sizingMessage = message.textContent = 'Draft not previewed or saved.'; this.updateSizingReadout(); };
    const curveRow = settingRow(group, 'Size by connections', 'graph-ng-select', 'Chooses how connection counts change dot sizes. Previous keeps the earlier sizing curve.');
    const curve = curveRow.createEl('select', { attr: { 'aria-label': 'Size by connections' } }); curve.disabled = this.sizingBusy;
    for (const [v, t] of [['sqrt', 'Square root'], ['log', 'Logarithmic'], ['linear', 'Linear'], ['legacy', 'Previous']]) curve.createEl('option', { value: v, text: t });
    curve.value = draft.curve; curve.onchange = () => changed('curve', curve.value);
    const base = sizingValues(defaults('links')), initial = { ...base, compensation: base.compensation * 100, floor: base.floor * 100 };
    for (const [key, title, unit, range] of fields) {
      progressiveSlider(group, { label: title, unit, desc: help[key], curve: range, value: draft[key], def: initial[key], disabled: this.sizingBusy, cls: 'graph-ng-sizing-row', attr: { min: key === 'prominence' ? '1' : '0', max: String(key === 'radius' ? MAX_NODE_RADIUS : key === 'prominence' ? 9 : 100) }, changed: value => changed(key, value) });
    }
    const values = () => {
      const parsed = Object.fromEntries(Object.entries(draft).map(([key, value]) => [key, key === 'curve' ? value : value.trim() ? Number(value) : NaN])) as unknown as NodeSizingValues;
      parsed.compensation /= 100; parsed.floor /= 100; sizingSettings(this.settings, parsed); return parsed;
    };
    const actions = group.createDiv({ cls: 'graph-ng-form' });
    const preview = actions.createEl('button', { text: 'Preview sizing' }); preview.disabled = this.sizingBusy || !this.host.previewSizing;
    preview.onclick = () => { try { this.host.previewSizing?.(values()); this.sizingPreview = true; this.sizingMessage = 'Previewing. Not saved.'; } catch (e) { this.host.previewSizing?.(null); this.sizingMessage = `Not previewed: ${String(e)}`; } message.textContent = this.sizingMessage; this.updateSizingReadout(); };
    const apply = actions.createEl('button', { text: this.sizingBusy ? 'Saving…' : 'Apply sizing' }); apply.disabled = this.sizingBusy || !this.host.applySizing;
    apply.onclick = async () => {
      if (this.sizingBusy || this.disposed) return;
      try { const v = values(); this.sizingBusy = true; this.render(); await this.host.applySizing!(v); this.sizingDraft = undefined; this.sizingPreview = false; this.sizingMessage = 'Saved'; }
      catch (e) { this.host.previewSizing?.(null); this.sizingMessage = `Not saved: ${String(e)}. Preview cleared.`; }
      finally { this.sizingBusy = false; if (!this.disposed) this.render(); }
    };
    const cancel = actions.createEl('button', { text: 'Restore sizing' }); cancel.disabled = this.sizingBusy;
    cancel.onclick = () => { this.host.previewSizing?.(null); this.sizingDraft = undefined; this.sizingPreview = false; this.sizingMessage = 'Saved sizing restored'; this.render(); };
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
      const row = box.createDiv({ cls: 'graph-ng-suggestion-row' }), copy = suggestionCopy(item);
      const text = row.createDiv({ cls: 'graph-ng-suggestion' }); text.createDiv({ cls: 'graph-ng-suggestion-name', text: item.label });
      text.createDiv({ text: copy.change }); panelHelp(text, copy.why, item.reason, 'graph-ng-suggestion-why');
      const one = row.createEl('button', { text: 'Apply', attr: { 'aria-label': `Apply ${item.label}` } }); one.disabled = this.suggestBusy || !this.host.applySuggestions; one.onclick = () => apply([item]);
    }
    const actions = box.createDiv({ cls: 'graph-ng-actions' });
    const preview = actions.createEl('button', { text: this.suggestPreview ? 'End preview' : 'Preview' }); preview.disabled = this.suggestBusy || !this.host.previewSuggestions;
    preview.onclick = () => {
      this.suggestPreview = !this.suggestPreview; this.host.previewSuggestions!(this.suggestPreview ? list : null);
      this.suggestMessage = this.suggestPreview ? 'Previewing. Not saved.' : ''; this.render();
    };
    const all = actions.createEl('button', { text: this.suggestBusy ? 'Saving…' : 'Apply all', cls: 'mod-cta' }); all.disabled = this.suggestBusy || !this.host.applySuggestions; all.onclick = () => apply(list);
  }
  private display(host: HTMLElement) {
    const s = this.settings, v = s.visuals;
    type NumericVisual = { [K in keyof Visuals]: Visuals[K] extends number ? K : never }[keyof Visuals];
    const initial = defaultVisuals(), slider = (key: NumericVisual, label: string, curve: Curve, desc?: string) =>
      this.slider(host, label, curve, () => v[key], value => { v[key] = value; }, false, { def: initial[key], desc });
    this.suggested(host);
    this.nodes(host);
    panelHelp(host.createEl('h4'), 'Live appearance', 'These controls save immediately in plugin settings, not saved views. Closing the panel ends any preview.');
    this.slider(host, 'Label density', { min: .25, max: 3, log: true }, () => s.labelDensity, x => { s.labelDensity = x; }, true, { def: 1 });
    this.edgeMode(host);
    const composite = settingRow(host, 'Edge compositing', '', 'Density reduces faint overlap; Blend keeps the original strokes. Canvas uses Blend.').createEl('select', { attr: { 'aria-label': 'Edge compositing' } });
    for (const value of ['blend', 'density'] as const) composite.createEl('option', { text: value === 'blend' ? 'Blend (default)' : 'Density', value });
    composite.value = v.edgeCompositing;
    composite.onchange = () => { v.edgeCompositing = composite.value as Visuals['edgeCompositing']; this.host.visualsChanged(false); };
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
    this.flag(host, 'hoverHighlight', 'Highlight connections: Direct connections are brightest, then neighbours of neighbours; the rest fades. Groups and ancestors must be declared.');
    if (this.host.toggleLens) {
      this.lensButton = host.createEl('button', { cls: 'graph-ng-lens-toggle', attr: { 'aria-label': 'Connection lens', 'aria-pressed': 'false' } });
      this.lensButton.onclick = () => { this.host.toggleLens?.(); this.updateLensControl(); };
      this.updateLensControl(); panelHelp(host, 'About the lens', 'Brings the selected note’s direct connections into rings temporarily. L toggles it; Escape closes it.');
    }
    this.flag(host, 'clickOpens', 'Click to open (skip the connection card)');
    const find = host.createEl('details', { cls: 'graph-ng-highlight-options' }); disclosure(find, 'Finding connections');
    const emphasis = settingRow(find, 'Highlight emphasis', '', 'Adaptive limits growth in large neighbourhoods. Scale keeps the original magnification.').createEl('select', { attr: { 'aria-label': 'Highlight emphasis' } });
    for (const mode of ['adaptive', 'scale'] as const) emphasis.createEl('option', { value: mode, text: mode === 'adaptive' ? 'Adaptive (default)' : 'Scale' }).selected = v.emphasis === mode;
    emphasis.onchange = () => { v.emphasis = emphasis.value as typeof v.emphasis; this.host.visualsChanged(false); };
    this.slider(find, 'Highlighted size target (px)', { min: 0, max: 16, k: 1.5 }, () => v.tierMinSize, x => { v.tierMinSize = x; }, false, { def: initial.tierMinSize, desc: 'Adaptive reduces this target for large neighbourhoods; Scale uses it as a minimum. 0 disables neighbour size targets.' });
    this.flag(find, 'tierRings', 'Connection rings (around the focus and direct connections)');
    this.flag(find, 'focusEdges', 'Strong focus edges (fade the rest)');
    this.flag(find, 'offscreenPips', 'Off-screen arrows (point to direct connections)');
    this.flag(find, 'tierLegend', 'Connection counts (show a legend for each tier)');
    this.flag(find, 'focusRipple', 'Selection ripple');
    this.flag(find, 'bridgesFirst', 'Bridges first: rank connections to other groups higher');
    this.flag(find, 'breadcrumb', 'Visited notes (show a trail along the top)');
    this.flag(find, 'minimap', 'Minimap (hidden under 500 px wide)');
    const labels = settingRow(host, 'Label style', '', 'Anchored names stay one size and point to their dots. Ranked names grow by connection count and fade with zoom.').createEl('select', { attr: { 'aria-label': 'Label style' } });
    for (const [value, text] of [['anchored', 'Anchored'], ['ranked', 'Ranked']]) labels.createEl('option', { value, text });
    labels.value = v.labelStyle ?? 'anchored';
    labels.onchange = () => { v.labelStyle = labels.value as Visuals['labelStyle']; this.host.visualsChanged(true); this.render(); };
    if ((v.labelStyle ?? 'anchored') === 'ranked') {
      this.flag(host, 'labelFade', 'Fade labels (by zoom and importance)', true);
      this.slider(host, 'Label size range', { min: 1, max: 1.6, k: 1.5 }, () => v.labelTierScale, x => { v.labelTierScale = x; }, true, { def: initial.labelTierScale, desc: 'Focus and well-connected notes get larger names. 1 keeps names one size.' });
    }
    this.flag(host, 'labelPlates', 'Label backgrounds');
    this.flag(host, 'zoomAdapt', 'Adapt to zoom: fade crowded edges and shrink hubs when zoomed out');
    if (this.host.setRelationshipDisplay && hasReified(s.declaration)) this.relationshipDisplay(host);
    if (this.host.carriers()) {
      slider('carrierOpacity', 'Relationship-note opacity', { min: 0, max: 1, k: 2 });
      slider('carrierSize', 'Relationship-note size', { min: .001, max: 4, k: 2 });
      this.flag(host, 'carrierTint', 'Endpoint colors (for relationship notes)');
      this.flag(host, 'carrierLod', 'Fold into edges (relationship notes when zoomed out)');
    }
    host.createEl('button', { text: 'Fit graph' }).onclick = () => this.host.fit();
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
  private relationBusy = false;
  private relationMessage = '';
  private relationshipDisplay(host: HTMLElement) {
    const nodes = this.settings.declaration.display.reifiedAsNodes, count = this.host.relationshipNotes?.() ?? 0;
    const row = host.createDiv({ cls: 'graph-ng-row graph-ng-segmented', attr: { role: 'group', 'aria-label': 'Relationship notes' } });
    panelHelp(row, 'Relationship notes', `Lines join the endpoints; Nodes makes each relationship a clickable dot${count ? ` (${plural(count, 'added dot')})` : ''}. Switching saves globally and rebuilds the layout.`);
    for (const [value, text] of [[false, 'Lines'], [true, 'Nodes']] as const) {
      const button = row.createEl('button', { text, attr: { 'aria-pressed': String(nodes === value) } }); button.disabled = this.relationBusy || nodes === value;
      button.onclick = async () => {
        this.relationBusy = true; this.relationMessage = 'Rebuilding graph…'; this.render();
        try { await this.host.setRelationshipDisplay!(value); this.relationMessage = ''; }
        catch (e) { this.relationMessage = `Not switched: ${String(e)}. The displayed graph is unchanged.`; }
        finally { this.relationBusy = false; if (!this.disposed) this.render(); }
      };
    }
    if (this.relationMessage) host.createDiv({ cls: 'graph-ng-explore-note', text: this.relationMessage, attr: { role: 'status' } });
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
          [...this.body.querySelectorAll<HTMLButtonElement>('button')].find(button => !button.disabled)?.focus({ preventScroll: true });
        }
      }
      this.saveFocus = false;
    }
  }
  private viewOpen(host: HTMLElement, saved: SavedView) {
    const issue = this.host.savedViewIssue?.(saved) ?? '';
    if (issue) this.note(host, issue);
    const open = host.createEl('button', { text: 'Open', attr: { 'aria-label': `Open view ${saved.name}` } }); open.disabled = Boolean(issue);
    open.onclick = async () => {
      const request = ++this.openRequest;
      this.viewMessage = `Opening ‘${saved.name}’… Requested view; displayed graph may still show the previous result.`; this.render();
      try { await this.host.openSavedView!(saved); if (request === this.openRequest) this.viewMessage = `Opened ‘${saved.name}’.${saved.camera && this.host.mode() !== 'nodes' ? ' Saved camera applies in Notes.' : ''}`; }
      catch (error) { if (request === this.openRequest) this.viewMessage = `Could not finish opening ‘${saved.name}’: ${String(error)}. Displayed graph may still show the previous result.`; }
      if (!this.disposed) this.render();
    };
  }
  private views(host: HTMLElement) {
    host.createDiv({ text: this.viewMessage, attr: { role: 'status', 'aria-live': 'polite' } });
    this.note(host, 'Views live in plugin settings, not view files. Saves filters, grouping and camera. Appearance, layout, representation and selected-group scope are not included.');
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
          if (!draft.saved.name || draft.saved.name === `${draft.folder} — focus`) draft.saved.name = `${folder!.value} — focus`;
          draft.folder = folder!.value; this.viewCollision = undefined; this.render();
        };
      }
      this.note(host, 'Definition preview');
      try { this.viewDefinition(host, draft.folder === undefined ? draft.saved : folderView(draft.folder, draft.saved.name)); }
      catch (error) { this.note(host, String(error)); }
      this.note(host, 'Uses current appearance, layout and relationship declarations. Replaces current search, filters and hidden-item choices when opened. Matches are checked when opened.');
      const save = host.createEl('button', { text: 'Save view', cls: 'mod-cta' }); save.disabled = this.viewBusy;
      save.onclick = () => {
        const target = this.settings.explore.savedViews.find(v => v.name === draft.saved.name.trim());
        if (target) { this.viewCollision = structuredClone(target); this.render(); } else void this.saveViewDraft(null);
      };
      if (this.viewCollision) {
        this.note(host, `A view named ‘${this.viewCollision.name}’ already exists.`);
        const expected = this.viewCollision;
        const replace = host.createEl('button', { text: 'Replace existing view' }); replace.disabled = this.viewBusy; replace.onclick = () => { void this.saveViewDraft(expected); };
        const keep = host.createEl('button', { text: 'Keep editing' }); keep.disabled = this.viewBusy; keep.onclick = () => { this.viewCollision = undefined; this.render(); };
      }
      const cancel = host.createEl('button', { text: 'Cancel' }); cancel.disabled = this.viewBusy; cancel.onclick = back;
      return;
    }
    if (this.viewSaved) { this.viewOpen(host, this.viewSaved); host.createEl('button', { text: 'Back to views' }).onclick = back; return; }
    const s = this.settings;
    if (!s.explore.savedViews.length) this.note(host, 'No saved views here yet. Start below, or save the view you are exploring.');
    for (const saved of s.explore.savedViews) {
      const item = host.createDiv({ cls: 'graph-ng-saved-record' });
      item.createEl('strong', { cls: 'graph-ng-saved-name', text: saved.name }); this.viewDefinition(item, saved);
      const actions = item.createDiv({ cls: 'graph-ng-row' });
      this.viewOpen(actions, saved);
      const remove = actions.createEl('button', { text: 'Delete', attr: { 'aria-label': `Delete view ${saved.name}` } }); remove.disabled = this.viewBusy;
      remove.onclick = async () => {
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
    const current = host.createEl('button', { text: 'Save current view…' }); current.disabled = this.viewBusy; current.onclick = () => prepare();
    host.createEl('h4', { text: 'Starting points' });
    this.note(host, 'Focus on a folder — explore one area using the current graph’s relationships.');
    const start = host.createEl('button', { text: 'Prepare', attr: { 'aria-label': 'Prepare Focus on a folder' } }); start.disabled = this.viewBusy; start.onclick = () => prepare('');
  }
}
