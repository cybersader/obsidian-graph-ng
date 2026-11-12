import { test, expect } from 'bun:test';
import { ContributionPage, type ContributionContext, type ContributionResult } from '../src/contribution-page';
import { defaultDeclaration } from '../src/core/declaration';
import { buildProjection } from '../src/core/projection';
import { contractGroups, pairKey } from '../src/core/group-projection';
function context(revision: number, names: (string | number)[] = ['B', 'C']): ContributionContext {
  const d = defaultDeclaration('fixture@1'); d.groups = [{ from: 'key', key: 'group' }];
  const projection = buildProjection(names.map((group, i) => ({ path: `${i}.md`, properties: { group }, links: { 'fixture@1': [`${(i + 1) % names.length}.md`] } })), d);
  return { active: revision, groups: revision, detail: revision, level: 0, projection, graph: contractGroups(projection, new Uint8Array(names.length).fill(1)).projection };
}
const result = { total: 1, items: [{ source: '0.md', target: '1.md', type: 'link', carrier: 'mapping.md' }] };
const settle = async () => { await Promise.resolve(); await Promise.resolve(); };
test('contribution intent waits for matching active/group/detail generations and reloads without another click', async () => {
  const calls: any[] = [], c = context(1), page = new ContributionPage(100, async (...args) => { calls.push(args); return result; }, () => {});
  page.select('0', '1', 1, c.graph); page.update({ ...c, active: 2 });
  expect(page.status).toBe('refreshing'); expect(page.message).toContain('Refreshing'); expect(calls).toHaveLength(0);
  // A new alphabetically earlier group shifts both IDs. Raw values retain the intended pair.
  const newer = context(2, ['A', 'B', 'C']); page.update({ ...newer, detail: 1 }); expect(calls).toHaveLength(0);
  page.update(newer); await settle(); expect(calls).toEqual([[2, pairKey('1', '2'), 0, 100, -1]]); expect(page.result).toEqual(result); expect(page.status).toBe('ready');
  page.update(newer); expect(calls).toHaveLength(1);
});
test('fresh group-summary selection needs no old detail dictionary', async () => {
  const c = context(7), calls: any[] = [], page = new ContributionPage(20, async (...args) => { calls.push(args); return result; }, () => {});
  page.select('0', '1', 7, c.graph); page.update({ ...c, projection: undefined, detail: -1 }); expect(page.selection?.keys).toEqual(['"B"', '"C"']); expect(calls).toHaveLength(0);
  page.update(c); await settle(); expect(page.result?.total).toBe(1);
});
test('late success and rejection cannot replace a refreshed contribution page', async () => {
  for (const rejectOld of [false, true]) {
    const pending: { resolve: (r: ContributionResult) => void; reject: (e: Error) => void }[] = [];
    const page = new ContributionPage(2, () => new Promise((resolve, reject) => pending.push({ resolve, reject })), () => {});
    page.select('0', '1', 1, context(1).graph); page.update(context(1)); page.suspend(); page.update(context(2));
    pending[1]!.resolve(result); await settle();
    if (rejectOld) pending[0]!.reject(new Error('Projection generation changed')); else pending[0]!.resolve({ total: 999, items: [] });
    await settle(); expect(page.status).toBe('ready'); expect(page.result).toEqual(result);
  }
});
test('contribution failures are visible, explicit Retry works, and clear invalidates pending work', async () => {
  let calls = 0; const page = new ContributionPage(2, async () => { if (++calls === 1) throw new Error('synthetic read failure'); return result; }, () => {});
  page.select('0', '1', 1, context(1).graph); page.update(context(1)); await settle(); expect(page.status).toBe('error'); expect(page.message).toContain('synthetic read failure'); expect(calls).toBe(1);
  page.retry(context(1)); await settle(); expect(page.status).toBe('ready'); expect(calls).toBe(2);
  page.move(1, context(1)); page.clear(); await settle(); expect(page.selection).toBeUndefined(); expect(page.result).toBeUndefined();
});
test('removed raw keys never reuse numeric IDs or equal-looking display labels', async () => {
  const calls: any[] = [], page = new ContributionPage(2, async (...args) => { calls.push(args); return result; }, () => {});
  const original = context(1, [1, '1']);
  expect(original.graph!.groups[0]!.label).toBe(original.graph!.groups[1]!.label);
  expect(original.graph!.groups[0]!.key).not.toBe(original.graph!.groups[1]!.key);
  page.select('0', '1', 1, original.graph); page.update(original); await settle(); page.suspend(); page.update(context(2, ['1', '2']));
  expect(page.status).toBe('error'); expect(page.message).toContain('no longer present'); expect(calls).toHaveLength(1);
});

test('review probe: keyless cached IDs never select a different same-revision relationship', async () => {
  const reads: string[] = [], page = new ContributionPage(10, async (_revision, pair) => { reads.push(pair); return result; }, () => {});
  const cached = context(5, ['A', 'B', 'C']);
  for (const group of cached.graph!.groups) delete group.key;
  page.select('0', '1', 5, cached.graph);
  page.update({ ...cached, projection: undefined, detail: -1 });
  expect(page.status).toBe('refreshing'); expect(reads).toHaveLength(0);
  const fresh = context(5, ['0', 'A', 'B', 'C']);
  // Both wrong 0,1 and correct 1,2 relationships exist in the reviewer's probe.
  page.update(fresh); await settle();
  expect(page.selection?.keys).toEqual(['"A"', '"B"']);
  expect(reads).toEqual([pairKey('1', '2')]); expect(page.status).toBe('ready');
});
test('selection captures keyed values before a summary is replaced, without an intervening update', async () => {
  const reads: string[] = [], page = new ContributionPage(10, async (_revision, pair) => { reads.push(pair); return result; }, () => {});
  page.select('0', '1', -5, context(5, ['A', 'B', 'C']).graph);
  page.update(context(5, ['0', 'A', 'B', 'C'])); await settle();
  expect(page.selection?.keys).toEqual(['"A"', '"B"']); expect(reads).toEqual([pairKey('1', '2')]);
});
test('legacy duplicate or missing display labels remain refreshing, never guessed by reused IDs', async () => {
  for (const names of [[1, '1', '2'], ['1', '2']]) {
    const reads: string[] = [], page = new ContributionPage(10, async (_revision, pair) => { reads.push(pair); return result; }, () => {});
    const cached = context(5, [1, '1']); for (const group of cached.graph!.groups) delete group.key;
    page.select('0', '1', -5, cached.graph); page.update(context(5, names)); await settle();
    expect(page.status).toBe('refreshing'); expect(reads).toHaveLength(0);
  }
});
test('review probe: a regroup (same revision) never shows a relationship from the previous grouping', async () => {
  // Worker model: the dictionary flips when it applies the explore request (FIFO), before main adopts the reply.
  const oldKeys = ['"Alpha"', '"Beta"', '"Gamma"'], newKeys = ['Archive', 'Inbox', 'Projects'];
  const worker = { keys: oldKeys, view: 1 };
  const graph = (keys: string[]): any => ({ groups: keys.map((k, i) => ({ id: String(i), key: k, label: k, count: 1 })), groupEdges: [{ a: '0', b: '1', total: 1, typeCounts: {}, carriers: { kind: 'x', ids: [] } }] });
  const shown: string[] = [];
  const page = new ContributionPage(10, async (_r, pair, _o, _c, view) => {
    if (view !== worker.view) throw new Error('View generation changed');
    const [a, b] = JSON.parse(pair).map(Number); const rel = `${worker.keys[a!]}<->${worker.keys[b!]}`; shown.push(rel); return { total: 1, items: [rel as any] };
  }, () => {});
  const R = 7, base = { active: R, groups: R, detail: R, level: 0, projection: { groups: [{ values: oldKeys }] } };
  // 1. User regroups by folder: worker applies it first.
  worker.keys = newKeys; worker.view = 2;
  // 2. Before the reply, the user clicks Alpha↔Beta on the old canvas (old view generation, old source).
  page.select('0', '1', R, graph(oldKeys), 'property'); page.update({ ...base, graph: graph(oldKeys), values: oldKeys, view: 1, source: 'property' });
  await settle(); await settle();
  expect(page.status).toBe('refreshing'); expect(page.result).toBeUndefined();
  // 3. Reply adopted: same revision, new dictionary, new view generation and grouping.
  page.update({ ...base, graph: graph(newKeys), values: newKeys, view: 2, source: 'folder' });
  await settle(); await settle();
  expect(page.result).toBeUndefined(); expect(page.status).toBe('error'); expect(page.message).toContain('Grouping changed');
  expect(shown.filter(r => !r.includes('Alpha'))).toEqual([]);
  // A filter-only change (same grouping, new generation) re-resolves the same raw keys.
  const keep = new ContributionPage(10, async (_r, pair, _o, _c, view) => { if (view !== worker.view) throw new Error('View generation changed'); const [a, b] = JSON.parse(pair).map(Number); return { total: 1, items: [`${worker.keys[a!]}<->${worker.keys[b!]}` as any] }; }, () => {});
  worker.keys = oldKeys; worker.view = 3;
  keep.select('0', '1', R, graph(oldKeys), 'property'); keep.update({ ...base, graph: graph(oldKeys), values: oldKeys, view: 3, source: 'property' }); await settle(); await settle();
  expect(keep.result?.items).toEqual(['"Alpha"<->"Beta"' as any]);
  worker.view = 4; keep.update({ ...base, graph: graph(oldKeys), values: oldKeys, view: 4, source: 'property' }); await settle(); await settle();
  expect(keep.status).toBe('ready'); expect(keep.result?.items).toEqual(['"Alpha"<->"Beta"' as any]);
});
