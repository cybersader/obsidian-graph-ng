import { setIcon } from 'obsidian';
import { disclosure, panelHelp } from './panel-help';
import type { EdgeRuleCounts } from './pipeline';
import type { ExploreResult } from './core/explore';
import { filterSummary, hiddenClause } from './filter-summary';
import type { Predicate } from './core/declaration';
/** Structured Graph information for one projected generation. Rendering only; no graph state. */
export interface InformationReport {
  nodes: number; edges: number; listed: number;
  linksPending: boolean; provisional: boolean; unresolved: number; duplicates: number;
  layout?: { cached: boolean; reused?: 'all' | 'some'; ms: number; totalMs: number };
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
type Explored = Pick<ExploreResult, 'visible' | 'matched' | 'nodes' | 'filters' | 'filterHidden' | 'queryHidden' | 'visibleEdges' | 'ruleVisible' | 'carrierHidden' | 'edgeHidden'>;
/** One breakdown row. `go` leads to its cause: filter `go`'s chip (past the last chip: the Filters panel), -1 the search box, -2 relationship notes as nodes. */
export interface Part { icon: string; label: string; count: number; lines?: boolean; go?: number }
/** Breakdown actions: switch relationship notes between lines and notes, remove one filter, or open Filters at one (negative: search). */
export interface InformationActions { display?(nodes: boolean): void; remove?(filter: number): void; filter?(at: number): void }
/** Every markdown note in the vault, in exactly one part; the parts sum to `total`. `hidden` are notes the view hides. */
export interface Accounting { total: number; dots: number; lines: number; hidden: number; parts: Part[]; complete: boolean }
/** Shared count text: locale digits, a counted noun, a total, and one tabular count element. */
export const num = (v: number) => v.toLocaleString(), n = num;
export const plural = (v: number, one: string, many = `${one}s`) => `${n(v)} ${v === 1 ? one : many}`;
/** A count, or the shown part and the hidden rest when they differ. */
export const shownHidden = (v: number, total: number) => v === total ? n(v) : `${n(v)} shown, ${n(total - v)} hidden`;
export const sum = (a: ArrayLike<number>) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i]!; return s; };
export const countSpan = (host: HTMLElement, v: number | string, title?: string) => host.createSpan({ cls: 'graph-ng-count', text: typeof v === 'number' ? n(v) : v, attr: title ? { title } : {} });
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
  const row = host.createEl(click ? 'button' : 'div', { cls: `graph-ng-stat ${cls}` }); if (click) row.onclick = click;
  setIcon(row.createSpan({ cls: 'graph-ng-stat-icon' }), icon);
  row.createSpan({ cls: 'graph-ng-stat-label', text: label }); countSpan(row, value);
  return row;
}
/** The always-visible canvas readout: notes shown, then the notes the view hides, else the edges drawn. */
export function renderReadout(host: HTMLElement, a: Accounting) {
  for (const [icon, text] of [['circle-dot', plural(a.dots, 'note')], a.hidden ? ['eye-off', `${n(a.hidden)} hidden`] : ['spline', plural(a.lines, 'edge')]]) { const chip = host.createSpan({ cls: 'graph-ng-readout' }); setIcon(chip.createSpan({ cls: 'graph-ng-stat-icon' }), icon!); countSpan(chip, text!); }
}
/** Breakdown rows; each with a cause is a button to it, and missing targets open to the list of them. */
function partRows(host: HTMLElement, parts: Part[], r: InformationReport, act: InformationActions, after?: (p: Part) => void) {
  for (const p of parts) {
    const go = p.go, list = p.icon === 'unlink' && r.missed?.length ? host.createEl('details', { cls: 'graph-ng-stat-list' }) : undefined;
    statRow(list ? disclosure(list) : host, p.icon, p.label, (p.count < 0 ? '−' : '') + n(Math.abs(p.count)), '', go === undefined ? undefined : go < -1 ? act.display && (() => act.display!(true)) : act.filter && (() => act.filter!(go)));
    for (const [rule, from, to] of list ? r.missed! : []) list!.createDiv({ cls: 'graph-ng-stat-sub', text: `${from} → ${to} (${rule})` });
    if (list && p.count > r.missed!.length) list.createDiv({ cls: 'graph-ng-stat-sub', text: `First ${r.missed!.length} listed` });
    after?.(p);
  }
}
/** The Lines/Notes switch for relationship notes, then each filter that hides (or would hide) them, with its remove button. */
function relationshipActions(host: HTMLElement, r: InformationReport, e: Explored | undefined, act: InformationActions) {
  const nodes = !!r.relationshipNodes, row = host.createDiv({ cls: 'graph-ng-stat-sub graph-ng-stat-actions' });
  if (act.display) row.createEl('button', { text: nodes ? 'Show as lines' : 'Show as nodes' }).onclick = () => act.display!(!nodes);
  e?.carrierHidden?.forEach((hidden, i) => {
    if (!hidden) return;
    const warn = host.createDiv({ cls: 'graph-ng-stat-sub graph-ng-stat-warning', attr: { role: 'note' } }), f = e.filters[i]!;
    setIcon(warn.createSpan({ cls: 'graph-ng-stat-icon' }), 'alert-triangle');
    warn.createSpan({ text: `${nodes ? '' : 'As notes, '}${plural(hidden, 'relationship note')} ${nodes ? '' : 'would be '}hidden by filter: ${filterSummary(f).text}` });
    if (act.remove) { const x = warn.createEl('button', { cls: 'clickable-icon graph-ng-chip-action', attr: { 'aria-label': 'Remove filter', title: `Remove filter: ${filterSummary(f).text}` } }); setIcon(x, 'x'); x.onclick = () => act.remove!(i); }
  });
}
export function renderInformation(host: HTMLElement, message: string, state: string | undefined, r?: InformationReport, view?: Explored, act: InformationActions = {}) {
  host.empty();
  if (message) host.createEl('p', { cls: state === 'error' ? 'graph-ng-status-message graph-ng-explore-error' : 'graph-ng-status-message', text: message });
  if (!r) return;
  const e = current(r, view), a = accounting(r, e), loading = a.parts.find(p => p.icon === 'loader');
  host.createDiv({ cls: 'graph-ng-coverage-state', attr: { role: 'status' }, text: a.complete ? 'All notes accounted for' : loading ? `Still loading: ${plural(loading.count, 'note')} left to read` : r.provisional ? 'Still loading properties and links' : 'Vault changed since the last refresh' });
  const notes = host.createDiv({ cls: 'graph-ng-stats graph-ng-coverage' });
  let acted = false;
  partRows(notes, a.parts, r, act, p => {
    if (p.icon === 'copy') panelHelp(notes, 'Resolve duplicate IDs', 'These notes share an ID with another note. Give each note a unique ID to include it.');
    if (p.lines && !acted) { acted = true; relationshipActions(notes, r, e, act); }
  });
  statRow(notes, 'files', 'Markdown notes in vault', n(a.total), 'graph-ng-stat-total');
  const carriers = Object.entries(r.ruleNotes ?? {});
  if (r.relationshipNodes && carriers.length) {
    host.createEl('h4', { text: 'Relationship notes' });
    const list = host.createDiv({ cls: 'graph-ng-stats' });
    for (const [rule, count] of carriers) statRow(list, 'circle-dot', `${rule} notes, drawn as dots`, n(count));
    relationshipActions(list, r, e, act);
  }
  host.createEl('h4', { text: 'Edges' });
  const lines = host.createDiv({ cls: 'graph-ng-stats' }), edges = edgeAccounting(r, e);
  statRow(lines, 'spline', 'Edges drawn', n(edges.drawn));
  (r.rules ?? []).forEach((rule, i) => { if (e?.ruleVisible[i]) statRow(lines, 'spline', `${rule} edges`, n(e.ruleVisible[i]!), 'graph-ng-stat-sub'); });
  partRows(lines, edges.parts, r, act);
  statRow(lines, 'sigma', 'Edges found', n(edges.total), 'graph-ng-stat-total');
  statRow(lines, 'timer', 'Layout', r.layout ? layoutText(r.layout) : 'Building…');
  host.createEl('h4', { text: 'Issues' });
  host.createDiv({ cls: 'graph-ng-explore-note', text: r.linksPending ? 'Links pending: link targets are still being resolved.' : 'No issues found.' });
}
/** Whether the drawn positions came from the saved layout, and how long any computation took. */
export function layoutText(l: NonNullable<InformationReport['layout']>) {
  const s = `${(Math.max(l.ms, 50) / 1000).toFixed(1)} s`;
  return l.cached || l.reused === 'all' ? 'Reused saved layout' : l.reused ? `Reused saved layout, adjusted in ${s}` : `Computed layout in ${s}`;
}
