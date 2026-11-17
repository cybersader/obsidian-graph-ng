import { workingText } from './working';
import { setIcon } from 'obsidian';
import { disclosure, disclosureBody, panelHelp, iconButton } from './panel-help';
import type { EdgeRuleCounts, LayoutResult } from './pipeline';
import type { ExploreResult } from './core/explore';
import { filterSummary, hiddenClause } from './filter-summary';
import type { Predicate } from './core/declaration';
/** Structured Graph information for one projected generation. Rendering only; no graph state. */
export interface InformationReport {
  nodes: number; edges: number; listed: number;
  linksPending: boolean; provisional: boolean; unresolved: number; duplicates: number;
  layout?: { cached: boolean; reused?: LayoutResult['reused']; ms: number; totalMs: number };
  progress?: { iteration: number; total: number };
  pendingProperties?: number;
  dropped?: Record<string, EdgeRuleCounts>;
  /** The first relationships with a missing target: rule, source path, target reference. */
  missed?: string[][];
  /** Markdown notes in the vault, and per declared excluded folder the notes under it. */
  vault?: number; excluded?: [string, number][];
  /** Rows the projection read (kept plus duplicate-ID), and the relationship notes per reified rule. */
  rows?: number; ruleNotes?: Record<string, number>;
  /** Relationship notes are drawn as notes (dots), not lines. */
  relationshipNodes?: boolean;
  /** Declared edge rule names, in declaration order. */
  rules?: string[];
}
type Explored = Pick<ExploreResult, 'visible' | 'matched' | 'nodes' | 'filters' | 'filterHidden' | 'queryHidden' | 'visibleEdges' | 'ruleVisible' | 'carrierHidden' | 'edgeHidden'> & Partial<Pick<ExploreResult, 'types' | 'typeTotals' | 'typeVisible'>>;
/** One breakdown row. `go` leads to its cause: filter `go`'s chip (past the last chip: the Filters panel), -1 the search box, -2 relationship display controls. */
export interface Part { icon: string; label: string; count: number; lines?: boolean; go?: number }
/** Breakdown actions: switch relationship notes between lines and notes, remove one filter, or open Filters at one (negative: search). */
export interface InformationActions { relationships?(): void; display?(nodes: boolean): void | Promise<void>; remove?(filter: number): void; filter?(at: number): void; duplicates?(): void; exclusions?(): void }
/** Every markdown note in the vault, in exactly one part; the parts sum to `total`. `hidden` are notes the view hides. */
export interface Accounting { total: number; dots: number; lines: number; hidden: number; parts: Part[]; complete: boolean }
/** Shared count text: locale digits, a counted noun, a total, and one tabular count element. */
export const num = (v: number) => v.toLocaleString();
export const plural = (v: number, one: string, many = `${one}s`) => `${num(v)} ${v === 1 ? one : many}`;
export const sum = (a: ArrayLike<number>) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i]!; return s; };
export const countSpan = (host: HTMLElement, v: number | string, title?: string) => host.createSpan({ cls: 'graph-ng-count', text: typeof v === 'number' ? num(v) : v, attr: title ? { title } : {} });
/** A view result for another projection is ignored. */
const current = (r: InformationReport, e?: Explored) => e?.nodes === r.nodes ? e : undefined;
const parted = (parts: Part[]) => (icon: string, label: string, count = 0, go?: number, lines?: boolean) => { if (count) parts.push({ icon, label, count, go, lines }); };
/** What a filter hides, after "Hidden ": "by filter: kind exists", "by filter: outside folder A". */
const by = (f: Predicate) => `by filter: ${hiddenClause(f).text.replace(/^where /, '')}`;
export function accounting(r: InformationReport, view?: Explored): Accounting {
  const parts: Part[] = [], add = parted(parts);
  const e = current(r, view), dots = e ? sum(e.visible) : r.nodes;
  add('circle-dot', 'Shown as dots', dots);
  if (!r.relationshipNodes) for (const [rule, count] of Object.entries(r.ruleNotes ?? {})) add('spline', `Drawn as ${rule} lines`, count, undefined, true);
  if (e) {
    e.filters.forEach((f, i) => add('filter', `Hidden ${by(f)}`, e.filterHidden[i], i));
    add('search', 'Hidden by search', e.queryHidden, -1); add('eye-off', 'In hidden groups or colors', e.matched - dots, e.filters.length);
  }
  for (const [folder, count] of r.excluded ?? []) add('folder-x', `In excluded folder ${folder}`, count);
  add('copy', 'Duplicate IDs, left out', r.duplicates);
  const loading = Math.max(0, r.listed - (r.rows ?? r.listed)); add('loader', 'Still loading', loading);
  const total = r.vault ?? sum(parts.map(p => p.count)), changed = total - sum(parts.map(p => p.count));
  add('refresh-cw', changed > 0 ? 'Added since the last refresh' : 'Removed since the last refresh', changed);
  return { total, dots, lines: e?.visibleEdges ?? r.edges, hidden: r.nodes - dots, parts, complete: !r.provisional && !loading && !changed };
}
/** Every edge found, in exactly one part: drawn, or not drawn for its first reason. The parts sum to `total`. */
export function edgeAccounting(r: InformationReport, view?: Explored) {
  const parts: Part[] = [], add = parted(parts), e = current(r, view), h = e?.edgeHidden ?? [], f = e?.filters.length ?? 0, drops = Object.values(r.dropped ?? {});
  const drawn = e ? e.visibleEdges : r.edges, dropped = (k: 'missing' | 'excluded' | 'lines') => sum(drops.map(c => c[k]));
  e?.filters.forEach((x, i) => add('filter', `Endpoint hidden ${by(x)}`, h[i], i));
  add('search', 'Endpoint hidden by search', h[f], -1); add('eye-off', 'Endpoint in a hidden group or color', h[f + 1], f);
  add('eye-off', 'Relationship type hidden', h[f + 2], f); add('group', 'Inside a collapsed group', h[f + 3], f);
  add('unlink', 'Target note missing', dropped('missing')); add('copy', 'Endpoint has a duplicate ID', dropped('excluded'));
  add('spline', 'Endpoint is a relationship note drawn as a line', dropped('lines'), -2);
  return { drawn, parts, total: drawn + sum(parts.map(p => p.count)) };
}
/** One icon, label and right-aligned tabular number; a button when it leads somewhere. */
export function statRow(host: HTMLElement, icon: string, label: string, value: string, cls = '', click?: () => void) {
  const row = host.createEl(click ? 'button' : 'div', { cls: `graph-ng-stat ${click ? 'graph-ng-stat-nav' : ''} ${cls}` }); if (click) row.onclick = click;
  setIcon(row.createSpan({ cls: 'graph-ng-stat-icon' }), icon);
  row.createSpan({ cls: 'graph-ng-stat-label', text: label }); countSpan(row, value);
  if (click) setIcon(row.createSpan({ cls: 'graph-ng-stat-icon' }), 'chevron-right');
  return row;
}
/** The always-visible canvas readout: notes shown, then the notes the view hides, else the edges drawn. */
export function renderReadout(host: HTMLElement, a: Accounting) {
  const open = host.onclick;
  host.onclick = event => { open?.call(host, event); revealInformation(host.closest('.graph-ng-view') ?? host, 'edges'); };
  for (const [icon, text] of [['circle-dot', plural(a.dots, 'note')], a.hidden ? ['eye-off', `${num(a.hidden)} hidden`] : ['spline', plural(a.lines, 'edge')]]) { const chip = host.createSpan({ cls: 'graph-ng-readout' }); setIcon(chip.createSpan({ cls: 'graph-ng-stat-icon' }), icon!); countSpan(chip, text!); }
}
/** All reason rows navigate; only explicitly named action buttons change settings. */
function partRows(host: HTMLElement, parts: Part[], r: InformationReport, act: InformationActions) {
  for (const p of parts) {
    const go = p.go, list = p.icon === 'unlink' && r.missed?.length ? host.createEl('details', { cls: 'graph-ng-stat-list' }) : undefined;
    if (list) list.dataset.info = 'missing';
    const click = go === undefined ? p.lines ? act.relationships : p.icon === 'copy' ? act.duplicates : p.icon === 'folder-x' ? act.exclusions : undefined : go < -1 ? act.relationships : act.filter && (() => act.filter!(go));
    statRow(list ? disclosure(list) : host, p.icon, p.icon === 'unlink' && r.linksPending ? 'Target checks pending' : p.label, (p.count < 0 ? '−' : '') + num(Math.abs(p.count)), '', click);
    const body = list ? disclosureBody(list) : undefined;
    for (const [rule, from, to] of list ? r.missed! : []) body!.createDiv({ cls: 'graph-ng-stat-sub', text: `${from} → ${to} (${rule})` });
    if (body && p.count > r.missed!.length) body.createDiv({ cls: 'graph-ng-stat-sub', text: `First ${r.missed!.length} listed` });
  }
}
function revealInformation(host: HTMLElement, id: string) {
  const details = Array.from(host.querySelectorAll<HTMLDetailsElement>('details'));
  for (const el of details) if (el.dataset.info === 'edges' || el.dataset.info === id) el.open = true;
  const target = details.find(el => el.dataset.info === id) ?? details.find(el => el.dataset.info === 'edges');
  target?.querySelector('summary')?.focus(); target?.scrollIntoView({ block: 'nearest' });
}
const informationState = new WeakMap<HTMLElement, Map<string, boolean>>();
const pendingHelp = (host: HTMLElement) => panelHelp(host, 'Source checks pending', 'Provisional: targets may resolve as properties and Obsidian links load.');
/** Preserve semantic disclosures, focus, open help and scroll through asynchronous updates. */
export function renderInformation(host: HTMLElement, message: string, state: string | undefined, r?: InformationReport, view?: Explored, act: InformationActions = {}, loading?: { indexed?: number; listed?: number }) {
  const opened = informationState.get(host) ?? new Map<string, boolean>(); informationState.set(host, opened);
  const controls = () => Array.from(host.querySelectorAll<HTMLElement>('button, summary'));
  const key = (el: HTMLElement) => (el.tagName === 'SUMMARY' ? el.parentElement?.dataset.info : undefined) ?? el.getAttribute('aria-label') ?? el.querySelector('.graph-ng-stat-label')?.textContent ?? el.textContent ?? '';
  const active = host.ownerDocument?.activeElement as HTMLElement | null, focused = active && host.contains(active) ? key(active) : undefined, scroll = host.scrollTop;
  const tips = controls().filter(el => el.getAttribute('aria-describedby') && !el.parentElement!.querySelector<HTMLElement>('.graph-ng-help-popover')!.hidden).map(key);
  host.querySelectorAll<HTMLDetailsElement>('details').forEach(el => { if (el.dataset.info) opened.set(el.dataset.info, el.open); });
  const progress = message ? host.querySelector<HTMLElement>('.graph-ng-status-message') : null;
  for (const child of Array.from(host.children)) if (child !== progress) child.remove();
  renderBody(host, message, state, r, view, act, loading, progress);
  host.querySelectorAll<HTMLDetailsElement>('details').forEach(el => { el.open = opened.get(el.dataset.info!) ?? false; });
  const next = controls();
  if (focused !== undefined) { const target = next.find(el => key(el) === focused) ?? host; target.tabIndex = target === host ? -1 : target.tabIndex; target.focus({ preventScroll: true }); }
  for (const el of next) if (!host.hidden && tips.includes(key(el))) el.dispatchEvent(new Event('pointerenter'));
  host.scrollTop = scroll;
}
function renderBody(host: HTMLElement, message: string, state: string | undefined, r: InformationReport | undefined, view: Explored | undefined, act: InformationActions, loading?: { indexed?: number; listed?: number }, progress?: HTMLElement | null) {
  if (message) { const label = progress ?? host.createDiv({ cls: 'graph-ng-status-message' }); label.toggleClass('graph-ng-explore-error', state === 'error'); workingText(label, message, state === 'building'); }
  if (state === 'building' || r?.provisional) {
    if (!message) host.createDiv({ cls: 'graph-ng-coverage-state', attr: { role: 'status' }, text: r?.provisional ? pendingText(r) : 'Counts available when the graph is ready' });
    if (loading?.indexed !== undefined && loading.listed !== undefined) {
      statRow(host, 'files', 'Notes read', num(loading.indexed)); statRow(host, 'loader', 'Notes pending', num(Math.max(0, loading.listed - loading.indexed)));
    }
    statRow(host, 'timer', 'Layout', r?.layout ? layoutText(r.layout) : r?.progress ? `Step ${num(r.progress.iteration)} (${num(r.progress.total)} steps planned)` : 'Preparing graph');
    if (r) statRow(host, 'spline', 'Relationship notes', r.relationshipNodes ? 'Notes' : 'Lines');
    pendingHelp(host);
    return;
  }
  if (!r) return;
  const e = current(r, view), a = accounting(r, e), edges = edgeAccounting(r, e), unread = a.parts.find(p => p.icon === 'loader');
  host.createDiv({ cls: 'graph-ng-coverage-state', attr: { role: 'status' }, text: a.complete ? e?.carrierHidden?.some(Boolean) ? 'Relationship notes are filtered' : r.linksPending ? 'Source checks pending' : r.duplicates || r.unresolved ? 'Source issues need attention' : a.hidden || edges.total !== edges.drawn ? 'Ready with hidden items' : 'All notes accounted for' : unread ? `Still loading: ${plural(unread.count, 'note')} left to read` : 'Vault changed since the last refresh' });
  const headline = host.createDiv({ cls: 'graph-ng-stats graph-ng-answer' });
  statRow(headline, 'circle-dot', 'Notes shown', num(a.dots)); statRow(headline, 'spline', 'Edges drawn', num(edges.drawn), '', () => revealInformation(host, 'edges'));
  const section = (id: string, icon: string, label: string, value: string, cls = '') => {
    const details = host.createEl('details', { cls: `graph-ng-info-section ${cls}` }); details.dataset.info = id;
    statRow(disclosure(details), icon, label, value); return disclosureBody(details);
  };
  e?.carrierHidden?.forEach((hidden, i) => {
    if (!hidden) return;
    const f = e.filters[i]!, name = `“${filterSummary(f).text}” filter`, row = host.createDiv({ cls: 'graph-ng-stat graph-ng-stat-warning' });
    const tip = panelHelp(row, '', `Hidden ${hiddenClause(f).text}. Other filters and hidden groups still apply after removal.`, 'graph-ng-stat-icon');
    const help = tip.parentElement!.querySelector('button')!; help.setAttribute('aria-label', `About ${name}`); setIcon(help, 'filter');
    const edit = row.createEl(act.filter ? 'button' : 'span', { cls: 'graph-ng-stat-label', text: 'Filtered relationship notes', attr: { 'aria-label': `Edit ${name}` } });
    edit.onclick = () => act.filter?.(i); countSpan(row, hidden);
    if (act.remove) { const remove = iconButton(row, `Remove ${name}`, 'x', 'clickable-icon graph-ng-stat-remove'); remove.onclick = () => act.remove!(i); }
  });
  if (r.duplicates) statRow(host, 'copy', 'Inspect duplicate IDs', num(r.duplicates), '', act.duplicates);
  if (r.unresolved) statRow(host, 'unlink', r.linksPending ? 'Inspect pending targets' : 'Inspect missing targets', num(r.unresolved), '', () => revealInformation(host, 'missing'));
  if (r.linksPending) pendingHelp(host);
  else if (!r.duplicates && !r.unresolved) statRow(host, 'check', 'Source checks', 'No issues found');
  const notes = section('notes', 'files', 'Note accounting', num(a.total), 'graph-ng-coverage');
  partRows(notes, a.parts, r, act); statRow(notes, 'files', 'Markdown notes in vault', num(a.total), 'graph-ng-stat-total');
  const lines = section('edges', 'spline', 'Edge accounting', num(edges.total));
  statRow(lines, 'spline', 'Edges drawn', num(edges.drawn));
  e?.types?.forEach((type, i) => {
    const drawn = e.typeVisible![i]!, hidden = e.typeTotals![i]! - drawn;
    statRow(lines, 'spline', `${type} edges drawn`, num(drawn), 'graph-ng-stat-sub');
    if (hidden) statRow(lines, 'eye-off', `${type}: hidden by view`, num(hidden), 'graph-ng-stat-sub', act.filter && (() => act.filter!(e.filters.length)));
  });
  partRows(lines, edges.parts, r, act); statRow(lines, 'sigma', 'Edges found', num(edges.total), 'graph-ng-stat-total');
  if (Object.keys(r.ruleNotes ?? {}).length) {
    const nodes = !!r.relationshipNodes, display = section('display', 'spline', 'Relationship display', nodes ? 'Notes' : 'Lines');
    for (const [rule, count] of Object.entries(r.ruleNotes!)) statRow(display, nodes ? 'circle-dot' : 'spline', `${rule} relationship notes`, num(count));
    if (act.display) {
      const button = display.createEl('button', { text: `Show relationships as ${nodes ? 'lines' : 'notes'} (save and rebuild)` });
      button.onclick = async () => { button.disabled = true; try { await act.display!(!nodes); } finally { button.disabled = false; } };
    }
    panelHelp(display, 'Lines / Notes', 'Lines join endpoints; Notes draw dots. Changing display saves and rebuilds; filters stay active.');
  }
  const layout = section('layout', 'timer', 'Layout', r.layout?.cached || r.layout?.reused ? 'Reused' : r.layout ? 'Computed' : 'Pending');
  layout.createDiv({ text: r.layout ? layoutText(r.layout) : r.progress ? layoutProgress(r.progress) : 'Waiting for graph' });
}
/** Whether the drawn positions came from the saved layout, and how long any computation took. */
export function layoutText(l: NonNullable<InformationReport['layout']>) {
  const s = `${(Math.max(l.ms, 50) / 1000).toFixed(1)} s`;
  const source = l.reused?.startsWith('interim') ? 'Reused provisional layout' : 'Reused saved layout';
  return l.cached || l.reused === 'all' || l.reused === 'interim' ? source : l.reused ? `${source}, adjusted in ${s}` : `Computed layout in ${s}`;
}

/** Stage-local progress only: no elapsed-time estimate and no invented resolver percentage. */
export const readingProgress = (c: { indexed: number; listed: number }) => `Reading notes ${Math.floor(100 * c.indexed / Math.max(1, c.listed))}%`;
export const layoutProgress = (p: { iteration: number; total: number }) => `Laying out ${Math.floor(100 * p.iteration / Math.max(1, p.total))}% (step ${num(p.iteration)}, ${num(p.total)} steps)`;
export const pendingText = (r?: { pendingProperties?: number; linksPending: boolean }) => `Ready, still reading ${r?.pendingProperties ? plural(r.pendingProperties, 'note') : r?.linksPending ? 'links' : 'properties'}`;
