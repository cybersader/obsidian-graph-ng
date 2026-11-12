import { test, expect } from 'bun:test';
import { buildProjection, filterNodes, colorGroups, type FactRow } from '../src/core/projection';
import { defaultDeclaration, digest, layoutDeclaration, migrateDeclaration, validatePredicate, type GraphDeclaration, type Predicate } from '../src/core/declaration';
import { canonicalView, emptyView, explore, groupColumn, validateSaved, validateView, withoutTypes, NO_COLOR, type ExploreView } from '../src/core/explore';
import { generationKey } from '../src/core/generation';
import { DEFAULT_LAYOUT } from '../src/core/layout-options';
import { canonicalExplore, decodeText, defaults, encodeText, loadSettings, persistedSettings, settingsForSave, upgradeSettings, validateSettings, validateVisuals } from '../src/settings';
import { compatibilityIssues, credentialShapedField } from './support/settings-compatibility';
import { CARRIER_SAME_ALPHA, carrierAlpha, carrierColors, carrierVisibility, categorical, contrast, degreeSizes, densityScale, edgeAlpha, effectPolicy, ensureContrast, groupHalos, labelFade, neutralizeGroups, nodeColors, parseHex } from '../src/render-effects';
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
  if (p.kind === 'expr') throw new Error('Legacy-only oracle');
  if (p.kind === 'folder') { const prefix = (Array.isArray(p.prefix) ? p.prefix.join('/') : p.prefix).replace(/\/+$/, ''); return !prefix || row.path.startsWith(prefix + '/'); }
  const has = Object.hasOwn(row.properties, p.key), v = row.properties[p.key];
  if (p.kind === 'exists') return has;
  if (!has) return false;
  return p.kind === 'eq' ? v === p.value : p.values.some(x => x === v);
}
test('filter compilation matches a brute-force oracle for eq/in/exists/folder and AND', () => {
  const input = rows(), d = declaration(), p = buildProjection(input, d), byPath = new Map(input.map(r => [r.path, r]));
  const predicates: Exclude<Predicate, { kind: 'expr' }>[] = [
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
import { compileTransform, deriveInput, validateTransform, MISSING, NO_MATCH } from '../src/core/derive';
import { validateDeclaration } from '../src/core/declaration';
import { declaredKeys } from '../src/core/columns';
test('derived transforms validate bounded inputs; regex transforms are refused entirely', () => {
  for (const ok of [{ kind: 'segment', delimiter: ':', index: 1 }, { kind: 'segment', delimiter: '::', index: -1 }, { kind: 'prefix', delimiter: '/', segments: 2 }]) expect(() => validateTransform(ok)).not.toThrow();
  for (const bad of [{ kind: 'segment', delimiter: '', index: 0 }, { kind: 'segment', delimiter: '123456789', index: 0 }, { kind: 'segment', delimiter: ':', index: 64 }, { kind: 'prefix', delimiter: ':', segments: 0 }, { kind: 'segment', delimiter: ':', index: 0, extra: 1 }, { kind: 'split', delimiter: ':' }]) expect(() => validateTransform(bad)).toThrow();
  // Review probe: these shapes once passed a restricted-regex validator and backtracked
  // exponentially ('[]?(a+)+\]': 24 chars → 219 ms, ×4 per 2 chars). No pattern kind exists now.
  for (const pattern of ['[]?(a+)+\\]', '[]?(a|aa)+\\]', '[]?(?=a)(\\w)\\1\\]', '^([^:]+):']) expect(() => validateTransform({ kind: 'pattern', pattern })).toThrow('no longer supported');
  // Split transforms stay linear on the capped input.
  const started = performance.now(), seg = compileTransform({ kind: 'prefix', delimiter: 'a', segments: 32 });
  for (let i = 0; i < 2000; i++) seg(deriveInput('a'.repeat(5000) + '!'));
  expect(performance.now() - started).toBeLessThan(250);
});
test('derived values: segment and prefix semantics with explicit missing/no-match groups', () => {
  expect([deriveInput('x'), deriveInput(3), deriveInput(true), deriveInput(null), deriveInput(undefined), deriveInput([null, 'a', 'b']), deriveInput({}), deriveInput('y'.repeat(999))!.length]).toEqual(['x', '3', 'true', undefined, undefined, 'a', undefined, 256]);
  const seg = compileTransform({ kind: 'segment', delimiter: ':', index: 1 }), last = compileTransform({ kind: 'segment', delimiter: ':', index: -1 });
  expect([seg('concept:alpha:1'), seg('plain'), seg('a:'), seg(undefined), last('a:b:c')]).toEqual(['alpha', NO_MATCH, NO_MATCH, MISSING, 'c']);
  const pre = compileTransform({ kind: 'prefix', delimiter: ':', segments: 2 });
  expect([pre('concept:alpha:1'), pre('concept:1'), pre('a:b:c:d')]).toEqual(['concept:alpha', NO_MATCH, 'a:b']);
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
  const fromIdentity = groupColumn(q, runtime, { from: 'derived', key: '$identity', transform: { kind: 'segment', delimiter: ':', index: 1 } }, 0);
  expect(q.paths.map((_, i) => fromIdentity.values[fromIdentity.codes[i]!])).toEqual(['alpha', 'beta', 'alpha', NO_MATCH, 'beta', 'alpha', NO_MATCH]);
  expect(() => groupColumn(q, runtime, { from: 'derived', key: 'missing', transform: { kind: 'segment', delimiter: ':', index: 0 } }, 0)).toThrow('Undeclared column');
  expect(() => validateDeclaration({ ...d, groups: [{ from: 'derived', key: '$body', transform: { kind: 'segment', delimiter: ':', index: 0 } }] })).toThrow('built-in');
  const s = defaults('obsidian-links@1.13.7'); s.declaration = d; s.explore.view = { ...emptyView(), group: { from: 'derived', key: '$path', transform: { kind: 'segment', delimiter: '/', index: 0 } } };
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
test('review probe: panel-reachable invalid states are never written (save validates), valid ones reload', () => {
  const cases: [string, (s: ReturnType<typeof defaults>) => void][] = [
    ['saved view name 121 chars', s => { s.explore.savedViews = [{ name: 'n'.repeat(121), view: structuredClone(s.explore.view), camera: null }]; }],
    ['collapse all over 20000 groups', s => { s.explore.view.collapsedGroups = Array.from({ length: 20001 }, (_, i) => `g${i}`); }],
    ['hide group whose key > 4096 chars', s => { s.explore.view.hiddenGroups = ['"' + 'x'.repeat(5000) + '"']; }],
    ['201 saved views', s => { s.explore.savedViews = Array.from({ length: 201 }, (_, i) => ({ name: `v${i}`, view: structuredClone(s.explore.view), camera: null })); }],
  ];
  for (const [, mutate] of cases) { const s = defaults('p@1'); mutate(s); expect(() => settingsForSave(s)).toThrow(); }
  // At the caps the same states save and reload unchanged (no quarantine/default reset).
  const s = defaults('p@1');
  s.explore.savedViews = Array.from({ length: 200 }, (_, i) => ({ name: `${'n'.repeat(110)}${i}`, view: structuredClone(s.explore.view), camera: null }));
  s.explore.view.collapsedGroups = Array.from({ length: 20000 }, (_, i) => `g${i}`); s.explore.view.hiddenGroups = ['"' + 'x'.repeat(4094) + '"'];
  const reloaded = upgradeSettings(JSON.parse(JSON.stringify(settingsForSave(s))), 'p@1');
  expect(reloaded.explore.savedViews).toHaveLength(200); expect(reloaded.explore.view.collapsedGroups).toHaveLength(20000); expect(reloaded.explore.view.hiddenGroups[0]!.length).toBe(4096);
});
test('stored regex-derived groups migrate to a visible disabled list, never silently dropped', async () => {
  const s = defaults('p@1') as any, regex = (pattern: string, key = '$identity') => ({ from: 'derived', key, transform: { kind: 'pattern', pattern } });
  s.declaration.groups = [regex('^([A-Z]+)-'), { from: 'folder', depth: 1 }]; s.groupLevel = 1;
  s.explore.view.group = regex('^(\\w+):', 'id'); s.explore.savedViews = [{ name: 'Old', view: { ...structuredClone(s.explore.view) }, camera: null }];
  const stored = { settings: { ...s, explore: encodeText(s.explore) } };
  const notices: string[] = [];
  const loaded = await loadSettings({ async stat() { return { size: 10 }; }, async read() { return JSON.stringify(stored); }, async copy() { throw new Error('must not quarantine'); } }, 'data.json', 'p@1', m => notices.push(m));
  const e = loaded.settings.explore;
  expect(e.disabledDerived.map(d => [d.location, d.key, d.pattern])).toEqual([['declared group 1', '$identity', '^([A-Z]+)-'], ['current view', 'id', '^(\\w+):'], ['saved view “Old”', 'id', '^(\\w+):']]);
  expect(loaded.settings.declaration.groups).toEqual([{ from: 'folder', depth: 1 }]); expect(loaded.settings.groupLevel).toBe(0);
  expect(e.view.group).toBeNull(); expect(e.savedViews[0]!.view.group).toBeNull();
  expect(notices).toHaveLength(1); expect(notices[0]).toContain('3 regex-derived groups were disabled');
  // Saving and reloading keeps the record (visible until dismissed) and raises no second notice.
  const again: string[] = [], text = JSON.stringify({ settings: settingsForSave(loaded.settings) });
  const reloaded = await loadSettings({ async stat() { return { size: 10 }; }, async read() { return text; }, async copy() { throw new Error('must not quarantine'); } }, 'data.json', 'p@1', m => again.push(m));
  expect(reloaded.settings.explore.disabledDerived).toHaveLength(3); expect(again).toEqual([]);
});
test('removing migrated regex groups keeps groupLevel on the same declared group, or resets it visibly', () => {
  const regex = { from: 'derived', key: '$identity', transform: { kind: 'pattern', pattern: '^(x)' } };
  const groups = [{ from: 'folder', depth: 1 }, regex, { from: 'key', key: 'family' }, regex, { from: 'folder', depth: 2 }];
  const load = (groupLevel: number) => { const s = defaults('p@1') as any; s.declaration = { ...s.declaration, columns: ['family'], groups: structuredClone(groups) }; s.groupLevel = groupLevel; return upgradeSettings(s, 'p@1'); };
  const kept = [{ from: 'folder', depth: 1 }, { from: 'key', key: 'family' }, { from: 'folder', depth: 2 }];
  for (const [level, expected] of [[0, 0], [2, 1], [4, 2]] as const) {
    const s = load(level); expect(s.declaration.groups).toEqual(kept as any);
    expect(s.declaration.groups[s.groupLevel]).toEqual(groups[level] as any); expect(s.groupLevel).toBe(expected);
  }
  const reset = load(3);
  expect(reset.groupLevel).toBe(0);
  expect(reset.explore.disabledDerived.map(d => d.location)).toEqual(['declared group 2', 'declared group 4 (was the selected group level; reset to the first group)']);
});

test('edge notes are flagged per node only in literal display', () => {
  const d: GraphDeclaration = { ...defaultDeclaration('t@1'), identity: [{ key: 'id' }], edges: [{ name: 'm', kind: 'reified', sourceProperty: 's', targetProperty: 'o' }] };
  const facts: FactRow[] = [{ path: 'a.md', properties: { id: 'a' } }, { path: 'b.md', properties: { id: 'b' } }, { path: 'm.md', properties: { id: 'm', s: 'a', o: 'b' } }];
  expect([...buildProjection(facts, d).carrierNodes]).toEqual([0, 0]);
  const literal = buildProjection(facts, { ...d, display: { reifiedAsNodes: true } });
  expect(literal.paths).toEqual(['a.md', 'b.md', 'm.md']); expect([...literal.carrierNodes]).toEqual([0, 0, 3]);
  expect([...literal.carrier].map(c => c + 1)).toEqual([3, 3]);
});
test('edge-note colour derives from endpoint colours: same colour, blend or source bridge with accent', () => {
  // Nodes 0,1 red; 2 blue; 3 grey (no endpoint); carriers 4 (0->1 same), 5 (0->2 bridge), 6 (isolated), 7 (2->0 bridge).
  const rgb = [[200, 0, 0], [200, 0, 0], [0, 0, 200], [9, 9, 9], [1, 1, 1], [1, 1, 1], [7, 7, 7], [1, 1, 1]];
  const make = () => Uint8Array.from(rgb.flatMap(c => [...c, 255]));
  // carrierNodes hold 1 + the note's own carrier row; every edge here belongs to its note.
  const carriers = Uint32Array.from([0, 0, 0, 0, 5, 6, 7, 8]);
  const source = Uint32Array.from([0, 4, 0, 5, 2, 7]), target = Uint32Array.from([4, 1, 5, 2, 7, 0]), carrier = Uint32Array.from([4, 4, 5, 5, 7, 7]);
  const at = (c: Uint8Array, i: number) => [...c.subarray(i * 4, i * 4 + 4)];
  let c = make();
  expect(carrierColors(carriers, source, target, carrier, c, 'blend', [255, 255, 255], 0)).toBe(2);
  expect(at(c, 4)).toEqual([200, 0, 0, CARRIER_SAME_ALPHA]);
  expect(at(c, 5)).toEqual([100, 0, 100, 255]); expect(at(c, 7)).toEqual([100, 0, 100, 255]);
  expect(at(c, 6)).toEqual([7, 7, 7, CARRIER_SAME_ALPHA]);
  expect(at(c, 0)).toEqual([200, 0, 0, 255]);
  c = make(); carrierColors(carriers, source, target, carrier, c, 'source', [255, 255, 255], 0);
  expect(at(c, 5)).toEqual([200, 0, 0, 255]); expect(at(c, 7)).toEqual([0, 0, 200, 255]);
  c = make(); carrierColors(carriers, source, target, carrier, c, 'source', [0, 255, 0], .5);
  expect(at(c, 5)).toEqual([100, 128, 0, 255]); expect(at(c, 4)).toEqual([200, 0, 0, CARRIER_SAME_ALPHA]);
  // Edge notes chained to edge notes take no colour from each other; no carriers is a no-op.
  c = make(); expect(carrierColors(new Uint32Array(8), source, target, carrier, c, 'blend', [0, 0, 0], 1)).toBe(0); expect(c).toEqual(make());
});
test('edge-note level of detail: shown zoomed in, folded zoomed out, smooth between, off when disabled', () => {
  expect(carrierVisibility(.1, .3, .6, true)).toBe(1); expect(carrierVisibility(.3, .3, .6, true)).toBe(1);
  expect(carrierVisibility(.6, .3, .6, true)).toBe(0); expect(carrierVisibility(1, .3, .6, true)).toBe(0);
  const mid = carrierVisibility(Math.sqrt(.18), .3, .6, true); expect(mid).toBeCloseTo(.5, 6);
  let last = 1; for (let z = .3; z <= .6; z += .01) { const v = carrierVisibility(z, .3, .6, true); expect(v).toBeLessThanOrEqual(last + 1e-12); last = v; }
  for (const z of [1e-9, .45, 1, 8]) expect(carrierVisibility(z, .3, .6, false)).toBe(1);
  const v = defaults('t@1').visuals;
  expect(carrierAlpha(v, 44600, 1)).toBe(0); expect(carrierAlpha({ ...v, carrierLod: false }, 44600, 1)).toBeGreaterThan(0);
  expect(carrierAlpha(v, 44600, .1)).toBeGreaterThan(carrierAlpha(v, 44600, .25));
  expect(carrierAlpha({ ...v, carrierLod: false }, 100, 1)).toBeCloseTo(v.carrierOpacity, 6);
  expect(carrierAlpha({ ...v, carrierLod: false }, 1e6, 1)).toBeLessThan(carrierAlpha({ ...v, carrierLod: false }, 1e4, 1));
  for (const n of [0, 1, 1e7]) for (const z of [1e-6, .2, .5, 8]) { const a = carrierAlpha({ ...v, carrierLod: false }, n, z); expect(a).toBeGreaterThanOrEqual(.1); expect(a).toBeLessThanOrEqual(1); }
});
test('edge-note visual settings validate', () => {
  const v = defaults('t@1').visuals; expect(() => validateVisuals(v)).not.toThrow();
  for (const bad of [{ carrierBridge: 'mix' }, { carrierSize: 0 }, { carrierSize: 5 }, { carrierLodNear: .6, carrierLodFar: .6 }, { carrierLodNear: 0 }, { carrierLodFar: 9 }, { carrierSize: '2' }, { carrierLodNear: '.3' }, { carrierOpacity: 1.5 }, { carrierLod: 1 }, { carrierDensityReference: -1 }])
    expect(() => validateVisuals({ ...v, ...bad })).toThrow();
  const old = structuredClone(defaults('t@1')) as any; for (const k of Object.keys(old.visuals)) if (k.startsWith('carrier')) delete old.visuals[k];
  expect(upgradeSettings(old, 't@1').visuals).toEqual(v);
});
test('edge-note colour uses only its own relationship, not inline links touching the note', () => {
  const d: GraphDeclaration = { ...defaultDeclaration('t@1'), identity: [{ key: 'id' }], display: { reifiedAsNodes: true },
    edges: [{ name: 'm', kind: 'reified', sourceProperty: 's', targetProperty: 'o' }, { name: 'see', kind: 'inline', key: 'see', type: 'see' }] };
  // red -> red relationship note with an extra inline link to a blue note.
  const facts: FactRow[] = [{ path: 'a.md', properties: { id: 'a' } }, { path: 'b.md', properties: { id: 'b' } }, { path: 'c.md', properties: { id: 'c' } }, { path: 'm.md', properties: { id: 'm', s: 'a', o: 'b', see: 'c' } }];
  const p = buildProjection(facts, d); expect(p.paths).toEqual(['a.md', 'b.md', 'c.md', 'm.md']); expect(p.source.length).toBe(3);
  const colors = Uint8Array.from([200, 0, 0, 255, 200, 0, 0, 255, 0, 0, 200, 255, 9, 9, 9, 255]);
  expect(carrierColors(p.carrierNodes, p.source, p.target, p.carrier, colors, 'blend', [255, 255, 255], .35)).toBe(0);
  expect([...colors.subarray(12)]).toEqual([200, 0, 0, CARRIER_SAME_ALPHA]);
});
test('a density reference of 0 disables thinning for edge notes and edges', () => {
  const v = { ...defaults('t@1').visuals, carrierLod: false };
  expect(carrierAlpha({ ...v, carrierDensityReference: 0 }, 1e6, 1)).toBeCloseTo(v.carrierOpacity, 6);
  expect(carrierAlpha(v, 1e6, 1)).toBeLessThan(v.carrierOpacity);
  expect(edgeAlpha({ ...v, edgeDensityReference: 0 }, 1e6, 1, false)).toBeCloseTo(edgeAlpha(v, 1, 1, false), 6);
});
