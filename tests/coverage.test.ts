import { test, expect } from 'bun:test';
import './support/obsidian-fixture';
import { ControlElement } from './support/controls-dom';
import { buildProjection, type FactRow } from '../src/core/projection';
import { carrierHiddenBy, emptyView, explore, hiddenBy, relationshipNotes } from '../src/core/explore';
import type { GraphDeclaration } from '../src/core/declaration';
import { accounting, edgeAccounting, renderInformation, renderReadout, type InformationReport } from '../src/graph-information';
import { hiddenClause, setToggles, toggleable, toggledValues } from '../src/filter-summary';

const d: GraphDeclaration = {
  version: 2, identity: [{ key: 'id' }], display: { reifiedAsNodes: false }, columns: ['kind', 'team'], colors: [],
  edges: [{ name: 'crosswalk', kind: 'reified', sourceProperty: 'from', targetProperty: 'to' }, { name: 'links', kind: 'inline', key: 'refs', type: 'link' }],
  groups: [{ from: 'key', key: 'team' }], exclude: [['_archive'], ['Templates']],
};
/** Synthetic vault where every accounting category is non-zero. */
function vault() {
  const rows: FactRow[] = [], id = (k: number) => k === 3 ? 'o:3' : `n:${k}`;
  // 12 plain notes in teams A/B/C linked in a ring; n0 also links a missing note. Note 3 is named so a search for "n" misses it.
  for (let i = 0; i < 12; i++) rows.push({ path: i === 3 ? 'Notes/other3.md' : `Notes/n${i}.md`, properties: { id: id(i), team: ['A', 'B', 'C'][i % 3], refs: [id((i + 1) % 12), ...(i === 0 ? ['n:missing'] : [])] } });
  // 3 typed notes the room-style filter hides; one is team B, so it is counted once, by the first filter.
  for (let i = 0; i < 3; i++) rows.push({ path: `Sets/s${i}.md`, properties: { id: `s:${i}`, kind: i ? 'set' : 'facet', team: i === 2 ? 'B' : 'A' } });
  // 4 relationship notes drawn as crosswalk lines (they carry a kind too, but are lines, not dots).
  for (let i = 0; i < 4; i++) rows.push({ path: `Edges/e${i}.md`, properties: { id: `e:${i}`, kind: 'edge', from: `n:${i * 2}`, to: `n:${8 + (i % 2) * 2}` } });
  // 2 notes sharing one ID: both left out.
  rows.push({ path: 'Dup/a.md', properties: { id: 'dup' } }, { path: 'Dup/b.md', properties: { id: 'dup' } });
  return rows;
}

test('coverage accounts for every markdown note once, every category non-zero, and the parts sum to the vault total', () => {
  const rows = vault(), p = buildProjection(rows, d);
  const view = { ...emptyView(), filters: [{ kind: 'expr' as const, expr: '!file.hasProperty("kind")' }, { kind: 'expr' as const, expr: 'note.team != "B"' }], query: 'n', hiddenGroups: ['"C"'] };
  const e = explore(p, d, view, new Uint32Array(p.paths.length), 0, { facetValues: 50 });
  // Independent ground truth: notes outside the projection the adapter would report.
  const excluded: [string, number][] = [['_archive', 3], ['Templates', 1]], loading = 2, added = 1, listed = rows.length + loading, total = listed + 4 + added;
  const r: InformationReport = { nodes: p.paths.length, edges: p.source.length, listed, linksPending: false, provisional: true, unresolved: p.unresolved, duplicates: p.quarantined.length,
    dropped: p.dropped, rows: p.carrierPaths.length + p.quarantined.length, ruleNotes: p.ruleNotes, rules: d.edges.map(x => x.name), vault: total, excluded };
  const a = accounting(r, e);
  expect(a.parts.map(x => [x.icon, x.label, x.count])).toEqual([
    ['circle-dot', 'Shown as dots', 3], // n0, n6, n9
    ['spline', 'Drawn as crosswalk lines', 4],
    ['filter', 'Hidden by filter: kind exists', 3],
    ['filter', 'Hidden by filter: team is “B”', 4], // n1, n4, n7, n10; s2 already hidden
    ['search', 'Hidden by search', 1], // other3
    ['eye-off', 'In hidden groups or colors', 4], // n2, n5, n8, n11
    ['folder-x', 'In excluded folder _archive', 3], ['folder-x', 'In excluded folder Templates', 1],
    ['copy', 'Duplicate IDs, left out', 2], ['loader', 'Still loading', loading], ['refresh-cw', 'Added since the last refresh', added],
  ]);
  expect(a.parts.reduce((s, x) => s + x.count, 0)).toBe(total); expect(total).toBe(28);
  expect(a.complete).toBe(false); expect(a.dots).toBe(e.visible.reduce((s, v) => s + v, 0)); expect(a.lines).toBe(e.visibleEdges);
  const host: any = new ControlElement(); renderInformation(host, '', 'ready', r, e);
  expect(host.querySelector('.graph-ng-coverage-state').textContent).toBe('Still loading: 2 notes left to read');
  expect(host.querySelector('.graph-ng-stat-total').textContent).toBe('Markdown notes in vault28');
  // Removed notes are a signed part so the sum still matches.
  const shrunk = accounting({ ...r, vault: total - 3 }, e);
  expect(shrunk.parts.at(-1)).toEqual({ icon: 'refresh-cw', label: 'Removed since the last refresh', count: -2 }); expect(shrunk.parts.reduce((s, x) => s + x.count, 0)).toBe(total - 3);
});

test('a complete, unfiltered graph says all notes are accounted for; lines break down by rule', () => {
  const rows = vault().filter(x => !x.path.startsWith('Dup/')), p = buildProjection(rows, d), e = explore(p, d, emptyView(), new Uint32Array(p.paths.length), 0, { facetValues: 50 });
  const r: InformationReport = { nodes: p.paths.length, edges: p.source.length, listed: rows.length, linksPending: false, provisional: false, unresolved: p.unresolved, duplicates: 0,
    dropped: p.dropped, rows: rows.length, ruleNotes: p.ruleNotes, rules: d.edges.map(x => x.name), vault: rows.length, excluded: [] };
  const a = accounting(r, e);
  expect(a.complete).toBe(true); expect(a.parts.map(x => [x.label, x.count])).toEqual([['Shown as dots', 15], ['Drawn as crosswalk lines', 4]]);
  const host: any = new ControlElement(); renderInformation(host, '', 'ready', r, e);
  expect(host.querySelector('.graph-ng-coverage-state').textContent).toBe('All notes accounted for');
  const stats = host.querySelectorAll('.graph-ng-stat').map((s: any) => [s.querySelector('svg')?.getAttribute('data-icon'), s.querySelector('.graph-ng-stat-label').textContent, s.querySelector('.graph-ng-count').textContent]);
  expect(stats.slice(0, 3)).toEqual([['circle-dot', 'Shown as dots', '15'], ['spline', 'Drawn as crosswalk lines', '4'], ['files', 'Markdown notes in vault', '19']]);
  expect(stats).toContainEqual(['spline', 'crosswalk edges', String(e.ruleVisible[0])]);
  expect(stats).toContainEqual(['spline', 'links edges', String(e.ruleVisible[1])]);
  expect(stats).toContainEqual(['unlink', 'Target note missing', '1']);
  expect(e.ruleVisible[0]! + e.ruleVisible[1]!).toBe(e.visibleEdges);
  // The canvas readout: notes and edges, no vault total and no middle dots.
  const readout: any = new ControlElement(); renderReadout(readout, a);
  expect(readout.querySelectorAll('.graph-ng-readout').map((x: any) => x.textContent)).toEqual(['15 notes', `${e.visibleEdges} edges`]);
  expect(readout.querySelectorAll('svg').map((x: any) => x.getAttribute('data-icon'))).toEqual(['circle-dot', 'spline']);
  expect(readout.textContent).not.toContain('·'); expect(readout.textContent).not.toContain(' of ');
  // Something hidden: the readout names how many notes the view hides instead of the edges.
  const filtered = explore(p, d, { ...emptyView(), filters: [{ kind: 'expr', expr: '!file.hasProperty("kind")' }] }, new Uint32Array(p.paths.length), 0, { facetValues: 50 }), shown: any = new ControlElement();
  renderReadout(shown, accounting(r, filtered));
  expect(shown.querySelectorAll('.graph-ng-readout').map((x: any) => x.textContent)).toEqual(['12 notes', '3 hidden']);
  expect(shown.querySelectorAll('svg').map((x: any) => x.getAttribute('data-icon'))).toEqual(['circle-dot', 'eye-off']);
});

test('every edge found is drawn or not drawn for one named reason, every reason is non-zero, and the rows sum exactly', () => {
  // Lines display. Teams group the notes; C is hidden, B collapsed, crosswalk lines hidden, a filter hides the kind note and a search for "n" hides "other".
  const note = (name: string, team: string, refs: string[] = [], more: Record<string, unknown> = {}) => ({ path: `N/${name}.md`, properties: { id: name === 'other' ? 'o:1' : `n:${name}`, team, refs, ...more } });
  const rows: FactRow[] = [
    note('a0', 'A', ['n:k0', 'e:0']), // endpoint hidden by the filter; a relationship note drawn as a line
    note('a1', 'A', ['o:1']), // endpoint hidden by search
    note('a2', 'A', ['n:c0']), // endpoint in hidden group C
    note('a3', 'A', ['n:a4']), // drawn
    note('a4', 'A'), note('a5', 'A', ['n:missing']), // target note missing
    note('b0', 'B', ['n:b1']), note('b1', 'B'), // inside collapsed group B
    note('c0', 'C'), note('other', 'A'),
    note('k0', 'A', ['n:c0'], { kind: 'set' }), // both endpoints hidden: the filter, the first reason, wins
    { path: 'E/e0.md', properties: { id: 'e:0', from: 'n:a4', to: 'n:a5', refs: ['n:a1'] } }, // crosswalk (hidden type); its own link starts at a line
    { path: 'Dup/d1.md', properties: { id: 'dup', refs: ['n:a0'] } }, { path: 'Dup/d2.md', properties: { id: 'dup', refs: ['n:a0'] } }, // duplicate-ID sources
  ];
  const p = buildProjection(rows, d), filters = [{ kind: 'expr' as const, expr: '!file.hasProperty("kind")' }];
  const e = explore(p, d, { ...emptyView(), filters, query: 'n', hiddenGroups: ['"C"'], hiddenTypes: ['crosswalk'], collapsedGroups: ['"B"'] }, new Uint32Array(p.paths.length), 0, { facetValues: 50 });
  expect(e.edgeHidden).toEqual([2, 1, 1, 1, 1]); expect(e.visibleEdges).toBe(1); expect(p.source.length).toBe(7);
  expect(p.dropped).toEqual({ links: { drawn: 6, missing: 1, excluded: 2, lines: 2 }, crosswalk: { drawn: 1, missing: 0, excluded: 0, lines: 0 } });
  expect(p.missed).toEqual([['links', 'N/a5.md', 'n:missing']]);
  const r: InformationReport = { nodes: p.paths.length, edges: p.source.length, listed: rows.length, linksPending: false, provisional: false, unresolved: p.unresolved, duplicates: p.quarantined.length,
    dropped: p.dropped, missed: p.missed, rows: rows.length, ruleNotes: p.ruleNotes, rules: d.edges.map(x => x.name), vault: rows.length, excluded: [] };
  const x = edgeAccounting(r, e);
  expect(x.parts.map(q => [q.label, q.count])).toEqual([
    ['Endpoint hidden by filter: kind exists', 2], ['Endpoint hidden by search', 1], ['Endpoint in a hidden group or color', 1], ['Relationship type hidden', 1],
    ['Inside a collapsed group', 1], ['Target note missing', 1], ['Endpoint has a duplicate ID', 2], ['Endpoint is a relationship note drawn as a line', 2],
  ]);
  expect(x.parts.every(q => q.count > 0)).toBe(true); expect(x.drawn).toBe(1);
  expect(x.drawn + x.parts.reduce((s, q) => s + q.count, 0)).toBe(x.total); expect(x.total).toBe(p.source.length + 1 + 2 + 2);
  // Rendered: drawn plus every reason row equals Edges found; each reason with a cause is a button to it.
  const calls: unknown[] = [], host: any = new ControlElement();
  renderInformation(host, '', 'ready', r, e, { display: v => calls.push(['display', v]), filter: i => calls.push(['filter', i]) });
  const kids = host.children, edgeRows = kids[kids.findIndex((h: any) => h.tagName === 'H4' && h.textContent === 'Edges') + 1];
  const value = (row: any) => Number(row.querySelector('.graph-ng-count').textContent.replace(/,/g, ''));
  const rowsOf = edgeRows.querySelectorAll('.graph-ng-stat').filter((s: any) => !s.classes.has('graph-ng-stat-sub') && s.querySelector('.graph-ng-stat-label').textContent !== 'Layout');
  const found = rowsOf.find((s: any) => s.classes.has('graph-ng-stat-total'));
  expect(found.querySelector('.graph-ng-stat-label').textContent).toBe('Edges found');
  expect(rowsOf.filter((s: any) => s !== found).reduce((s: number, row: any) => s + value(row), 0)).toBe(value(found));
  const button = (label: string) => rowsOf.find((s: any) => s.querySelector('.graph-ng-stat-label').textContent === label);
  button('Endpoint hidden by filter: kind exists').click(); button('Endpoint hidden by search').click(); button('Inside a collapsed group').click(); button('Endpoint is a relationship note drawn as a line').click();
  expect(calls).toEqual([['filter', 0], ['filter', -1], ['filter', 1], ['display', true]]);
  for (const label of ['Endpoint hidden by filter: kind exists', 'Relationship type hidden']) expect(button(label).tagName).toBe('BUTTON');
  // The missing-target row opens to the relationships it counts.
  const missing = host.querySelector('.graph-ng-stat-list'); expect(missing.tagName).toBe('DETAILS');
  expect(missing.querySelector('summary').textContent).toBe('Target note missing1'); expect(host.textContent).not.toMatch(/\d\s*(?:of|\/)\s*\d/); expect(missing.textContent).toContain('N/a5.md → n:missing (links)');
  // The notes breakdown's filter row leads to its chip too.
  host.querySelector('.graph-ng-coverage').querySelectorAll('.graph-ng-stat').find((s: any) => s.textContent.startsWith('Hidden by filter')).click(); expect(calls.at(-1)).toEqual(['filter', 0]);
});

test('hidden clauses read after "Hiding N notes"', () => {
  const clause = (expr: string) => hiddenClause({ kind: 'expr', expr });
  expect(clause('!file.hasProperty("kind")')).toEqual({ text: 'where kind exists', code: false });
  expect(clause('note.status == "open"')).toEqual({ text: 'where status is not “open”', code: false });
  expect(clause('!["a"].contains(note.kind)')).toEqual({ text: 'where kind is any of “a”', code: false });
  expect(clause('file.inFolder("A/B")')).toEqual({ text: 'outside folder A/B', code: false });
  expect(clause('!file.inFolder("A")')).toEqual({ text: 'in folder A', code: false });
  expect(clause('note.rank > 2')).toEqual({ text: 'note.rank > 2', code: true });
});

test('facet toggles own only negated value lists and presence tests on their key, and rewrite them in place', () => {
  const present = ['"edge"', '"facet"', '"set"'], room = { kind: 'expr' as const, expr: '!file.hasProperty("kind")' }, other = { kind: 'exists' as const, key: 'team' };
  expect(toggledValues([room, other], 'kind', present)).toEqual({ hidden: new Set(present), owned: [0] });
  // Tick "set" back on: the presence test becomes a value list hiding the rest.
  const shown = setToggles([room, other], 'kind', present, new Set(['"edge"', '"facet"']));
  expect(shown).toEqual([{ kind: 'expr', expr: '!["edge", "facet"].contains(note.kind)' }, other]);
  expect(toggledValues(shown, 'kind', present).hidden).toEqual(new Set(['"edge"', '"facet"']));
  // Every value off again restores the room's form; hiding missing adds a presence test; none hidden removes them.
  expect(setToggles(shown, 'kind', present, new Set(present))).toEqual([room, other]);
  expect(setToggles(shown, 'kind', present, new Set(['undefined', '"set"']))).toEqual([{ kind: 'expr', expr: 'file.hasProperty("kind")' }, { kind: 'expr', expr: '!["set"].contains(note.kind)' }, other]);
  expect(setToggles(shown, 'kind', present, new Set())).toEqual([other]);
  // A positive value filter is not a toggle; it is left alone.
  expect(toggledValues([{ kind: 'eq', key: 'kind', value: 'set' }], 'kind', present).owned).toEqual([]);
});

test('relationship notes drawn as lines offer "Show as nodes", and name the filter that would hide them, with its remove button', () => {
  const rows = vault().filter(x => !x.path.startsWith('Dup/')), p = buildProjection(rows, d), room = { kind: 'expr' as const, expr: '!file.hasProperty("kind")' };
  const e = { ...explore(p, d, { ...emptyView(), filters: [room] }, new Uint32Array(p.paths.length), 0, { facetValues: 50 }) };
  // The worker counts filters on the relationship notes alone; the room filter hides all 4 of them.
  const carriers = relationshipNotes(rows, d)!; expect(carriers.paths.length).toBe(4);
  e.carrierHidden = hiddenBy(carriers, e.filters); expect(e.carrierHidden).toEqual([4]);
  const r: InformationReport = { nodes: p.paths.length, edges: p.source.length, listed: rows.length, linksPending: false, provisional: false, unresolved: 0, duplicates: 0,
    rows: rows.length, ruleNotes: p.ruleNotes, rules: d.edges.map(x => x.name), vault: rows.length, excluded: [] };
  const calls: unknown[] = [], host: any = new ControlElement(), act = { display: (nodes: boolean) => calls.push(['display', nodes]), remove: (i: number) => calls.push(['remove', i]) };
  renderInformation(host, '', 'ready', r, e, act);
  const show = host.querySelectorAll('button').find((b: any) => b.textContent === 'Show as nodes'); expect(show).toBeDefined();
  // The action sits directly under the lines row.
  const coverage = host.querySelector('.graph-ng-coverage').children, at = coverage.findIndex((c: any) => c.textContent.startsWith('Drawn as crosswalk lines'));
  expect(coverage[at + 1].contains(show)).toBe(true);
  const warning = host.querySelector('.graph-ng-stat-warning');
  expect(warning.textContent).toBe('As notes, 4 relationship notes would be hidden by filter: kind is missing');
  const remove = warning.querySelector('button'); expect(remove.getAttribute('aria-label')).toBe('Remove filter'); expect(remove.querySelector('svg').getAttribute('data-icon')).toBe('x');
  show.click(); remove.click(); expect(calls).toEqual([['display', true], ['remove', 0]]);
  // Drawn as notes: they are dots now, the switch offers lines back, and the warning says they are hidden.
  const nodesHost: any = new ControlElement(); renderInformation(nodesHost, '', 'ready', { ...r, relationshipNodes: true }, e, act);
  expect(nodesHost.textContent).not.toContain('Drawn as crosswalk lines');
  nodesHost.querySelectorAll('button').find((b: any) => b.textContent === 'Show as lines').click(); expect(calls.at(-1)).toEqual(['display', false]);
  expect(nodesHost.querySelector('.graph-ng-stat-warning').textContent).toBe('4 relationship notes hidden by filter: kind is missing');
  expect(nodesHost.textContent).toContain('crosswalk notes, drawn as dots');
  // No filter hides them: no warning.
  const clear: any = new ControlElement(); renderInformation(clear, '', 'ready', r, { ...e, carrierHidden: [0] }, act); expect(clear.querySelector('.graph-ng-stat-warning')).toBeUndefined();
});

test('review regression: a filter on a group-only or colour-only column still counts relationship notes instead of throwing', () => {
  // `team` is materialized only by the declared group, `tone` only by a colour rule.
  const g: GraphDeclaration = { ...d, columns: ['kind'], colors: [{ name: 'warm', color: '#f00', predicate: { kind: 'exists', key: 'tone' } }] };
  const rows: FactRow[] = [{ path: 'a.md', properties: { id: 'a', team: 'A' } }, { path: 'b.md', properties: { id: 'b', team: 'B' } },
    { path: 'e.md', properties: { id: 'e', team: 'A', tone: 'x', from: 'a', to: 'b' } }];
  const carriers = relationshipNotes(rows, g)!;
  expect(carrierHiddenBy(carriers, [{ kind: 'expr', expr: '!["A"].contains(note.team)' }, { kind: 'exists', key: 'tone' }])).toEqual([1, 0]);
  // A filter that cannot be evaluated on them yields no warning count, never a failed view.
  expect(carrierHiddenBy(carriers, [{ kind: 'expr', expr: 'note.nowhere == 1' }])).toBeUndefined();
});

test('review regression: "!=" toggles also hide missing values, and multi-valued facets never write a broken filter', () => {
  const present = ['"p"', '"q"'], strict = { kind: 'expr' as const, expr: 'note.kind != "p"' };
  // `kind != "p"` is false for a note without kind, so it hides missing notes too; a toggle rewrite keeps that.
  expect(toggledValues([strict], 'kind', present).hidden).toEqual(new Set(['"p"', 'undefined']));
  const rows: FactRow[] = [{ path: 'p.md', properties: { id: 'p', kind: 'p' } }, { path: 'q.md', properties: { id: 'q', kind: 'q' } }, { path: 'm.md', properties: { id: 'm' } }];
  const plain: GraphDeclaration = { ...d, edges: [], groups: [], exclude: [] }, p = buildProjection(rows, plain);
  const shown = (filters: any[]) => { const e = explore(p, plain, { ...emptyView(), filters }, new Uint32Array(p.paths.length), 0, { facetValues: 50 }); return p.paths.filter((_, i) => e.visible[i]); };
  const { hidden } = toggledValues([strict], 'kind', present);
  expect(shown(setToggles([strict], 'kind', present, hidden))).toEqual(shown([strict]));
  // A list value cannot be a value-list filter: the facet is not offered, and a direct call leaves filters untouched.
  expect(toggleable(['"x"', '["x","y"]', 'undefined'])).toBe(false); expect(toggleable(['"x"', '3', 'undefined'])).toBe(true);
  const list = ['"x"', '["x","y"]'], kept = [strict];
  expect(setToggles(kept, 'tags', list, new Set(['["x","y"]']))).toEqual(kept);
});
