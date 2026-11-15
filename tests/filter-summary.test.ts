import { test, expect } from 'bun:test';
import { filterSummary } from '../src/filter-summary';
import { groupLabel } from '../src/core/explore';

test('filter summaries read as plain English for recognizable forms, verbatim otherwise', () => {
  const expr = (e: string) => filterSummary({ kind: 'expr', expr: e });
  expect(expr('!file.hasProperty("kind")')).toEqual({ text: 'kind is missing', code: false });
  expect(expr('file.hasProperty("kind")')).toEqual({ text: 'kind exists', code: false });
  expect(expr('note.status == "open"')).toEqual({ text: 'status is “open”', code: false });
  expect(expr('note.status != "open"')).toEqual({ text: 'status is not “open”', code: false });
  expect(expr('!(note.rank == 2)')).toEqual({ text: 'rank is not 2', code: false });
  expect(expr('["a", "b"].contains(note.tag)')).toEqual({ text: 'tag is any of “a”, “b”', code: false });
  expect(expr('!file.inFolder("Notes/Sub")')).toEqual({ text: 'Not in folder Notes/Sub', code: false });
  expect(expr('note.rank > 2 && file.hasProperty("kind")')).toEqual({ text: 'note.rank > 2 && file.hasProperty("kind")', code: true });
  expect(expr('note.rank >')).toMatchObject({ code: true });
  expect(filterSummary({ kind: 'in', key: 'k', values: ['a', 'b', 'c', 'd', null] })).toEqual({ text: 'k is any of “a”, “b”, “c” +2 more', code: false });
  expect(filterSummary({ kind: 'eq', key: 'k', value: null }).text).toBe('k is empty');
  expect(filterSummary({ kind: 'folder', prefix: ['A', 'B'] }).text).toBe('In folder A/B');
});

test('derived grouping labels use parts, not zero-based segment jargon', () => {
  const derived = (transform: any, key = 'curie') => groupLabel({ from: 'derived', key, transform });
  expect(derived({ kind: 'segment', delimiter: ':', index: 0 })).toBe('Part 1 of curie (split at “:”)');
  expect(derived({ kind: 'segment', delimiter: '/', index: -1 }, '$path')).toBe('Last part of path (split at “/”)');
  expect(derived({ kind: 'segment', delimiter: ':', index: -2 }, '$identity')).toBe('Part 2 from the end of identity (split at “:”)');
  expect(derived({ kind: 'prefix', delimiter: ':', segments: 1 })).toBe('First 1 part of curie (split at “:”)');
  expect(derived({ kind: 'prefix', delimiter: ':', segments: 2 })).toBe('First 2 parts of curie (split at “:”)');
});

test('graph information renders tiles, a plain-English issues list and a per-rule table without dot-joined text', async () => {
  const { ControlElement } = await import('./support/controls-dom');
  const { renderInformation, informationAlerts } = await import('../src/graph-information');
  const host: any = new ControlElement();
  const report: any = { nodes: 16121, edges: 49534, indexed: 90, listed: 100, linksPending: true, provisional: true, unresolved: 1, duplicates: 2, dropped: { crosswalk: { drawn: 10, missing: 2, excluded: 1, carriers: 3 } } };
  renderInformation(host, 'Building layout in worker…', 'ready', report);
  const tiles = host.querySelectorAll('.graph-ng-stat').map((t: any) => t.children.map((c: any) => c.textContent));
  expect(tiles).toEqual([['Nodes', '16,121'], ['Edges', '49,534'], ['Properties loaded', '90 of 100', 'Still loading'], ['Layout', 'Building…']]);
  const issues = host.querySelectorAll('li').map((li: any) => li.children[0].textContent);
  expect(issues).toEqual(['Partial graph', 'Links pending', '2 notes share an ID and are excluded', '1 unresolved link']);
  const rows = host.querySelectorAll('tr').map((tr: any) => tr.children.map((c: any) => c.textContent));
  expect(rows).toEqual([['Rule', 'Drawn', 'Missing', 'Dup. ID', 'Notes out'], ['crosswalk', '10', '2', '1', '3']]);
  expect(host.textContent).not.toContain(' · ');
  expect(informationAlerts(report)).toEqual(['Partial graph, still loading', '1 unresolved link', '2 duplicate-ID notes excluded']);
  renderInformation(host, '', 'ready', { ...report, provisional: false, linksPending: false, unresolved: 0, duplicates: 0, dropped: undefined, layout: { cached: false, ms: 412.4, totalMs: 900 } });
  expect(host.textContent).toContain('No issues found.'); expect(host.querySelector('p')).toBeUndefined(); expect(host.querySelector('table')).toBeUndefined();
  expect(host.querySelectorAll('.graph-ng-stat')[3].textContent).toBe('Layout412 msTotal 900 ms');
  renderInformation(host, 'Projection refresh failed: synthetic', 'error');
  expect(host.querySelector('p').classes.has('graph-ng-explore-error')).toBe(true); expect(host.querySelector('.graph-ng-stat')).toBeUndefined();
});
