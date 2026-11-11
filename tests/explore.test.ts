import { test, expect } from 'bun:test';
import { buildProjection, filterNodes, colorGroups, type FactRow } from '../src/core/projection';
import { defaultDeclaration, digest, layoutDeclaration, migrateDeclaration, validatePredicate, type GraphDeclaration, type Predicate } from '../src/core/declaration';
import { canonicalView, emptyView, explore, groupColumn, validateSaved, validateView, withoutTypes, NO_COLOR, type ExploreView } from '../src/core/explore';
import { generationKey } from '../src/core/generation';
import { DEFAULT_LAYOUT } from '../src/core/layout-options';
import { canonicalExplore, decodeText, defaults, encodeText, persistedSettings, upgradeSettings, validateSettings, validateVisuals } from '../src/settings';
import { compatibilityIssues, credentialShapedField } from './support/settings-compatibility';
import { categorical, contrast, degreeSizes, densityScale, edgeAlpha, effectPolicy, ensureContrast, groupHalos, labelFade, neutralizeGroups, nodeColors, parseHex } from '../src/render-effects';
import { LABEL_RATIOS } from '../src/render-data';
import { minifyGlsl } from '../scripts/glsl.mjs';

const declaration = (): GraphDeclaration => ({
  version: 2, identity: [{ key: 'id' }], display: { reifiedAsNodes: false }, columns: ['family', 'rank', 'flag'],
  edges: [{ name: 'refs', kind: 'inline', key: 'refs', type: 'refers' }, { name: 'parents', kind: 'inline', key: 'parent', type: 'parent' }],
  groups: [{ from: 'key', key: 'family' }, { from: 'folder', depth: 1 }],
  colors: [{ name: 'Alpha', color: '#56b4e9', predicate: { kind: 'eq', key: 'family', value: 'Alpha' } }, { name: 'Ranked', color: '#e69f00', predicate: { kind: 'exists', key: 'rank' } }],
});
function rows(n = 240, seed = 7): FactRow[] {
  let s = seed; const r = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  return Array.from({ length: n }, (_, i) => {
    const properties: Record<string, unknown> = { id: `n:${i}`, family: ['Alpha', 'Beta', 'Gamma'][i % 3], refs: [`n:${Math.floor(r() * n)}`, `n:${Math.floor(r() * n)}`], parent: `n:${Math.floor(i / 2)}` };
    if (i % 4 === 0) properties.rank = i % 8 === 0 ? 1 : '1';
    if (i % 5 === 0) properties.flag = i % 10 === 0;
    if (i % 7 === 0) properties.family = null;
    return { path: `${['Notes', 'Archive', 'Notes/Deep'][i % 3]}/Item-${String(i).padStart(4, '0')}.md`, properties };
  });
}
/** Independent row-level oracle for one predicate; scalar types are exact. */
function oracle(row: FactRow, p: Predicate): boolean {
  if (p.kind === 'folder') { const prefix = (Array.isArray(p.prefix) ? p.prefix.join('/') : p.prefix).replace(/\/+$/, ''); return !prefix || row.path.startsWith(prefix + '/'); }
  const has = Object.hasOwn(row.properties, p.key), v = row.properties[p.key];
  if (p.kind === 'exists') return has;
  if (!has) return false;
  return p.kind === 'eq' ? v === p.value : p.values.some(x => x === v);
}
test('filter compilation matches a brute-force oracle for eq/in/exists/folder and AND', () => {
  const input = rows(), d = declaration(), p = buildProjection(input, d), byPath = new Map(input.map(r => [r.path, r]));
  const predicates: Predicate[] = [
    { kind: 'eq', key: 'family', value: 'Alpha' }, { kind: 'eq', key: 'rank', value: 1 }, { kind: 'eq', key: 'rank', value: '1' }, { kind: 'eq', key: 'family', value: null },
    { kind: 'in', key: 'family', values: ['Beta', 'Gamma'] }, { kind: 'in', key: 'flag', values: [true, false] }, { kind: 'in', key: 'family', values: [] },
    { kind: 'exists', key: 'rank' }, { kind: 'exists', key: 'flag' }, { kind: 'folder', prefix: ['Notes'] }, { kind: 'folder', prefix: 'Notes/Deep' }, { kind: 'folder', prefix: '' },
  ];
  for (const predicate of predicates) {
    validatePredicate(predicate);
    const bits = filterNodes(p, predicate);
    p.paths.forEach((path, i) => expect([predicate, path, bits[i] === 1]).toEqual([predicate, path, oracle(byPath.get(path)!, predicate)]));
  }
  const view: ExploreView = { ...emptyView(), filters: [predicates[4]!, predicates[7]!, predicates[9]!] };
  const result = explore(p, d, view, colorGroups(p, d), 0, { facetValues: 10 });
  p.paths.forEach((path, i) => expect(result.visible[i] === 1).toBe(view.filters.every(f => oracle(byPath.get(path)!, f))));
  expect(result.matched).toBe(result.visible.reduce((n, v) => n + v, 0));
  expect(() => filterNodes(p, { kind: 'exists', key: 'undeclared' })).toThrow('Undeclared column');
});
test('membership/existence predicates validate strictly and colors may use them', () => {
  expect(() => validatePredicate({ kind: 'in', key: 'k', values: [{}] })).toThrow('Membership');
  expect(() => validatePredicate({ kind: 'in', key: 'k', values: [Infinity] })).toThrow('Membership');
  expect(() => validatePredicate({ kind: 'exists', key: 'k', value: 1 })).toThrow('Unknown field');
  const d = declaration(), p = buildProjection(rows(), d), colors = colorGroups(p, d);
  p.paths.forEach((_, i) => { const r = rows().find(x => x.path === p.paths[i])!; expect(colors[i]).toBe(r.properties.family === 'Alpha' ? 0 : Object.hasOwn(r.properties, 'rank') ? 1 : 2); });
});
test('text query, hidden groups/colors/types and counts are consistent', () => {
  const d = declaration(), p = buildProjection(rows(), d), colors = colorGroups(p, d);
  const all = explore(p, d, emptyView(), colors, 0, { facetValues: 100 });
  expect(all.matched).toBe(p.paths.length); expect(all.visibleEdges).toBe(p.source.length);
  const q = explore(p, d, { ...emptyView(), query: 'ITEM-001' }, colors, 0, { facetValues: 100 });
  p.paths.forEach((path, i) => expect(q.visible[i] === 1).toBe(path.toLowerCase().split('/').pop()!.includes('item-001')));
  const alpha = all.groupKeys.indexOf('"Alpha"');
  const hidden = explore(p, d, { ...emptyView(), hiddenGroups: ['"Alpha"'], hiddenColors: ['Ranked', NO_COLOR], hiddenTypes: ['parent'] }, colors, 0, { facetValues: 100 });
  for (let i = 0; i < p.paths.length; i++) expect(hidden.visible[i] === 1).toBe(hidden.groupCodes[i] !== alpha && colors[i] === 0);
  expect(hidden.groupVisible[alpha]).toBe(0); expect(hidden.groupTotals[alpha]).toBe(all.groupTotals[alpha]);
  expect(hidden.typeVisible[p.types.indexOf('parent')]).toBe(0);
  expect(hidden.colorCounts.reduce((a, b) => a + b, 0)).toBe(p.paths.length);
  const kept = withoutTypes(p, ['parent']); expect(kept.source.length).toBe(p.type.filter(t => p.types[t] !== 'parent').length);
  expect(withoutTypes(p, [])).toBe(p);
});
test('runtime group sources resolve declared, key and folder-depth dictionaries', () => {
  const d = declaration(), p = buildProjection(rows(), d);
  expect(groupColumn(p, d, null, 1).codes).toBe(p.groups[1]!.codes);
  expect(groupColumn(p, d, { from: 'key', key: 'family' }, 1).codes).toBe(p.groups[0]!.codes);
  const rank = groupColumn(p, d, { from: 'key', key: 'rank' }, 0); expect(rank.values).toEqual(p.columns.rank!.values);
  const deep = groupColumn(p, d, { from: 'folder', depth: 2 }, 0);
  p.paths.forEach((path, i) => expect(deep.values[deep.codes[i]!]).toBe(path.split('/').slice(0, -1).slice(0, 2).join('/')));
  const under = groupColumn(p, d, { from: 'folder', depth: 1, prefix: ['Notes'] }, 0);
  p.paths.forEach((path, i) => expect(under.values[under.codes[i]!]).toBe(path.startsWith('Notes/Deep/') ? 'Deep' : path.startsWith('Notes/') ? '(root)' : '(outside prefix)'));
  expect(() => groupColumn(p, d, { from: 'key', key: 'nope' }, 0)).toThrow('Undeclared column');
  const facets = explore(p, d, emptyView(), colorGroups(p, d), 0, { facetValues: 2 }).facets;
  expect(facets.map(f => f.key)).toEqual(Object.keys(p.columns).sort());
  for (const f of facets) { expect(f.values.length).toBeLessThanOrEqual(2); expect(f.values[0]!.count).toBeGreaterThanOrEqual(f.values.at(-1)!.count); }
});
test('legend color edits never change layout identity; layout inputs still do', async () => {
  const d = declaration(), input = rows(60), base = await generationKey(input, d, DEFAULT_LAYOUT, 'p');
  const recolored = { ...d, colors: [{ name: 'New', color: '#ffffff', predicate: { kind: 'in' as const, key: 'flag', values: [true] } }] };
  expect(await generationKey(input, recolored, DEFAULT_LAYOUT, 'p')).toBe(base);
  expect(await digest(layoutDeclaration(recolored))).toBe(await digest(layoutDeclaration(d)));
  expect(await generationKey(input, { ...d, edges: d.edges.slice(1) }, DEFAULT_LAYOUT, 'p')).not.toBe(base);
  expect(layoutDeclaration(d).colors).toEqual([]); expect(d.colors.length).toBe(2);
});
test('view and saved-view persistence validates, canonicalizes and round-trips through settings', () => {
  const s = defaults('test@1');
  s.declaration = migrateDeclaration(declaration());
  const view: ExploreView = { query: 'item', filters: [{ kind: 'folder', prefix: 'Notes/Deep' }, { kind: 'in', key: 'family', values: ['Alpha', null] }], group: { from: 'folder', depth: 2, prefix: 'Notes' }, hiddenGroups: ['"Beta"'], collapsedGroups: ['"Alpha"'], hiddenColors: [NO_COLOR], hiddenTypes: ['parent'] };
  s.explore.view = view; s.explore.savedViews = [{ name: 'Deep notes', view, camera: { x: .25, y: .75, ratio: .4 } }];
  const canonical = canonicalExplore(s.explore);
  expect(canonical.view.filters[0]).toEqual({ kind: 'folder', prefix: ['Notes', 'Deep'] }); expect(canonical.view.group).toEqual({ from: 'folder', depth: 2, prefix: ['Notes'] });
  expect(view.filters[0]).toEqual({ kind: 'folder', prefix: 'Notes/Deep' });
  s.explore = canonical; validateSettings(s);
  const reread = upgradeSettings(JSON.parse(JSON.stringify(s)), 'test@1');
  expect(reread.explore).toEqual(canonical); expect(reread.visuals).toEqual(s.visuals);
  // Reproducibility: the same saved view compiles to the same masks.
  const p = buildProjection(rows(), reread.declaration), colors = colorGroups(p, reread.declaration);
  const a = explore(p, reread.declaration, reread.explore.savedViews[0]!.view, colors, 0, { facetValues: 5 }), b = explore(p, reread.declaration, canonical.view, colors, 0, { facetValues: 5 });
  expect([...a.visible]).toEqual([...b.visible]); expect([...a.groupCodes]).toEqual([...b.groupCodes]);
  expect(() => validateView({ ...view, extra: 1 })).toThrow('Unknown view field');
  expect(() => validateView({ ...view, filters: [{ kind: 'regex', key: 'x' }] })).toThrow();
  expect(() => validateView({ ...view, group: { from: 'folder', depth: 0 } })).toThrow('folder group');
  expect(() => validateSaved([{ name: 'a', view, camera: null }, { name: 'a', view, camera: null }])).toThrow('unique');
  expect(() => validateSaved([{ name: 'a', view, camera: { x: NaN, y: 0, ratio: 1 } }])).toThrow('camera');
  expect(() => validateVisuals({ ...s.visuals, glow: 2 })).toThrow('glow'); expect(() => validateVisuals({ ...s.visuals, extra: true })).toThrow('Unknown');
  expect(() => validateSettings({ ...s, explore: { ...s.explore, facetValues: 0 } })).toThrow('facetValues');
});
test('legacy settings without visuals/explore upgrade to defaults', () => {
  const s = defaults('test@1') as any; delete s.visuals; delete s.explore; s.explore = { panelOpen: false };
  const upgraded = upgradeSettings(s, 'test@1');
  expect(upgraded.visuals).toEqual(defaults('test@1').visuals); expect(upgraded.explore.panelOpen).toBe(false); expect(upgraded.explore.view).toEqual(emptyView());
});
test('explore settings, saved views and color rules stay settings-sharing scanner safe', () => {
  const s = defaults('obsidian-links@1.13.7');
  s.declaration.colors = [{ name: 'Deep research', color: '#123456', predicate: { kind: 'folder', prefix: ['Research', 'Category-1', 'Source-Material', 'References', 'Examples'] } }, { name: 'Ranked', color: '#654321', predicate: { kind: 'in', key: 'family', values: ['Family 1', 'Family 2'] } }];
  const view: ExploreView = { query: 'concept', filters: [{ kind: 'folder', prefix: 'Research/Category-1/Source-Material/References/Examples' }, { kind: 'exists', key: 'family' }], group: { from: 'folder', depth: 2, prefix: 'Research/Category-1/Source-Material' }, hiddenGroups: ['"Family 2"', 'Research/Category-1'], collapsedGroups: ['"Family 1"'], hiddenColors: ['Ranked'], hiddenTypes: ['related'] };
  s.explore = canonicalExplore({ ...s.explore, view, savedViews: Array.from({ length: 20 }, (_, i) => ({ name: `View ${i}`, view, camera: { x: i / 20, y: .5, ratio: 1 } })) });
  validateSettings(s);
  expect(compatibilityIssues(s)).toEqual([]);
  const keys = new Set<string>(); (function walk(v: unknown) { if (v && typeof v === 'object') for (const [k, c] of Object.entries(v)) { if (!Array.isArray(v)) keys.add(k); walk(c); } })(s);
  for (const key of keys) expect([key, credentialShapedField(key)]).toEqual([key, false]);
});
test('palette and contrast helpers keep categorical node colors legible in both themes', () => {
  const dark = parseHex('#141b26'), light = parseHex('#ffffff');
  for (const bg of [dark, light]) {
    const bytes = categorical(40, bg);
    for (let i = 0; i < 40; i++) expect(contrast([bytes[i * 4]!, bytes[i * 4 + 1]!, bytes[i * 4 + 2]!], bg)).toBeGreaterThanOrEqual(3);
    expect(new Set(Array.from({ length: 12 }, (_, i) => bytes.slice(i * 4, i * 4 + 3).join())).size).toBe(12);
  }
  expect(contrast(ensureContrast(parseHex('#eeeeee'), light, 4.5), light)).toBeGreaterThanOrEqual(4.5);
  expect(ensureContrast([10, 20, 30], light, 3)).toEqual([10, 20, 30]);
  const palette = new Uint8Array(256 * 4); palette.set([1, 2, 3, 255], 0); palette.set([9, 9, 9, 255], 20);
  const out = nodeColors(Uint32Array.from([0, 1, 1]), 1, palette, Uint32Array.from([0, 0, 1]), Uint8Array.from([10, 10, 10, 255, 20, 20, 20, 255]));
  expect([...out]).toEqual([9, 9, 9, 255, 10, 10, 10, 255, 20, 20, 20, 255]);
  expect([...nodeColors(Uint32Array.from([1]), 1, palette, undefined, undefined)]).toEqual([1, 2, 3, 255]);
});
test('effect policy, degree sizing, edge alpha, halos and label fade are bounded', () => {
  const v = defaults('t@1').visuals;
  const ok = effectPolicy(v, 16000, 44600, 6, false, true); expect(ok.curves).toBe(true); expect(ok.glow).toBe(v.glow); expect(ok.reasons).toEqual([]);
  const big = effectPolicy(v, 300000, 89200, 100, false, false); expect(big.curves).toBe(false); expect(big.segments).toBe(1); expect(big.glow).toBe(0); expect(big.additive).toBe(false); expect(big.reasons.length).toBe(3);
  const soft = effectPolicy(v, 10, 10, 1, true, true); expect([soft.glow, soft.curves, soft.halos]).toEqual([0, false, false]);
  expect(effectPolicy({ ...v, softwareEffects: true }, 10, 10, 1, true, true).curves).toBe(true);
  const sizes = degreeSizes(Uint32Array.from([0, 0, 1, 9]), 2); expect(sizes[0]).toBe(1); expect(sizes[2]).toBeCloseTo(3); expect(Math.max(...sizes)).toBeLessThanOrEqual(3);
  for (const edges of [1, 1000, 1e6]) for (const ratio of [.02, 1, 8]) for (const additive of [true, false]) { const a = edgeAlpha(v, edges, ratio, additive); expect(a).toBeGreaterThan(0); expect(a).toBeLessThanOrEqual(1); }
  expect(edgeAlpha(v, 1e6, 1, true)).toBeLessThan(edgeAlpha(v, 1000, 1, true)); expect(edgeAlpha(v, 1e5, .1, true)).toBeGreaterThan(edgeAlpha(v, 1e5, 1, true));
  // Additive cores must not saturate: per-edge ceiling stays at or below half intensity.
  expect(edgeAlpha({ ...v, edgeOpacity: 1 }, 1, 1e-4, true)).toBeLessThanOrEqual(.5); expect(edgeAlpha(v, 100, 1, true)).toBeLessThan(edgeAlpha(v, 100, 1, false));
  expect(labelFade(3, 6, 1, LABEL_RATIOS, true).alpha).toBe(0); expect(labelFade(3, 6, .1, LABEL_RATIOS, true).alpha).toBe(1);
  expect(labelFade(3, 6, .1, LABEL_RATIOS, false)).toEqual({ alpha: 1, cut: 0 });
  const positions = Float32Array.from([0, 0, 2, 0, 10, 10, 10, 12, 50, 50]), halos = groupHalos(positions, Uint8Array.from([1, 1, 1, 1, 0]), Uint32Array.from([0, 0, 1, 1, 1]), 2, 8);
  expect(halos.map(h => [h.group, h.x, h.y, h.radius, h.count])).toEqual([[0, 1, 0, 1, 2], [1, 10, 11, 1, 2]]);
  expect(groupHalos(positions, Uint8Array.from([1, 1, 1, 1, 1]), Uint32Array.from([0, 0, 1, 1, 1]), 2, 1).length).toBe(1);
});
test('GLSL minification keeps directive lines and token boundaries', () => {
  const out = minifyGlsl('const a = glsl`#version 300 es\nprecision highp float; // note\n  uniform float glow;\n void main() { float d = length(a) - 1.; }\n`;');
  expect(out).toBe('const a = glsl`#version 300 es\nprecision highp float;uniform float glow;void main(){float d=length(a)-1.;}`;');
  expect(minifyGlsl('x = `plain  text`')).toBe('x = `plain  text`');
});
import { compileTransform, deriveInput, validatePattern, validateTransform, MISSING, NO_MATCH } from '../src/core/derive';
import { validateDeclaration } from '../src/core/declaration';
import { declaredKeys } from '../src/core/columns';
test('derived transforms validate bounded inputs and reject backtracking-prone patterns', () => {
  for (const ok of [{ kind: 'segment', delimiter: ':', index: 1 }, { kind: 'segment', delimiter: '::', index: -1 }, { kind: 'prefix', delimiter: '/', segments: 2 }, { kind: 'pattern', pattern: '^([^:]+):' }, { kind: 'pattern', pattern: '^concept:(\\w{1,16})' }, { kind: 'pattern', pattern: '([A-Z]{2})-\\d+' }]) expect(() => validateTransform(ok)).not.toThrow();
  for (const bad of [{ kind: 'segment', delimiter: '', index: 0 }, { kind: 'segment', delimiter: '123456789', index: 0 }, { kind: 'segment', delimiter: ':', index: 64 }, { kind: 'prefix', delimiter: ':', segments: 0 }, { kind: 'segment', delimiter: ':', index: 0, extra: 1 }, { kind: 'split', delimiter: ':' }]) expect(() => validateTransform(bad)).toThrow();
  for (const bad of ['(a+)+', '(a|b)', 'a|b', '(?=x)a', '(?:a)', '(a)\\1', 'a*b*', 'a{0,99}', 'x'.repeat(32), '[a[b]]', '(a)(b)', '((a))', '*a', '\\p{L}', '(a']) expect(() => validatePattern(bad)).toThrow();
  // Worst admitted shape on a maximal input stays fast: one unbounded quantifier, capped input.
  const run = compileTransform({ kind: 'pattern', pattern: '^(a+)b' }), started = performance.now();
  for (let i = 0; i < 200; i++) expect(run(deriveInput('a'.repeat(400) + '!'))).toBe(NO_MATCH);
  expect(performance.now() - started).toBeLessThan(250);
});
test('derived values: segment, prefix and pattern semantics with explicit missing/no-match groups', () => {
  expect([deriveInput('x'), deriveInput(3), deriveInput(true), deriveInput(null), deriveInput(undefined), deriveInput([null, 'a', 'b']), deriveInput({}), deriveInput('y'.repeat(999))!.length]).toEqual(['x', '3', 'true', undefined, undefined, 'a', undefined, 256]);
  const seg = compileTransform({ kind: 'segment', delimiter: ':', index: 1 }), last = compileTransform({ kind: 'segment', delimiter: ':', index: -1 });
  expect([seg('concept:alpha:1'), seg('plain'), seg('a:'), seg(undefined), last('a:b:c')]).toEqual(['alpha', NO_MATCH, NO_MATCH, MISSING, 'c']);
  const pre = compileTransform({ kind: 'prefix', delimiter: ':', segments: 2 });
  expect([pre('concept:alpha:1'), pre('concept:1'), pre('a:b:c:d')]).toEqual(['concept:alpha', NO_MATCH, 'a:b']);
  const pat = compileTransform({ kind: 'pattern', pattern: '^([^:]+):' }), whole = compileTransform({ kind: 'pattern', pattern: '\\d{2}' });
  expect([pat('ns:rest'), pat('nocolon'), whole('ab12cd'), whole('x')]).toEqual(['ns', NO_MATCH, '12', NO_MATCH]);
});
test('declared and runtime derived groups agree and need no new note properties', async () => {
  const facts: FactRow[] = ['alpha', 'beta', 'alpha', 'gamma', 'beta', 'alpha'].map((ns, i) => ({ path: `Concepts/C-${i}.md`, properties: { id: i === 3 ? 'unprefixed' : `concept:${ns}:${i}` } }));
  facts.push({ path: 'Concepts/No-Id.md', properties: {} });
  const d: GraphDeclaration = { ...defaultDeclaration('t@1'), identity: [{ key: 'id' }], edges: [], groups: [{ from: 'derived', key: '$identity', transform: { kind: 'segment', delimiter: ':', index: 1 } }, { from: 'derived', key: 'id', transform: { kind: 'prefix', delimiter: ':', segments: 2 } }] };
  validateDeclaration(d); expect(migrateDeclaration(structuredClone(d))).toEqual(d);
  const p = buildProjection(facts, d), byIdentity = p.groups[0]!, byProperty = p.groups[1]!;
  expect(p.paths.map((_, i) => byIdentity.values[byIdentity.codes[i]!])).toEqual(['alpha', 'beta', 'alpha', NO_MATCH, 'beta', 'alpha', NO_MATCH]);
  expect(p.paths.map((_, i) => byProperty.values[byProperty.codes[i]!])).toEqual(['concept:alpha', 'concept:beta', 'concept:alpha', NO_MATCH, 'concept:beta', 'concept:alpha', MISSING]);
  expect(declaredKeys(d)).toEqual(['id']); expect(Object.keys(facts[0]!.properties)).toEqual(['id']);
  // Runtime: the same transform over a materialized column or built-in identity.
  const runtime = { ...d, groups: [], columns: ['id'] }, q = buildProjection(facts, runtime);
  const fromColumn = groupColumn(q, runtime, { from: 'derived', key: 'id', transform: { kind: 'prefix', delimiter: ':', segments: 2 } }, 0);
  expect(q.paths.map((_, i) => fromColumn.values[fromColumn.codes[i]!])).toEqual(p.paths.map((_, i) => byProperty.values[byProperty.codes[i]!]));
  const fromIdentity = groupColumn(q, runtime, { from: 'derived', key: '$identity', transform: { kind: 'pattern', pattern: '^concept:([a-z]+)' } }, 0);
  expect(q.paths.map((_, i) => fromIdentity.values[fromIdentity.codes[i]!])).toEqual(['alpha', 'beta', 'alpha', NO_MATCH, 'beta', 'alpha', NO_MATCH]);
  expect(() => groupColumn(q, runtime, { from: 'derived', key: 'missing', transform: { kind: 'segment', delimiter: ':', index: 0 } }, 0)).toThrow('Undeclared column');
  expect(() => validateDeclaration({ ...d, groups: [{ from: 'derived', key: '$body', transform: { kind: 'segment', delimiter: ':', index: 0 } }] })).toThrow('built-in');
  const s = defaults('obsidian-links@1.13.7'); s.declaration = d; s.explore.view = { ...emptyView(), group: { from: 'derived', key: '$path', transform: { kind: 'pattern', pattern: '^([^/]+)/' } } };
  validateSettings(s); expect(compatibilityIssues(s)).toEqual([]);
  expect(await generationKey(facts, d, DEFAULT_LAYOUT, 'p')).not.toBe(await generationKey(facts, { ...d, groups: [] }, DEFAULT_LAYOUT, 'p'));
});
test('note-derived long view text persists scanner safe and round-trips exactly', () => {
  const s = defaults('obsidian-links@1.13.7'), long = 'Research/Category-0001/Source-Material/References/Examples-ABCDEFG';
  const opaque = 'x7Qp2LmZ9vR4tB8nW1kY6cH3jF5dS0gA'.repeat(2);
  const view: ExploreView = { query: opaque, filters: [{ kind: 'eq', key: 'family', value: opaque }, { kind: 'in', key: 'family', values: [long, 'short'] }], group: { from: 'derived', key: '$path', transform: { kind: 'prefix', delimiter: '/', segments: 3 } }, hiddenGroups: [long], collapsedGroups: [opaque], hiddenColors: [], hiddenTypes: [] };
  s.explore = canonicalExplore({ ...s.explore, view, savedViews: [{ name: 'Long', view, camera: null }] });
  const written = JSON.parse(JSON.stringify({ settings: persistedSettings(s) }));
  expect(compatibilityIssues(written)).toEqual([]);
  // No persisted string anywhere has a whitespace-free run of 32 or more characters.
  (function walk(v: unknown) { if (typeof v === 'string') expect(/\S{32,}/.test(v)).toBe(false); else if (v && typeof v === 'object') Object.values(v).forEach(walk); })(written);
  expect(upgradeSettings(written.settings, 'obsidian-links@1.13.7').explore).toEqual(s.explore);
  expect(decodeText(encodeText(['a', long, { b: opaque }]))).toEqual(['a', long, { b: opaque }]);
  expect(() => decodeText({ $text: ['x'.repeat(25)] })).toThrow('Invalid encoded text');
});
test('dense webs shrink nodes by screen density and placeholder groups stay neutral', () => {
  // A small web keeps full size; a 60k web at home framing shrinks to the floor and regrows when zoomed in.
  expect(densityScale(360, 590, 600, 1, 3)).toBe(1);
  expect(densityScale(360, 590, 60600, 1, 3)).toBe(.3);
  expect(densityScale(360, 590, 60600, .1, 3)).toBeGreaterThan(densityScale(360, 590, 60600, .5, 3));
  expect(densityScale(360, 590, 60600, 1e-9, 3)).toBe(1); expect(densityScale(0, 0, 0, 1, 3)).toBe(.3);
  const palette = categorical(4, [30, 30, 30]), base = [120, 121, 122, 255];
  neutralizeGroups(palette, ['"A"', '(missing)', '(no match)', '(outside prefix)'], base);
  expect([...palette.slice(4, 8)]).toEqual([120, 121, 122, 255]); expect([...palette.slice(12, 16)]).toEqual([120, 121, 122, 255]);
  expect([...palette.slice(0, 3)]).not.toEqual([120, 121, 122]);
});
