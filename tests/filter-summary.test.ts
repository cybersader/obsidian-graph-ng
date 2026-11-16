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
  expect(derived({ kind: 'segment', delimiter: ':', index: -2 }, '$identity')).toBe('Part 2 from the end of ID (split at “:”)');
  expect(derived({ kind: 'prefix', delimiter: ':', segments: 1 })).toBe('First 1 part of curie (split at “:”)');
  expect(derived({ kind: 'prefix', delimiter: ':', segments: 2 })).toBe('First 2 parts of curie (split at “:”)');
});

test('graph information renders icon stat rows, a plain-English issues list and per-rule lines, with no bars or cards', async () => {
  await import('./support/obsidian-fixture');
  const { ControlElement } = await import('./support/controls-dom');
  const { renderInformation } = await import('../src/graph-information');
  const host: any = new ControlElement();
  const report: any = { nodes: 16121, edges: 49534, indexed: 90, listed: 100, linksPending: true, provisional: true, unresolved: 1, duplicates: 2, rows: 100, rules: ['crosswalk'], dropped: { crosswalk: { drawn: 10, missing: 2, excluded: 1, lines: 0 } } };
  renderInformation(host, 'Building layout in worker…', 'ready', report);
  const rows = host.querySelectorAll('.graph-ng-stat').map((t: any) => [t.children[0].children[0].getAttribute('data-icon'), t.children[1].textContent, t.children[2].textContent]);
  expect(rows).toEqual([['circle-dot', 'Shown as dots', '16,121'], ['copy', 'Duplicate IDs, left out', '2'], ['files', 'Markdown notes in vault', '16,123'], ['spline', 'Edges drawn', '49,534'],
    ['unlink', 'Target note missing', '2'], ['copy', 'Endpoint has a duplicate ID', '1'], ['sigma', 'Edges found', '49,537'], ['timer', 'Layout', 'Building…']]);
  expect(host.querySelectorAll('.graph-ng-count').length).toBe(rows.length);
  // Issues list only what the breakdown does not: loading is the coverage line, duplicate IDs and missing targets are breakdown rows.
  expect(host.querySelector('.graph-ng-explore-note').textContent).toBe('Links pending: link targets are still being resolved.');
  expect(host.querySelector('.graph-ng-coverage-state').textContent).toBe('Still loading properties and links');
  expect(host.querySelectorAll('.graph-ng-help-popover').map((x: any) => x.textContent)).toContain('These notes share an ID with another note. Give each note a unique ID to include it.');
  expect(host.textContent).not.toContain('Properties loaded'); expect(host.textContent).not.toContain('Partial graph');
  expect(host.textContent).not.toContain(' · ');
  // The tile bar, card and table are gone.
  for (const cls of ['.graph-ng-stat-bar', '.graph-ng-stat-value', '.graph-ng-rules']) expect(host.querySelector(cls)).toBeUndefined();
  expect(host.querySelector('table')).toBeUndefined();
  renderInformation(host, '', 'ready', { ...report, provisional: false, linksPending: false, unresolved: 0, duplicates: 0, rows: 100, dropped: undefined, layout: { cached: false, ms: 412.4, totalMs: 900 } });
  expect(host.textContent).toContain('No issues found.'); expect(host.querySelector('p')).toBeUndefined();
  expect(host.querySelectorAll('.graph-ng-stat').at(-1).textContent).toBe('LayoutComputed layout in 0.4 s');
  // The Layout row says whether positions came from the saved layout.
  for (const [layout, text] of [[{ cached: true, ms: 0 }, 'Reused saved layout'], [{ cached: false, reused: 'all', ms: 3 }, 'Reused saved layout'], [{ cached: false, reused: 'some', ms: 1840 }, 'Reused saved layout, adjusted in 1.8 s'], [{ cached: false, ms: 5800 }, 'Computed layout in 5.8 s']] as const) {
    renderInformation(host, '', 'ready', { ...report, provisional: false, linksPending: false, unresolved: 0, duplicates: 0, rows: 100, dropped: undefined, layout: { ...layout, totalMs: 900 } });
    expect(host.querySelectorAll('.graph-ng-stat').at(-1).textContent).toBe(`Layout${text}`);
  }
  renderInformation(host, 'Projection refresh failed: synthetic', 'error');
  expect(host.querySelector('p').classes.has('graph-ng-explore-error')).toBe(true); expect(host.querySelector('.graph-ng-stat')).toBeUndefined();
});

test('styles carry no stat bar, no stat card border and tabular counts', async () => {
  const css = await Bun.file(new URL('../styles.css', import.meta.url)).text(), rule = (sel: string) => css.split('\n').filter(l => l.startsWith(sel)).join('\n');
  expect(css).not.toContain('graph-ng-stat-bar'); expect(css).not.toContain('graph-ng-stat-value'); expect(css).not.toContain('graph-ng-rules');
  expect(rule('.graph-ng-stat,')).not.toMatch(/border|background/); expect(rule('.graph-ng-stat,')).toContain('tabular-nums');
  const src = await Bun.file(new URL('../src/explore-panel.ts', import.meta.url)).text();
  expect(src).not.toContain('graph-ng-stat-bar'); expect(src).not.toContain('graph-ng-scope-detail');
});
