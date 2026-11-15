import { setIcon } from 'obsidian';
import type { EdgeRuleCounts } from './pipeline';
import type { ExploreResult } from './core/explore';
import { filterSummary, hiddenClause } from './filter-summary';
/** Structured Graph information for one projected generation. Rendering only; no graph state. */
export interface InformationReport {
  nodes: number; edges: number; listed: number;
  linksPending: boolean; provisional: boolean; unresolved: number; duplicates: number;
  layout?: { cached: boolean; ms: number; totalMs: number };
  dropped?: Record<string, EdgeRuleCounts>;
  /** Markdown notes in the vault, and per declared excluded folder the notes under it. */
  vault?: number; excluded?: [string, number][];
  /** Rows the projection read (kept plus duplicate-ID), and the relationship notes per reified rule. */
  rows?: number; ruleNotes?: Record<string, number>;
  /** Relationship notes are drawn as notes (dots), not lines. */
  relationshipNodes?: boolean;
  /** Declared edge rule names, in declaration order. */
  rules?: string[];
}
type Explored = Pick<ExploreResult, 'visible' | 'matched' | 'nodes' | 'filters' | 'filterHidden' | 'queryHidden' | 'visibleEdges' | 'ruleVisible' | 'carrierHidden'>;
export interface Part { icon: string; label: string; count: number; lines?: boolean }
/** Breakdown actions: switch relationship notes between lines and notes, or remove one filter. */
export interface InformationActions { display?(nodes: boolean): void; remove?(filter: number): void }
/** Every markdown note in the vault, in exactly one part; the parts sum to `total`. */
export interface Accounting { total: number; dots: number; lines: number; parts: Part[]; complete: boolean }
/** Shared count text: locale digits, a counted noun, a total, and one tabular count element. */
export const num = (v: number) => v.toLocaleString(), n = num;
export const plural = (v: number, one: string, many = `${one}s`) => `${n(v)} ${v === 1 ? one : many}`;
export const sum = (a: ArrayLike<number>) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i]!; return s; };
export const countSpan = (host: HTMLElement, v: number | string, title?: string) => host.createSpan({ cls: 'graph-ng-count', text: typeof v === 'number' ? n(v) : v, attr: title ? { title } : {} });
/** A view result for another projection is ignored. */
const current = (r: InformationReport, e?: Explored) => e?.nodes === r.nodes ? e : undefined;
export function accounting(r: InformationReport, view?: Explored): Accounting {
  const parts: Part[] = [], add = (icon: string, label: string, count: number, lines?: boolean) => { if (count) parts.push({ icon, label, count, lines }); };
  const e = current(r, view), dots = e ? sum(e.visible) : r.nodes;
  add('circle-dot', 'Shown as dots', dots);
  if (!r.relationshipNodes) for (const [rule, count] of Object.entries(r.ruleNotes ?? {})) add('spline', `Drawn as ${rule} lines`, count, true);
  if (e) {
    e.filters.forEach((f, i) => add('filter', `Hidden ${hiddenClause(f).text}`, e.filterHidden[i] ?? 0));
    add('search', 'Hidden by search', e.queryHidden); add('eye-off', 'In hidden groups or colors', e.matched - dots);
  }
  for (const [folder, count] of r.excluded ?? []) add('folder-x', `In excluded folder ${folder}`, count);
  add('copy', 'Duplicate IDs, left out', r.duplicates);
  const loading = Math.max(0, r.listed - (r.rows ?? r.listed)); add('loader', 'Still loading', loading);
  const total = r.vault ?? sum(parts.map(p => p.count)), changed = total - sum(parts.map(p => p.count));
  add('refresh-cw', changed > 0 ? 'Added since the last refresh' : 'Removed since the last refresh', changed);
  return { total, dots, lines: e?.visibleEdges ?? r.edges, parts, complete: !r.provisional && !loading && !changed };
}
/** Issues the breakdown does not already show (loading and duplicate IDs are rows there). Title plus explanation. */
export function informationIssues(r: InformationReport): [string, string][] {
  const issues: [string, string][] = [];
  if (r.linksPending) issues.push(['Links pending', 'Link targets are still being resolved.']);
  if (r.unresolved) issues.push([plural(r.unresolved, 'unresolved link'), 'Their target notes do not exist, so they are not drawn.']);
  return issues;
}
/** One icon, label and right-aligned tabular number. */
export function statRow(host: HTMLElement, icon: string, label: string, value: string, cls = '') {
  const row = host.createDiv({ cls: `graph-ng-stat ${cls}` });
  setIcon(row.createSpan({ cls: 'graph-ng-stat-icon' }), icon);
  row.createSpan({ cls: 'graph-ng-stat-label', text: label }); countSpan(row, value);
  return row;
}
/** The always-visible canvas readout: dots, lines and the vault total, plus a loading state. */
export function renderReadout(host: HTMLElement, a: Accounting) {
  for (const [icon, text] of [['circle-dot', plural(a.dots, 'note')], ['spline', plural(a.lines, 'line')]]) { const chip = host.createSpan({ cls: 'graph-ng-readout' }); setIcon(chip.createSpan({ cls: 'graph-ng-stat-icon' }), icon!); countSpan(chip, text!); }
  host.createSpan({ cls: 'graph-ng-readout graph-ng-count', text: `of ${n(a.total)} in vault` });
}
/** The Lines/Notes switch for relationship notes, then each filter that hides (or would hide) them, with its remove button. */
function relationshipActions(host: HTMLElement, r: InformationReport, e: Explored | undefined, act: InformationActions) {
  const nodes = !!r.relationshipNodes, row = host.createDiv({ cls: 'graph-ng-stat-sub graph-ng-stat-actions' });
  if (act.display) row.createEl('button', { text: nodes ? 'Show as lines' : 'Show as notes' }).onclick = () => act.display!(!nodes);
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
  host.createDiv({ cls: 'graph-ng-coverage-state', attr: { role: 'status' }, text: a.complete ? 'All notes accounted for' : loading ? `Still loading: ${n(r.rows ?? 0)} of ${n(r.listed)} notes read` : r.provisional ? 'Still loading properties and links' : 'Vault changed since the last refresh' });
  const notes = host.createDiv({ cls: 'graph-ng-stats graph-ng-coverage' });
  let acted = false;
  for (const p of a.parts) {
    statRow(notes, p.icon, p.label, (p.count < 0 ? '−' : '') + n(Math.abs(p.count)));
    if (p.icon === 'copy') notes.createDiv({ cls: 'graph-ng-stat-sub', text: 'These notes share an ID with another note. Give each note a unique ID to include it.' });
    if (p.lines && !acted) { acted = true; relationshipActions(notes, r, e, act); }
  }
  statRow(notes, 'files', 'Markdown notes in vault', n(a.total), 'graph-ng-stat-total');
  const carriers = Object.entries(r.ruleNotes ?? {});
  if (r.relationshipNodes && carriers.length) {
    host.createEl('h4', { text: 'Relationship notes' });
    const list = host.createDiv({ cls: 'graph-ng-stats' });
    for (const [rule, count] of carriers) statRow(list, 'circle-dot', `${rule} notes, drawn as dots`, n(count));
    relationshipActions(list, r, e, act);
  }
  host.createEl('h4', { text: 'Lines' });
  const lines = host.createDiv({ cls: 'graph-ng-stats' });
  statRow(lines, 'spline', 'Lines drawn', n(a.lines), 'graph-ng-stat-total');
  (r.rules ?? []).forEach((rule, i) => {
    const c = r.dropped?.[rule];
    if (e?.ruleVisible[i]) statRow(lines, 'spline', `${rule} lines`, n(e.ruleVisible[i]!));
    if (c?.missing) statRow(lines, 'unlink', `${rule}: target note missing`, n(c.missing), 'graph-ng-stat-sub');
    if (c?.excluded) statRow(lines, 'copy', `${rule}: endpoint has a duplicate ID`, n(c.excluded), 'graph-ng-stat-sub');
  });
  statRow(lines, 'timer', 'Layout', r.layout ? (r.layout.cached ? 'Cached' : `${n(Math.round(r.layout.ms))} ms`) : 'Building…');
  const issues = informationIssues(r);
  host.createEl('h4', { text: 'Issues' });
  if (!issues.length) host.createDiv({ cls: 'graph-ng-explore-note', text: 'No issues found.' });
  else { const list = host.createEl('ul', { cls: 'graph-ng-issues' }); for (const [title, why] of issues) { const item = list.createEl('li'); item.createEl('strong', { text: title }); item.createDiv({ text: why }); } }
}
