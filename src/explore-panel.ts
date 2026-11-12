import { editAsExpression, builderPredicate, checked } from './core/expr/engine';
import { validate } from './core/expr/syntax';
import { suggestions } from './core/expr/autocomplete';
import { declaredKeys } from './core/columns';
import { describePredicate, groupLabel, NO_COLOR, VIEW_LIMITS, validateSaved, validateView, type ExploreResult, type ExploreView, type SavedView, type ViewCamera } from './core/explore';
import { canonical, validateDerivedGroup, validatePredicate, type GraphDeclaration, type GroupSource, type Predicate, type Scalar } from './core/declaration';
import type { Settings, Visuals } from './settings';
/** The view owns the worker, renderer and persistence; the panel only edits state. */
export interface PanelHost {
  settings(): Settings;
  preview(expr: string, context: 'filter' | 'group'): Promise<{ matched: number; total: number; groups?: number }>;
  result(): ExploreResult | undefined;
  mode(): string;
  policy(): string[];
  /** Edge notes (reified edges drawn as nodes) in the detail view; 0 otherwise. */
  carriers(): number;
  setView(view: ExploreView, after?: () => void): void;
  setColors(colors: GraphDeclaration['colors']): Promise<void>;
  visualsChanged(labels: boolean): void;
  groupColor(code: number): string;
  focusGroup(code: number): void;
  fit(): void;
  camera(): ViewCamera | null;
  restoreCamera(camera: ViewCamera): void;
  persist(): void;
}
type Section = 'filters' | 'groups' | 'colors' | 'edges' | 'display' | 'views';
const SECTIONS: [Section, string][] = [['filters', 'Filters'], ['groups', 'Groups'], ['colors', 'Color rules'], ['edges', 'Relationships'], ['display', 'Display'], ['views', 'Saved views']];
let expressionPanelId = 0;
const parseRaw = (raw: string): Scalar => { try { const v: unknown = JSON.parse(raw); return v === null || ['string', 'number', 'boolean'].includes(typeof v) ? v as Scalar : raw; } catch { return raw; } };
/** Collapsible in-view controls styled only with host CSS variables. */
export class ExplorePanel {
  readonly root: HTMLElement;
  private expressionPanelId = ++expressionPanelId;
  private drafts = new Map<string, string>();
  private expressionTimers = new Set<ReturnType<typeof setTimeout>>();
  private counts: HTMLElement;
  private search: HTMLInputElement;
  private body: HTMLElement;
  private alert: HTMLElement;
  private open = new Set<Section>(['filters', 'groups']);
  private groupLimit: number;
  private searchTimer: ReturnType<typeof setTimeout> | undefined;
  constructor(parent: HTMLElement, private host: PanelHost, private view: ExploreView) {
    const s = host.settings();
    this.groupLimit = s.explore.legendPageSize;
    this.root = parent.createDiv({ cls: 'graph-ng-explore', attr: { role: 'region', 'aria-label': 'Graph controls' } });
    const head = this.root.createDiv({ cls: 'graph-ng-explore-head' });
    const toggle = head.createEl('button', { cls: 'graph-ng-explore-toggle clickable-icon', attr: { 'aria-label': 'Toggle graph controls', 'aria-expanded': String(s.explore.panelOpen) }, text: s.explore.panelOpen ? '▾ Explore' : '▸ Explore' });
    toggle.onclick = () => { const st = this.host.settings(); st.explore.panelOpen = !st.explore.panelOpen; this.host.persist(); this.layout(); };
    this.counts = head.createDiv({ cls: 'graph-ng-explore-counts', attr: { role: 'status', 'aria-live': 'polite' } });
    this.search = this.root.createEl('input', { cls: 'graph-ng-explore-search', attr: { type: 'search', placeholder: 'Search notes…', 'aria-label': 'Search note names and identities', spellcheck: 'false' } });
    this.search.maxLength = VIEW_LIMITS.query; this.search.value = view.query;
    this.alert = this.root.createDiv({ cls: 'graph-ng-explore-error', attr: { role: 'alert' } });
    this.search.oninput = () => { clearTimeout(this.searchTimer); this.searchTimer = setTimeout(() => this.update({ query: this.search.value }), 160); };
    this.body = this.root.createDiv({ cls: 'graph-ng-explore-body' });
    this.layout();
  }
  dispose() { this.expressionTimers.forEach(clearTimeout); clearTimeout(this.searchTimer); this.root.remove(); }
  setState(view: ExploreView) { this.view = view; if (document.activeElement !== this.search) this.search.value = view.query; this.render(); }
  /** A view that would fail settings validation is never applied or persisted. */
  private update(patch: Partial<ExploreView>, after?: () => void) {
    const next = { ...this.view, ...patch };
    try { validateView(next); } catch (e) { this.alert.textContent = `Not applied: ${e instanceof Error ? e.message : String(e)}`; return; }
    this.alert.textContent = ''; this.view = next; this.host.setView(this.view, after); this.render();
  }
  private layout() {
    const open = this.host.settings().explore.panelOpen, toggle = this.root.querySelector('.graph-ng-explore-toggle')!;
    this.root.toggleClass('is-collapsed', !open); toggle.setAttribute('aria-expanded', String(open)); toggle.textContent = open ? '▾ Explore' : '▸ Explore';
    this.search.hidden = this.body.hidden = !open; this.render();
  }
  render() {
    const external = Boolean(this.host.settings().projectionFile), r = external ? undefined : this.host.result();
    this.counts.textContent = external ? 'External aggregate' : r ? `${r.visible.reduce((n, v) => n + v, 0).toLocaleString()} of ${r.nodes.toLocaleString()} nodes · ${r.visibleEdges.toLocaleString()} of ${r.edges.toLocaleString()} edges` : 'Waiting for projection…';
    if (this.body.hidden) return;
    // Re-render rebuilds controls; keep keyboard focus on the same control (by accessible name).
    const active = document.activeElement instanceof HTMLElement && this.body.contains(document.activeElement) ? document.activeElement : null;
    const selection = active instanceof HTMLInputElement ? [active.selectionStart, active.selectionEnd] as const : undefined;
    const focusName = active ? `${active.tagName}|${active.getAttribute('aria-label') ?? active.textContent}` : '';
    this.expressionTimers.forEach(clearTimeout); this.expressionTimers.clear();
    const scroll = this.body.scrollTop; this.body.empty();
    for (const [id, title] of SECTIONS) {
      const details = this.body.createEl('details', { cls: `graph-ng-explore-section graph-ng-explore-${id}` });
      details.open = this.open.has(id); details.ontoggle = () => { if (details.open) this.open.add(id); else this.open.delete(id); };
      details.createEl('summary', { text: title });
      const content = details.createDiv();
      if (!r && id !== 'display' && id !== 'views') { content.createDiv({ cls: 'graph-ng-explore-note', text: external ? 'Unavailable for an external aggregate; it has no note rows to filter or regroup.' : 'Available after the projection is built.' }); continue; }
      if (id === 'display') this.display(content); else if (id === 'views') this.views(content);
      else if (id === 'filters') this.filters(content, r!); else if (id === 'groups') this.groups(content, r!); else if (id === 'colors') this.colors(content, r!); else this.edges(content, r!);
    }
    this.body.scrollTop = scroll;
    if (focusName) { const replacement = [...this.body.querySelectorAll<HTMLElement>('button,input,select,summary')].find(e => `${e.tagName}|${e.getAttribute('aria-label') ?? e.textContent}` === focusName); replacement?.focus(); if (replacement instanceof HTMLInputElement && selection && replacement.type === 'text') replacement.setSelectionRange(selection[0], selection[1]); }
  }
  /** One bounded text editor serves filters, colours and custom group values. */
  private expressionField(host: HTMLElement, r: ExploreResult, label: string, context: 'filter' | 'group', submit: (expr: string) => void) {
    const details = host.createEl('details', { cls: 'graph-ng-expression' }); details.open = this.drafts.has(label);
    details.createEl('summary', { text: label });
    const input = details.createEl('input', { attr: { type: 'text', 'aria-label': label, placeholder: context === 'filter' ? 'note.status == "open"' : 'note.category', spellcheck: 'false' } });
    input.value = this.drafts.get(label) ?? '';
    const completions = details.createEl('datalist'), id = `graph-ng-expr-${this.expressionPanelId}-${label.split(' ').join('-')}`; completions.id = id; input.setAttribute('list', id);
    const feedback = details.createEl('pre', { cls: 'graph-ng-expression-status', attr: { role: 'status', 'aria-live': 'polite' } });
    const apply = details.createEl('button', { text: context === 'group' ? 'Group by expression' : 'Apply expression', cls: 'mod-cta' });
    const sync = () => {
      this.drafts.set(label, input.value);
      completions.empty(); for (const value of suggestions(input.value.slice(0, input.selectionStart ?? input.value.length), [...declaredKeys(this.host.settings().declaration), ...r.facets.map(f => f.key)])) completions.createEl('option', { value });
      const result = validate(input.value, context); apply.disabled = !result.ok; feedback.toggleClass('graph-ng-explore-error', !result.ok);
      if (!result.ok) { const error = result.errors[0]!; feedback.textContent = `At ${error.pos + 1}: ${error.message}\n${' '.repeat(Math.min(error.pos, 80))}^`; return; }
      const shape = context === 'filter' ? builderPredicate(result.ast) : undefined;
      feedback.textContent = shape ? `Builder: ${describePredicate(shape)} · counting…` : 'Custom expression · counting…';
      const source = input.value, timer = setTimeout(() => {
        this.expressionTimers.delete(timer);
        void this.host.preview(source, context).then(count => {
          if (input.isConnected && source === input.value) feedback.textContent = `${count.matched.toLocaleString()} / ${count.total.toLocaleString()} matched${count.groups === undefined ? '' : ` · ${count.groups.toLocaleString()} groups`}`;
        }).catch(e => { if (input.isConnected && source === input.value) feedback.textContent = String(e).includes('generation changed') ? 'Projection changed; edit to refresh count' : `Preview: ${String(e)}`; });
      }, 150); this.expressionTimers.add(timer);
    };
    let pending: ReturnType<typeof setTimeout> | undefined;
    input.oninput = () => { if (pending) { clearTimeout(pending); this.expressionTimers.delete(pending); } const before = new Set(this.expressionTimers); sync(); pending = [...this.expressionTimers].find(t => !before.has(t)); };
    apply.onclick = () => { try { const ast = checked(input.value, context); const source = editAsExpression(context === 'filter' ? { kind: 'expr', expr: input.value } : { from: 'expr', expr: input.value }); if (!source.text) throw new Error(source.reason); submit(source.text); } catch (e) { feedback.textContent = String(e); } };
    if (input.value) sync(); else apply.disabled = true;
  }
  private filters(host: HTMLElement, r: ExploreResult) {
    const chips = host.createDiv({ cls: 'graph-ng-chips' });
    this.view.filters.forEach((f, i) => {
      const chip = chips.createEl('button', { cls: 'graph-ng-chip', text: `${describePredicate(f)} ×`, attr: { 'aria-label': `Remove filter ${describePredicate(f)}` } });
      chip.onclick = () => this.update({ filters: this.view.filters.filter((_, j) => j !== i) });
      const converted = editAsExpression(f), edit = chips.createEl('button', { text: 'Edit as expression', attr: { 'aria-label': `Edit filter ${i + 1} as expression` } });
      edit.disabled = !converted.text; if (converted.reason) edit.title = converted.reason;
      edit.onclick = () => { this.drafts.set(`Edit filter ${i + 1}`, converted.text!); this.render(); };
      if (this.drafts.has(`Edit filter ${i + 1}`)) this.expressionField(host, r, `Edit filter ${i + 1}`, 'filter', expr => { this.drafts.delete(`Edit filter ${i + 1}`); this.update({ filters: this.view.filters.map((p, j) => j === i ? { kind: 'expr', expr } : p) }); });
      if (f.kind !== 'expr') {
        const builder = host.createEl('details'); builder.createEl('summary', { text: `Edit builder filter ${i + 1}` });
        const input = builder.createEl('textarea', { attr: { 'aria-label': `Builder filter ${i + 1}` } }); input.value = JSON.stringify(f, null, 2);
        const error = builder.createDiv({ attr: { role: 'alert' } });
        builder.createEl('button', { text: 'Save builder entry' }).onclick = () => { try { const value: unknown = JSON.parse(input.value); validatePredicate(value); this.update({ filters: this.view.filters.map((p, j) => j === i ? value : p) }); } catch (e) { error.textContent = String(e); } };
      }
    });
    if (!this.view.filters.length) chips.createSpan({ cls: 'graph-ng-explore-note', text: 'No property filters. Filters combine with AND.' });
    this.predicateForm(host, r, 'Add filter', p => this.update({ filters: [...this.view.filters, p] }), true);
  }
  /** Property choices are exactly the materialized declared columns, plus folder prefixes. */
  private predicateForm(host: HTMLElement, r: ExploreResult, action: string, submit: (p: Predicate) => void, operators: boolean, extra?: (row: HTMLElement) => void) {
    const form = host.createDiv({ cls: 'graph-ng-form' }); extra?.(form);
    const property = form.createEl('select', { attr: { 'aria-label': 'Property' } });
    for (const f of r.facets) property.createEl('option', { value: `k:${f.key}`, text: f.key });
    property.createEl('option', { value: 'folder', text: 'Folder' });
    const op = form.createEl('select', { attr: { 'aria-label': 'Operator' } });
    for (const [v, t] of operators ? [['eq', 'is'], ['in', 'is any of'], ['exists', 'exists']] : [['eq', 'is'], ['exists', 'exists']]) op.createEl('option', { value: v, text: t });
    const values = form.createEl('select', { attr: { 'aria-label': 'Value' } }), folder = form.createEl('input', { attr: { type: 'text', placeholder: 'Folder/Subfolder', 'aria-label': 'Folder prefix' } });
    const sync = () => {
      const isFolder = property.value === 'folder'; op.hidden = isFolder; folder.hidden = !isFolder;
      values.hidden = isFolder || op.value === 'exists'; values.multiple = op.value === 'in'; values.size = op.value === 'in' ? 5 : 1; values.empty();
      const facet = r.facets.find(f => `k:${f.key}` === property.value);
      for (const v of facet?.values ?? []) values.createEl('option', { value: v.raw, text: `${v.label} (${v.count.toLocaleString()})` });
      if (facet && facet.distinct > facet.values.length) values.createEl('option', { text: `… ${facet.distinct - facet.values.length} more (raise facetValues)`, attr: { disabled: 'true' } });
    };
    property.onchange = op.onchange = sync; sync();
    const add = form.createEl('button', { text: action, cls: 'mod-cta' }), error = form.createDiv({ cls: 'graph-ng-explore-error', attr: { role: 'alert' } });
    add.onclick = () => {
      try {
        const key = property.value.slice(2); let p: Predicate;
        if (property.value === 'folder') p = { kind: 'folder', prefix: folder.value.trim().replace(/^\/+|\/+$/g, '').split('/').filter(Boolean) };
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
    const d = this.host.settings().declaration, row = host.createDiv({ cls: 'graph-ng-row' });
    const select = row.createEl('select', { attr: { 'aria-label': 'Group by' } });
    const options: [string, GroupSource | null][] = [['Declared default', null], ...d.groups.map(g => [groupLabel(g), g] as [string, GroupSource])];
    for (const f of r.facets) if (!d.groups.some(g => g.from === 'key' && g.key === f.key)) options.push([`Property: ${f.key}`, { from: 'key', key: f.key }]);
    for (let depth = 1; depth <= 4; depth++) if (!d.groups.some(g => g.from === 'folder' && g.depth === depth && g.prefix === undefined)) options.push([`Folder depth ${depth}`, { from: 'folder', depth }]);
    options.forEach(([label, g], i) => { const o = select.createEl('option', { value: String(i), text: label }); o.selected = canonical(g) === canonical(this.view.group); });
    if ((this.view.group?.from === 'derived' || this.view.group?.from === 'expr') && !options.some(([, g]) => canonical(g) === canonical(this.view.group))) { options.push([groupLabel(this.view.group), this.view.group]); select.createEl('option', { value: String(options.length - 1), text: options.at(-1)![0] }).selected = true; }
    select.onchange = () => this.update({ group: options[Number(select.value)]![1], hiddenGroups: [], collapsedGroups: [] });
    this.derivedForm(host, r);
    this.expressionField(host, r, 'Group expression', 'group', expr => this.update({ group: { from: 'expr', expr }, hiddenGroups: [], collapsedGroups: [] }));
    if (this.view.group && this.view.group.from !== 'expr') { const converted = editAsExpression(this.view.group), edit = host.createEl('button', { text: 'Edit group as expression' }); edit.disabled = !converted.text; edit.title = converted.reason ?? ''; edit.onclick = () => { this.drafts.set('Group expression', converted.text!); this.render(); }; }
    const disabled = this.host.settings().explore.disabledDerived;
    if (disabled.length) {
      const note = host.createDiv({ cls: 'graph-ng-explore-note graph-ng-disabled-derive', attr: { role: 'status' } });
      note.createSpan({ text: `Disabled: regex-derived groups are no longer supported. Recreate with segment or prefix — ${disabled.map(d => `${d.location}: ${d.key} /${d.pattern}/`).join('; ')}. ` });
      note.createEl('button', { text: 'Dismiss' }).onclick = () => { this.host.settings().explore.disabledDerived = []; this.host.persist(); this.render(); };
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
      item.createSpan({ cls: 'graph-ng-legend-count', text: r.groupVisible[i] === r.groupTotals[i] ? r.groupTotals[i]!.toLocaleString() : `${r.groupVisible[i]!.toLocaleString()}/${r.groupTotals[i]!.toLocaleString()}` });
      if (nodes) {
        const fold = item.createEl('button', { cls: 'graph-ng-fold clickable-icon', text: collapsed.has(key) ? '⊕' : '⊖', attr: { 'aria-label': `${collapsed.has(key) ? 'Expand' : 'Collapse'} ${label}`, 'aria-pressed': String(collapsed.has(key)) } }); fold.disabled = !storable && !collapsed.has(key);
        fold.onclick = () => this.update({ collapsedGroups: collapsed.has(key) ? this.view.collapsedGroups.filter(k => k !== key) : [...this.view.collapsedGroups, key] }, collapsed.has(key) ? () => this.host.focusGroup(i) : undefined);
      }
    }
    const notes = nodes ? this.host.carriers() : 0, v = this.host.settings().visuals;
    if (notes) host.createDiv({ cls: 'graph-ng-explore-note graph-ng-carrier-note', text: `${notes.toLocaleString()} edge notes draw small and beneath${v.carrierTint ? `, in their endpoints' color (bridges: ${v.carrierBridge === 'blend' ? 'blended' : 'source color'}${v.carrierBridgeAccent ? ', accented' : ''})` : ''}.${v.carrierLod ? ' Zoomed out, they fold into their edges.' : ''}` });
    if (order.length > this.groupLimit) host.createEl('button', { text: `Show ${Math.min(this.host.settings().explore.legendPageSize, order.length - this.groupLimit)} more of ${(order.length - this.groupLimit).toLocaleString()}` }).onclick = () => { this.groupLimit += this.host.settings().explore.legendPageSize; this.render(); };
  }
  /** Group by a bounded transform of an existing value; no note needs a new property. */
  private derivedForm(host: HTMLElement, r: ExploreResult) {
    const details = host.createEl('details', { cls: 'graph-ng-derived' }); details.createEl('summary', { text: 'Derive groups from a value…' });
    const form = details.createDiv({ cls: 'graph-ng-form' }), source = form.createEl('select', { attr: { 'aria-label': 'Derive from' } });
    source.createEl('option', { value: '$identity', text: 'Identity' }); source.createEl('option', { value: '$path', text: 'Path' });
    for (const f of r.facets) source.createEl('option', { value: f.key, text: f.key });
    const kind = form.createEl('select', { attr: { 'aria-label': 'Transform' } });
    for (const [v, t] of [['segment', 'Segment N'], ['prefix', 'First N segments']]) kind.createEl('option', { value: v, text: t });
    const delimiter = form.createEl('input', { attr: { type: 'text', value: ':', maxlength: '8', 'aria-label': 'Delimiter' } }), n = form.createEl('input', { attr: { type: 'number', value: '0', min: '-64', max: '63', 'aria-label': 'N' } });
    kind.onchange = () => { if (kind.value === 'prefix' && Number(n.value) < 1) n.value = '1'; };
    const error = details.createDiv({ cls: 'graph-ng-explore-error', attr: { role: 'alert' } });
    form.createEl('button', { text: 'Group', cls: 'mod-cta' }).onclick = () => {
      const transform = kind.value === 'prefix' ? { kind: 'prefix' as const, delimiter: delimiter.value, segments: Number(n.value) } : { kind: 'segment' as const, delimiter: delimiter.value, index: Number(n.value) };
      const group: GroupSource = { from: 'derived', key: source.value, transform };
      try { validateDerivedGroup(group); error.textContent = ''; this.update({ group, hiddenGroups: [], collapsedGroups: [] }); } catch (e) { error.textContent = e instanceof Error ? e.message : String(e); }
    };
  }
  private colors(host: HTMLElement, r: ExploreResult) {
    const d = this.host.settings().declaration, hidden = new Set(this.view.hiddenColors), list = host.createDiv({ cls: 'graph-ng-legend' });
    const toggle = (name: string, on: boolean) => this.update({ hiddenColors: on ? this.view.hiddenColors.filter(n => n !== name) : [...this.view.hiddenColors, name] });
    d.colors.forEach((rule, i) => {
      const item = list.createDiv({ cls: 'graph-ng-legend-row' }), eye = item.createEl('input', { attr: { type: 'checkbox', 'aria-label': `Show ${rule.name}` } });
      eye.checked = !hidden.has(rule.name); eye.onchange = () => toggle(rule.name, eye.checked);
      if (/^#[0-9a-f]{6}$/i.test(rule.color)) {
        const swatch = item.createEl('input', { cls: 'graph-ng-color', attr: { type: 'color', 'aria-label': `Color for ${rule.name}` } }); swatch.value = rule.color;
        swatch.onchange = () => void this.host.setColors(d.colors.map((c, j) => j === i ? { ...c, color: swatch.value } : c));
      } else item.createSpan({ cls: 'graph-ng-swatch', attr: { title: rule.color } }).style.background = rule.color;
      item.createSpan({ cls: 'graph-ng-legend-name', text: rule.name, attr: { title: describePredicate(rule.predicate) } });
      item.createSpan({ cls: 'graph-ng-legend-count', text: r.colorCounts[i]!.toLocaleString() });
      const up = item.createEl('button', { cls: 'clickable-icon', text: '↑', attr: { 'aria-label': `Move ${rule.name} earlier (first match wins)` } }); up.disabled = i === 0;
      up.onclick = () => { const next = d.colors.slice(); [next[i - 1], next[i]] = [next[i]!, next[i - 1]!]; void this.host.setColors(next); };
      item.createEl('button', { cls: 'clickable-icon', text: '×', attr: { 'aria-label': `Delete rule ${rule.name}` } }).onclick = () => void this.host.setColors(d.colors.filter((_, j) => j !== i));
    });
    const rest = list.createDiv({ cls: 'graph-ng-legend-row' }), eye = rest.createEl('input', { attr: { type: 'checkbox', 'aria-label': 'Show notes matching no rule' } });
    eye.checked = !hidden.has(NO_COLOR); eye.onchange = () => toggle(NO_COLOR, eye.checked);
    rest.createSpan({ cls: 'graph-ng-legend-name', text: this.host.settings().visuals.autoPalette ? 'No rule (group colors)' : 'No rule' });
    rest.createSpan({ cls: 'graph-ng-legend-count', text: r.colorCounts[d.colors.length]!.toLocaleString() });
    host.createDiv({ cls: 'graph-ng-explore-note', text: 'Rules are ordered; the first match colors a note. Changes never relayout.' });
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
      item.createSpan({ cls: 'graph-ng-legend-count', text: `${r.typeVisible[i]!.toLocaleString()}/${r.typeTotals[i]!.toLocaleString()}` });
    });
    if (!r.types.length) list.createDiv({ cls: 'graph-ng-explore-note', text: 'No relationships in this projection.' });
    this.flag(host, 'edgeDirection', 'Show direction (fade from source to target)');
  }
  private flag(host: HTMLElement, key: { [K in keyof Visuals]: Visuals[K] extends boolean ? K : never }[keyof Visuals], label: string, labels = false) {
    const row = host.createEl('label', { cls: 'graph-ng-row' }), box = row.createEl('input', { attr: { type: 'checkbox' } });
    box.checked = this.host.settings().visuals[key]; row.createSpan({ text: label });
    box.onchange = () => { this.host.settings().visuals[key] = box.checked; this.host.visualsChanged(labels); };
  }
  private slider(host: HTMLElement, label: string, min: number, max: number, step: number, get: () => number, set: (v: number) => void, labels = false) {
    const row = host.createEl('label', { cls: 'graph-ng-slider' }); row.createSpan({ text: label });
    const input = row.createEl('input', { attr: { type: 'range', min: String(min), max: String(max), step: String(step) } }), value = row.createSpan({ cls: 'graph-ng-legend-count' });
    input.value = String(get()); value.textContent = input.value;
    input.oninput = () => { set(Number(input.value)); value.textContent = input.value; this.host.visualsChanged(false); };
    if (labels) input.onchange = () => this.host.visualsChanged(true);
  }
  private display(host: HTMLElement) {
    const s = this.host.settings(), v = s.visuals;
    this.slider(host, 'Node size', 1, 10, .5, () => s.nodeSize, x => { s.nodeSize = x; });
    this.slider(host, 'Size by degree', 0, 4, .1, () => v.degreeSizing, x => { v.degreeSizing = x; });
    this.slider(host, 'Label density', .25, 3, .25, () => s.labelDensity, x => { s.labelDensity = x; }, true);
    this.slider(host, 'Edge opacity', 0, 1, .05, () => v.edgeOpacity, x => { v.edgeOpacity = x; });
    this.slider(host, 'Edge color blend', 0, 1, .05, () => v.edgeColorMix, x => { v.edgeColorMix = x; });
    this.slider(host, 'Glow', 0, 1, .05, () => v.glow, x => { v.glow = x; });
    this.slider(host, 'Curvature', 0, .5, .02, () => v.curvature, x => { v.curvature = x; });
    this.flag(host, 'curvedEdges', 'Curved edges');
    this.flag(host, 'groupHalos', 'Group halos at mid zoom');
    this.flag(host, 'autoPalette', 'Color by group when no rule matches');
    this.flag(host, 'hoverHighlight', 'Highlight neighbors on hover');
    this.flag(host, 'labelFade', 'Fade labels by zoom and importance', true);
    if (this.host.carriers()) {
      this.slider(host, 'Edge-note opacity', 0, 1, .05, () => v.carrierOpacity, x => { v.carrierOpacity = x; });
      this.slider(host, 'Edge-note size', .2, 2, .1, () => v.carrierSize, x => { v.carrierSize = x; });
      this.flag(host, 'carrierTint', 'Color edge notes by their endpoints');
      this.flag(host, 'carrierLod', 'Fold edge notes into edges when zoomed out');
    }
    for (const reason of this.host.policy()) host.createDiv({ cls: 'graph-ng-explore-note', text: `Performance guard: ${reason}.` });
    host.createEl('button', { text: 'Fit graph' }).onclick = () => this.host.fit();
  }
  private views(host: HTMLElement) {
    const s = this.host.settings(), form = host.createDiv({ cls: 'graph-ng-form' });
    const name = form.createEl('input', { attr: { type: 'text', placeholder: 'View name', 'aria-label': 'Saved view name', maxlength: String(VIEW_LIMITS.viewName) } }), error = host.createDiv({ cls: 'graph-ng-explore-error', attr: { role: 'alert' } });
    const save = form.createEl('button', { text: 'Save view', cls: 'mod-cta' });
    if (s.explore.savedViews.length >= VIEW_LIMITS.savedViews) host.createDiv({ cls: 'graph-ng-explore-note', text: `${VIEW_LIMITS.savedViews} saved views is the limit; delete one or reuse a name to replace it.` });
    save.onclick = () => {
      const label = name.value.trim(); if (!label) { error.textContent = 'Name the view'; return; }
      const saved: SavedView = { name: label, view: structuredClone(this.view), camera: this.host.camera() }, next = [...s.explore.savedViews.filter(v => v.name !== label), saved];
      try { validateSaved(next); } catch (e) { error.textContent = e instanceof Error ? e.message : String(e); return; }
      s.explore.savedViews = next; this.host.persist(); this.render();
    };
    for (const saved of s.explore.savedViews) {
      const item = host.createDiv({ cls: 'graph-ng-legend-row' });
      item.createSpan({ cls: 'graph-ng-legend-name', text: saved.name, attr: { title: `${saved.view.filters.length} filters${saved.view.group ? ` · ${groupLabel(saved.view.group)}` : ''}${saved.camera ? ' · camera' : ''}` } });
      item.createEl('button', { text: 'Apply', attr: { 'aria-label': `Apply view ${saved.name}` } }).onclick = () => { this.update(structuredClone(saved.view), saved.camera ? () => this.host.restoreCamera(saved.camera!) : undefined); this.search.value = saved.view.query; };
      item.createEl('button', { cls: 'clickable-icon', text: '×', attr: { 'aria-label': `Delete view ${saved.name}` } }).onclick = () => { s.explore.savedViews = s.explore.savedViews.filter(v => v !== saved); this.host.persist(); this.render(); };
    }
  }
}
