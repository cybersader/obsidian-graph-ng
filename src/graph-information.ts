import type { EdgeRuleCounts } from './pipeline';
/** Structured Graph information for one projected generation. Rendering only; no graph state. */
export interface InformationReport {
  nodes: number; edges: number; indexed: number; listed: number;
  linksPending: boolean; provisional: boolean; unresolved: number; duplicates: number;
  layout?: { cached: boolean; ms: number; totalMs: number };
  dropped?: Record<string, EdgeRuleCounts>;
}
const n = (v: number) => v.toLocaleString();
const plural = (v: number, one: string, many = `${one}s`) => `${n(v)} ${v === 1 ? one : many}`;
/** Plain-English issues, most consequential first. Each is a title plus an explanation. */
export function informationIssues(r: InformationReport): [string, string][] {
  const issues: [string, string][] = [];
  if (r.provisional) issues.push(['Partial graph', 'Properties or links are still loading; filters and members may change.']);
  if (r.linksPending) issues.push(['Links pending', 'Link targets are still being resolved.']);
  if (r.duplicates) issues.push([`${plural(r.duplicates, 'note')} ${r.duplicates === 1 ? 'shares' : 'share'} an ID and ${r.duplicates === 1 ? 'is' : 'are'} excluded`, 'Give each note a unique ID to include it.']);
  if (r.unresolved) issues.push([plural(r.unresolved, 'unresolved link'), 'Their target notes do not exist, so they are not drawn.']);
  return issues;
}
/** Short health phrases for the canvas summary chip; empty when healthy. */
export const informationAlerts = (r: InformationReport | undefined) => r ? [r.provisional ? 'Partial graph, still loading' : '', r.unresolved ? plural(r.unresolved, 'unresolved link') : '', r.duplicates ? `${plural(r.duplicates, 'duplicate-ID note')} excluded` : ''].filter(Boolean) : [];
export function renderInformation(host: HTMLElement, message: string, state: string | undefined, r?: InformationReport) {
  host.empty();
  if (message) host.createEl('p', { cls: state === 'error' ? 'graph-ng-status-message graph-ng-explore-error' : 'graph-ng-status-message', text: message });
  if (!r) return;
  const tiles = host.createDiv({ cls: 'graph-ng-stats' });
  const tile = (label: string, value: string, detail = '') => { const t = tiles.createDiv({ cls: 'graph-ng-stat' }); t.createDiv({ cls: 'graph-ng-stat-label', text: label }); t.createDiv({ cls: 'graph-ng-stat-value', text: value }); if (detail) t.createDiv({ cls: 'graph-ng-stat-total', text: detail }); };
  tile('Nodes', n(r.nodes)); tile('Edges', n(r.edges));
  tile('Properties loaded', `${n(r.indexed)} of ${n(r.listed)}`, r.provisional ? 'Still loading' : 'Verified');
  tile('Layout', r.layout ? (r.layout.cached ? 'Cached' : `${n(Math.round(r.layout.ms))} ms`) : 'Building…', r.layout ? `Total ${n(Math.round(r.layout.totalMs))} ms` : '');
  const issues = informationIssues(r);
  host.createEl('h4', { text: 'Issues' });
  if (!issues.length) host.createDiv({ cls: 'graph-ng-explore-note', text: 'No issues found.' });
  else { const list = host.createEl('ul', { cls: 'graph-ng-issues' }); for (const [title, why] of issues) { const item = list.createEl('li'); item.createEl('strong', { text: title }); item.createDiv({ text: why }); } }
  const rules = Object.entries(r.dropped ?? {});
  if (!rules.length) return;
  host.createEl('h4', { text: 'Relationships by rule' });
  const table = host.createEl('table', { cls: 'graph-ng-rules' }), head = table.createEl('thead').createEl('tr');
  for (const [text, title] of [['Rule', 'Edge rule'], ['Drawn', 'Drawn'], ['Missing', 'Target note missing'], ['Dup. ID', 'Endpoint has a duplicate ID'], ['Notes out', 'Relationship notes excluded']] as [string, string][]) head.createEl('th', { text, attr: { scope: 'col', title } });
  const body = table.createEl('tbody');
  for (const [rule, c] of rules) { const row = body.createEl('tr'); row.createEl('th', { text: rule, attr: { scope: 'row' } }); for (const v of [c.drawn, c.missing, c.excluded, c.carriers]) row.createEl('td', { text: n(v) }); }
}
