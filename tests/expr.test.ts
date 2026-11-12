/** SPDX-License-Identifier: MIT */
import { test, expect } from 'bun:test';
import { build } from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { expressionBuild } from '../scripts/expression-build.mjs';
import { checked, check, FUNCTIONS, EXPR_LIMITS, parse, print, validate } from '../src/core/expr/syntax';
import { suggestions } from '../src/core/expr/autocomplete';
import { compile, editAsExpression, evaluate, expressionFilter, expressionGroup, groupIdentity, lowerGroup, lowerPredicate, plan, predicateIdentity } from '../src/core/expr/engine';
import { canonical, folderPath, defaultDeclaration, digest, layoutDeclaration, validateDeclaration, validatePredicate, type GraphDeclaration, type GroupSource, type Predicate, type Scalar } from '../src/core/declaration';
import { buildProjection, filterNodes, colorGroups, type FactRow, type Projection } from '../src/core/projection';
import { groupColumn, emptyView, explore, validateView } from '../src/core/explore';
import { compileTransform, deriveInput } from '../src/core/derive';
import { declaredKeys, packRows, unpackRows } from '../src/core/columns';
import { declaredFacts, generationKey } from '../src/core/generation';
import { DEFAULT_LAYOUT } from '../src/core/layout';
import { defaults, encodeText, settingsForSave, upgradeSettings } from '../src/settings';
import { WorkerPipeline, type Transport } from '../src/pipeline';
function legacyFilter(p: Projection, predicate?: Exclude<Predicate, { kind: 'expr' }>): Uint8Array {
  const bits = new Uint8Array(p.paths.length);
  if (!predicate) { bits.fill(1); return bits; }
  if (predicate.kind === 'folder') {
    const range = p.folders.get(folderPath(predicate.prefix));
    if (range) bits.fill(1, range[0], range[1]);
  } else {
    const c = p.columns[predicate.key];
    if (!c) throw new Error(`Undeclared column: ${predicate.key}; add it to columns`);
    // Compile to dictionary codes once; the node loop is a typed-array lookup.
    const wanted = new Uint8Array(c.values.length + 1);
    if (predicate.kind === 'eq') { const code = c.values.indexOf(canonical(predicate.value)); if (code >= 0) wanted[code] = 1; }
    else if (predicate.kind === 'in') for (const v of predicate.values) { const code = c.values.indexOf(canonical(v)); if (code >= 0) wanted[code] = 1; }
    else { wanted.fill(1); const missing = c.values.indexOf('undefined'); if (missing >= 0) wanted[missing] = 0; }
    for (let i = 0; i < bits.length; i++) bits[i] = wanted[c.codes[i]!]!;
  }
  return bits;
}

const examples = [
  'note.category == "Example"', 'file.inFolder("Notes/Example") && !file.hasProperty("archived")', 'note.status.lower().startsWith("open")', 'if(note.priority > 2, "high", "low")',
  'note["x y"]', 'note["my-key"]', 'note["类别"]', 'file.path', 'file.name', 'file.basename', 'file.folder', 'file.ext', 'node.identity', 'node.degree',
  'note.n.toString() == "1"', 'number(note.n)', 'note.id.segment(":", 0)', 'file.path.prefix("/", 2)', 'note.id.startsWith("ABC-")', 'note.id.containsAny("x", "y")', 'note.id.replace(".v2", "")', '["a", "b"].contains(note.k)',
  'file.hasProperty("k")', 'file.inFolder("A/B")', 'true', 'note.k', 'note.k.segment(":", -1)', 'coalesce(note.a, note.b, "other")', 'if(true, 1)',
  'max(1, 2)', 'min(1, 2)', 'list(note.k).slice(-2).join(", ")', 'note.k.isTruthy()', 'note.k.isEmpty()', 'note.k.isType("string")', 'note.k.upper().trim().length',
  'note.k.containsAll("a", "b")', 'note.k.endsWith("b")', 'note.k.slice(1, 2)', 'note.k.split(":", 3)[-1]', 'note.k.abs().floor().ceil().round(2)', '1 + 2 * 3 / 4 % 2 - -2', '!note.k == null',
];
test('all slice-1 design examples parse and print canonically', () => {
  for (const source of examples) { const ast = checked(source); expect(print(parse(print(ast)))).toBe(print(ast)); }
});
test('canonical printer is idempotent on a deterministic generated corpus', () => {
  const atoms = ['note.x', 'note["space key"]', '1', '-2', '0.00000001', '1000000000000000000000', '"a\\n\\t\\u000d\\u0008\\u000c"', 'null', 'true'];
  for (let i = 0; i < 300; i++) {
    const a = atoms[i % atoms.length]!, b = atoms[(i * 7 + 2) % atoms.length]!;
    const source = i % 3 === 0 ? `if(${a} == ${b}, ${a}, ${b})` : i % 3 === 1 ? `coalesce(${a}, ${b}).toString()` : `${a} != ${b}`;
    const first = print(checked(source)); expect(print(checked(first))).toBe(first);
  }
});
test('refusals are positioned errors and validator never throws', () => {
  const refused = ['/a+/', 'note.x.matches("a")', 'eval', 'eval("1")', 'x.constructor', '__proto__', 'note["__proto__"]', 'note.x.unknown()', 'this.x', 'random()', 'now()', 'date("2026-01-01")', 'formula.x', 'edge.type', 'note.x = 1', 'note.x and true', 'note.x.split(note.y)', 'note.x.replace(/a/, "b")', '[' + 'note.x' + ']', 'note.x < 2 < 3', '"' + 'a'.repeat(257) + '"', 'a'.repeat(2049), '('.repeat(33) + 'true' + ')'.repeat(33), Array(257).fill('true').join(' || '), 'note.x' + '.lower()'.repeat(33)];
  for (const source of refused) { let result; expect(() => { result = validate(source); }).not.toThrow(); expect(result!.ok).toBe(false); expect(result!.errors[0]!.pos).toBeGreaterThanOrEqual(0); }
  expect(validate('[' + Array(10001).fill('0').join(',') + '] .length').ok).toBe(false);
  expect(validate('[1, 2]', 'filter').errors[0]!.message).toContain('true/false');
});
test('n-ary logic flattens and exactly 256 final AST nodes are allowed', () => {
  const ast = checked(Array(255).fill('true').join(' || ')); expect(ast.kind === 'op' && ast.args.length).toBe(255);
  expect(validate(Array(256).fill('true').join(' || ')).ok).toBe(false);
  expect(validate('note.a' + Array.from({ length: 16 }, (_, i) => ` + note.b${i}`).join('')).ok).toBe(false);
});
const ctx = (properties: Record<string, any> = {}) => ({ property: (name: string) => properties[name], path: 'Notes/Example/Item.md', identity: 'Example:A', degree: 3 });
const run = (source: string, properties = {}) => evaluate(checked(source), ctx(properties));
test('whitelisted scalar, list, numeric, text and file operations are pure and total', () => {
  const cases: [string, any][] = [['1 + 2 * 3', 7], ['1 / 0', null], ['number("2")', 2], ['number("bad")', null], ['min(2, 1)', 1], ['max(1, 2)', 2], ['(-2).abs()', 2], ['1.45.round(1)', 1.5], ['list(2)[-1]', 2], ['[1, 2][9]', null], ['[1, "1"].contains(true)', false], ['[1, 2].containsAll(1, 2)', true], ['[1, 2].containsAny(9, 2)', true], ['[1, 2].slice(1).join(":")', '2'], ['"ABC".lower().upper()', 'ABC'], ['" a ".trim()', 'a'], ['"aa".replace("a", "$&")', '$&$&'], ['"a:b".split(":")[-1]', 'b'], ['"abc".slice(1, 2)', 'b'], ['"abc".containsAll("a", "c")', true], ['"abc".endsWith("bc")', true], ['true.isType("boolean")', true], ['[].isEmpty()', true], ['[1].isTruthy()', true], ['file.name', 'Item.md'], ['file.basename', 'Item'], ['file.ext', 'md'], ['file.folder', 'Notes/Example'], ['file.inFolder("Notes/Exam")', false], ['file.inFolder("Notes/Example")', true], ['if(false, 1)', null], ['coalesce(note.absent, null, "fallback")', 'fallback']];
  for (const [source, expected] of cases) expect(run(source)).toEqual(expected);
});
test('null remains distinct from absent, except at legacy segment/prefix coercion', () => {
  expect(run('note.k == null', { k: null })).toBe(true); expect(run('note.k == null')).toBe(false); expect(run('note.k != null')).toBe(false);
  expect(run('[null].contains(note.k)', { k: null })).toBe(true); expect(run('[null].contains(note.k)')).toBe(false);
  expect(run('file.hasProperty("k")', { k: null })).toBe(true);
  expect(run('note.k.segment(":", 0)', { k: null })).toBeUndefined(); expect(run('note.k.prefix(":", 1)', { k: null })).toBeUndefined();
  expect(run('note.k.lower()', { k: null })).toBeNull(); expect(run('note.k.segment(":", 9)', { k: 'a:b' })).toBeNull();
  expect(run('note.k == "1"', { k: 1 })).toBe(false); expect(run('note.k.toString() == "1"', { k: 1 })).toBe(true);
});
test('string input/output and list work are capped independently of program literals', () => {
  const long = 'x'.repeat(100000); expect((run('note.k.upper()', { k: long }) as string).length).toBe(4096);
  expect((run('note.k.replace("x", "yyyy")', { k: long }) as string).length).toBe(4096);
  expect((run('note.k.join("xx")', { k: Array(10000).fill(long) }) as string).length).toBe(4096);
  expect(run('note.k.segment(":", -1)', { k: 'a'.repeat(256) + ':b' })).toBeNull();
});
function fixture(): { d: GraphDeclaration; rows: FactRow[] } {
  const values = [undefined, null, 1, '1', true, false, '', 'A:B:C', 'A::C', ['A:B', 1], [], [null], 'É:中', 'x'.repeat(257)];
  return { d: { ...defaultDeclaration('test@1'), columns: ['k', 'other'] }, rows: values.map((v, i) => ({ path: `${i % 2 ? 'Notes/Sub' : 'Archive'}/${String(i).padStart(2, '0')}.md`, properties: v === undefined ? { other: i } : { k: v, other: i } })) };
}
test('structured predicate compile path matches independent legacy masks for all scalar types', () => {
  const { d, rows } = fixture(), p = buildProjection(rows, d);
  const predicates: Exclude<Predicate, { kind: 'expr' }>[] = [ ...[null, 1, '1', true, false, '', 'É:中', 'x'.repeat(257)].map(value => ({ kind: 'eq' as const, key: 'k', value })), { kind: 'in', key: 'k', values: [null, 1, 'A:B:C'] }, { kind: 'in', key: 'k', values: [] }, { kind: 'in', key: 'other', values: Array.from({ length: 10000 }, (_, i) => i) }, { kind: 'exists', key: 'k' }, { kind: 'folder', prefix: ['Notes', 'Sub'] }, { kind: 'folder', prefix: [] } ];
  for (const predicate of predicates) {
    validatePredicate(predicate); expect(expressionFilter(p, lowerPredicate(predicate))).toEqual(legacyFilter(p, predicate)); expect(filterNodes(p, predicate)).toEqual(legacyFilter(p, predicate));
    const editable = editAsExpression(predicate);
    if (editable.text) { expect(expressionFilter(p, checked(editable.text, 'filter'))).toEqual(filterNodes(p, predicate)); expect(predicateIdentity({ kind: 'expr', expr: editable.text })).toEqual(predicateIdentity(predicate)); }
    else expect(editable.reason).toContain('Too large');
  }
});
test('all legacy segment/prefix groups match independent legacy labels including null, lists and negatives', () => {
  const { d, rows } = fixture(), p = buildProjection(rows, d), byPath = new Map(rows.map(r => [r.path, r]));
  for (const key of ['k', '$path', '$identity']) for (const transform of [{ kind: 'segment' as const, delimiter: ':', index: 0 }, { kind: 'segment' as const, delimiter: ':', index: -1 }, { kind: 'prefix' as const, delimiter: ':', segments: 1 }, { kind: 'prefix' as const, delimiter: '/', segments: 2 }]) {
    const source = { from: 'derived' as const, key, transform }, ast = lowerGroup(source), g = expressionGroup(p, ast), legacy = compileTransform(transform);
    const expected = p.paths.map((path, i) => legacy(key === '$path' ? path.slice(0, 256) : key === '$identity' ? p.identities[i]!.slice(0, 256) : deriveInput(byPath.get(path)!.properties.k)));
    expect(p.paths.map((_, i) => g.values[g.codes[i]!])).toEqual(expected);
    const text = editAsExpression(source).text!; expect(expressionGroup(p, checked(text))).toEqual(g); expect(groupIdentity({ from: 'expr', expr: text })).toEqual(groupIdentity(source));
    const declared = buildProjection(rows, { ...d, columns: [], groups: [source] }); expect(declared.groups[0]).toEqual(g);
  }
});
test('direct property groups preserve raw typed dictionaries and folder-depth stays built in', () => {
  const { d, rows } = fixture(), p = buildProjection(rows, d), source = { from: 'key' as const, key: 'k' };
  expect(expressionGroup(p, lowerGroup(source))).toEqual({ ...p.columns.k!, encoded: true });
  expect(groupColumn(p, d, { from: 'expr', expr: 'note.k' }, 0)).toEqual(groupColumn(p, d, source, 0));
  expect(editAsExpression({ from: 'folder', depth: 2 }).reason).toContain('built-in');
});
test('expression references automatically materialize declaration properties including presence checks', () => {
  const d = { ...defaultDeclaration('test@1'), groups: [{ from: 'expr' as const, expr: 'coalesce(note.category, note["space key"])' }], colors: [{ name: 'Open', color: '#123456', predicate: { kind: 'expr' as const, expr: 'file.hasProperty("status") && note.priority > 2' } }] };
  validateDeclaration(d); expect(declaredKeys(d)).toEqual(['category', 'priority', 'space key', 'status']);
  const rows = [{ path: 'A.md', properties: { category: 'A', status: null, priority: 3, ignored: true } }];
  const restored = unpackRows(packRows(rows, d)); expect(restored[0]!.properties.ignored).toBeUndefined(); const p = buildProjection(restored, d); expect(colorGroups(p, d)).toEqual(new Uint32Array([0]));
});
test('expression filters/groups/colour rules flow through the same explore authority', () => {
  const { d, rows } = fixture(); d.colors = [{ name: 'Typed', color: '#123456', predicate: { kind: 'expr', expr: 'note.k == 1' } }];
  const p = buildProjection(rows, d), colors = colorGroups(p, d), view = { ...emptyView(), filters: [{ kind: 'expr' as const, expr: 'note.other >= 2 && note.other <= 6' }], group: { from: 'expr' as const, expr: 'if(note.other > 4, "high", "low")' } }; validateView(view);
  const result = explore(p, d, view, colors, 0, { facetValues: 20 }); expect(result.matched).toBe(5); expect(result.groupKeys).toEqual(['high', 'low']);
});
test('declaration expressions persist canonically as short text chunks and reload exactly', () => {
  const s = defaults('test@1'), source = print(checked(`note.k == "${'z'.repeat(200)}"`, 'filter'));
  s.declaration.colors = [{ name: 'Long literal', color: '#123456', predicate: { kind: 'expr', expr: source } }];
  s.declaration.groups = [{ from: 'expr', expr: 'note.category.lower()' }];
  const stored = settingsForSave(s), expression = (stored.declaration as any).colors[0].predicate.expr;
  expect(expression.$text.every((chunk: string) => chunk.length <= 24)).toBe(true);
  const json = JSON.stringify(stored, null, 2); expect(/\S{32,}/.test(JSON.stringify(expression, null, 2))).toBe(false); expect(/"[^"\n]*Key"\s*:/.test(json)).toBe(false);
  expect(upgradeSettings(JSON.parse(json), 'test@1').declaration.colors[0]!.predicate).toEqual({ kind: 'expr', expr: source });
  s.declaration.colors[0]!.predicate = { kind: 'expr', expr: 'eval("1")' }; expect(() => settingsForSave(s)).toThrow();
  s.declaration.colors[0]!.predicate = { kind: 'eq', key: 'k', value: 'z'.repeat(257) }; expect(upgradeSettings(settingsForSave(s), 'test@1').declaration.colors[0]!.predicate).toEqual(s.declaration.colors[0]!.predicate);
});
test('legacy entries survive save/load without rewriting; conversion only fits capped text', () => {
  const s = defaults('test@1'); s.explore.view.filters = [{ kind: 'in', key: 'k', values: Array.from({ length: 10000 }, (_, i) => i) }];
  const loaded = upgradeSettings(settingsForSave(s), 'test@1'); expect(loaded.explore.view.filters).toEqual(s.explore.view.filters);
  expect(editAsExpression(s.explore.view.filters[0]!).text).toBeUndefined(); expect(editAsExpression({ kind: 'eq', key: 'k', value: 'x'.repeat(257) }).reason).toContain('builder');
});
test('compiled cache identities preserve historical bytes and expression twins never relayout', async () => {
  const { d, rows } = fixture(); d.groups = [{ from: 'derived', key: 'k', transform: { kind: 'segment', delimiter: ':', index: -1 } }];
  const legacy = layoutDeclaration(d), expected = await digest({ declaration: legacy, layout: DEFAULT_LAYOUT, producer: 'fixture', rows: declaredFacts(rows, legacy) });
  expect(await generationKey(rows, d, DEFAULT_LAYOUT, 'fixture')).toBe(expected);
  const twin = { ...d, groups: [{ from: 'expr' as const, expr: 'note.k.segment(":", -1)' }], colors: [{ name: 'Typed', color: '#123456', predicate: { kind: 'expr' as const, expr: 'note.k == null' } }] };
  expect(await generationKey(rows, twin, DEFAULT_LAYOUT, 'fixture')).toBe(expected);
  expect(predicateIdentity({ kind: 'eq', key: 'k', value: -1 })).toEqual(predicateIdentity({ kind: 'expr', expr: 'note.k == -1' }));
});
test('autocomplete includes known Unicode keys, facts and type-specific methods', () => {
  expect(suggestions('', ['status', 'space key'])).toContain('note["space key"]'); expect(suggestions('', [])).toContain('node.degree');
  expect(suggestions('node.degree.', [])).toContain('node.degree.abs('); expect(suggestions('node.degree.', [])).not.toContain('node.degree.lower(');
});
function pipeline() { return new WorkerPipeline(new Worker(new URL('../src/layout-worker.ts', import.meta.url).href) as unknown as Transport, () => 30000); }
test('two isolated worker instances return identical expression counts and group values', async () => {
  const { d, rows } = fixture(), workers = [pipeline(), pipeline()];
  try {
    const results = await Promise.all(workers.map(async p => { await p.request(1, { kind: 'configure', config: { declaration: d, layout: DEFAULT_LAYOUT, source: 'test/local', groupLevel: 0, streamEveryIterations: 5 } }); await p.request(1, { kind: 'rows', columns: packRows(rows, d), reset: true }); await p.request(1, { kind: 'project' }); const counts = await p.request(1, { kind: 'expression-count', expr: 'note.k == null || note.k == 1', context: 'filter' }); const group = await p.request(1, { kind: 'expression-count', expr: 'note.k.segment(":", -1)', context: 'group' }); const detail = await p.request(1, { kind: 'detail' }); expect(await p.request(2, { kind: 'expression-count', expr: 'true', context: 'filter' }).catch(String)).toContain('Projection generation changed'); return { counts, group, detail }; }));
    expect(results[0]).toEqual(results[1]);
  } finally { workers.forEach(p => p.dispose()); }
});

test('mixed-column kernels match the scalar oracle including Missing branches and dynamic folders', () => {
  const { d, rows } = fixture(), p = buildProjection(rows, d), byPath = new Map(rows.map(row => [row.path, row]));
  for (const source of ['if(note.other > 2, note.k, note.absent)', 'coalesce(note.k, note.other)', 'file.inFolder(note.k)', 'file.inFolder("Notes/Sub")', 'note.k == note.other']) {
    const declaration = { ...d, columns: [...d.columns, 'absent'] }, projection = buildProjection(rows, declaration), ast = checked(source), kernel = compile(ast, projection);
    for (let i = 0; i < projection.paths.length; i++) expect(kernel.at(i)).toEqual(evaluate(ast, { property: name => byPath.get(projection.paths[i]!)!.properties[name] as any, path: projection.paths[i]!, identity: projection.identities[i]!, degree: projection.offsets[i+1]! - projection.offsets[i]! }));
  }
  expect(validate('note.k.isType("date")').ok).toBe(false); expect(run('note.k.isType(note.type)', {k: 1, type: 'number'})).toBe(true);
});

test('save refuses oversized encoded views while preserving uncapped legacy declaration literals', () => {
  const s = defaults('test@1');
  s.explore.view.filters = [{ kind: 'eq', key: 'k', value: 'x'.repeat(100000) }];
  expect(() => settingsForSave(s)).toThrow('Invalid encoded text');
  s.explore.view.filters = []; s.declaration.colors = [{ name: 'Large legacy', color: '#123456', predicate: { kind: 'eq', key: 'k', value: 'x'.repeat(100000) } }];
  expect(upgradeSettings(settingsForSave(s), 'test@1').declaration.colors).toEqual(s.declaration.colors);
});

test('canonical printing does not double bounded unary nesting or alter precedence', () => {
  for (const source of ['-'.repeat(31) + '1', '!'.repeat(31) + 'true', '10 - (5 - 2)', '(1 < 2) == (2 < 3)', '!(1 == 2) && true', '(-2).abs()']) {
    const ast = checked(source), canonical = print(ast); expect(validate(canonical).ok).toBe(true); expect(print(checked(canonical))).toBe(canonical); expect(evaluate(checked(canonical), ctx())).toEqual(evaluate(ast, ctx()));
  }
});

function expensiveExpression(filter = false) { const source = `coalesce(${Array.from({ length: 16 }, (_, i) => 'note.k' + '.lower().upper().trim()'.repeat(4) + ['.lower()', '.upper()', '.trim()'].slice(0, i === 15 ? filter ? 1 : 2 : 3).join('')).join(', ')})`; return source + (filter ? '.isTruthy()' : ''); }
const cancellationReceipt: Record<string, unknown> = { nodes: 5000, inputUnits: 4096, astNodes: 256, packagedWorker: true };
let productionSource: Promise<string> | undefined;
async function packagedWorker() {
  productionSource ??= (async () => {
    const shared = await expressionBuild();
    const options = { plugins: [shared.plugin(true)], entryPoints: ['src/layout-worker.ts'], bundle: true, minify: true, format: 'iife' as const, platform: 'browser' as const, write: false, target: 'es2022', charset: 'utf8' as const };
    let result = await build(options);
    await shared.trim([result.outputFiles![0]!.text, await readFile('main.js', 'utf8')]); result = await build(options);
    return shared.workerSource() + result.outputFiles![0]!.text;
  })();
  const url = URL.createObjectURL(new Blob([await productionSource], { type: 'text/javascript' }));
  return { worker: new Worker(url), cleanup: () => URL.revokeObjectURL(url) };
}
async function cancellationFixture() {
  const { worker, cleanup } = await packagedWorker();
  const p = new WorkerPipeline(worker as unknown as Transport, () => 30000, cleanup);
  const d = { ...defaultDeclaration('test@1'), columns: ['k'] };
  const rows = Array.from({ length: 5000 }, (_, i) => ({ path: `N/${i}.md`, properties: { k: 'A'.repeat(4080) + String(i).padStart(16, '0') } }));
  await p.request<any>(1, { kind: 'configure', config: { declaration: d, layout: DEFAULT_LAYOUT, source: 'synthetic/cancel', groupLevel: 0, streamEveryIterations: 5 } });
  await p.request<any>(1, { kind: 'rows', columns: packRows(rows, d), reset: true }); await p.request<any>(1, { kind: 'project' });
  return { p, worker, n: rows.length };
}
test('a newer count cooperatively cancels in-progress worst-shape work without restarting the worker', async () => {
  const { p, worker, n } = await cancellationFixture();
  try {
    let acknowledge!: () => void;
    const started = new Promise<void>(resolve => { acknowledge = resolve; }), original = worker.onmessage!;
    worker.onmessage = event => { original.call(worker, event); if (event.data.kind === 'started') acknowledge(); };
    const old = p.request<any>(1, { kind: 'expression-count', expr: expensiveExpression(), context: 'group' }).catch(String);
    await started; const start = performance.now();
    const latest = await p.request<any>(1, { kind: 'expression-count', expr: 'true', context: 'filter' });
    expect(await old).toContain('Expression superseded'); expect(latest).toEqual({ matched: n, total: n });
    const elapsed = performance.now() - start; expect(elapsed).toBeLessThan(2000); cancellationReceipt.countMs = elapsed;
    expect(await p.request<any>(1, { kind: 'expression-count', expr: 'note.k.isTruthy()', context: 'filter' })).toEqual(latest);
  } finally { p.dispose(); }
});
test('configurable count and applied-filter budgets abort before view mutation and retain usable state', async () => {
  const { p, n } = await cancellationFixture();
  try {
    const before = await p.request<any>(1, { kind: 'detail' });
    expect(await p.request<any>(1, { kind: 'expression-count', expr: expensiveExpression(), context: 'group', budgetMs: 1 }).catch(String)).toContain('Expression time budget exceeded');
    const view = { ...emptyView(), filters: [{ kind: 'expr' as const, expr: expensiveExpression(true) }] };
    expect(await p.request<any>(1, { kind: 'explore', view, facetValues: 50, budgetMs: 1 }).catch(String)).toContain('Expression time budget exceeded');
    expect(await p.request<any>(1, { kind: 'detail' })).toEqual(before); cancellationReceipt.budgetMs = 1; cancellationReceipt.budgetPreservesView = true;
    expect(await p.request<any>(1, { kind: 'expression-count', expr: 'true', context: 'filter' })).toEqual({ matched: n, total: n });
  } finally { p.dispose(); }
});
test('newer applied filters cancel cooperatively without committing stale view state', async () => {
  const { p, worker, n } = await cancellationFixture();
  try {
    let acknowledge!: () => void; const started = new Promise<void>(resolve => { acknowledge = resolve; }), original = worker.onmessage!;
    worker.onmessage = event => { original.call(worker, event); if (event.data.kind === 'started') acknowledge(); };
    const slow = { ...emptyView(), filters: [{ kind: 'expr' as const, expr: expensiveExpression(true) }] };
    const old = p.request<any>(1, { kind: 'explore', view: slow, facetValues: 50 }).catch(String);
    await started; const start = performance.now();
    const latest: any = await p.request<any>(1, { kind: 'explore', view: emptyView(), facetValues: 50 });
    expect(await old).toContain('Expression superseded'); expect(latest.explore.matched).toBe(n); expect(latest.view).toBe(2);
    const elapsed = performance.now() - start; expect(elapsed).toBeLessThan(2000); cancellationReceipt.filterMs = elapsed;
    await mkdir('.workspace/evidence', { recursive: true }); await writeFile('.workspace/evidence/expression-cancellation.json', JSON.stringify(cancellationReceipt, null, 2) + '\n');
  } finally { p.dispose(); }
});

test('shared presence kernels retain historical non-scalar property presence', () => {
 const d = { ...defaultDeclaration('test@1'), columns: ['k'] }, p = buildProjection([{ path: 'A.md', properties: { k: { nested: 1 } } }, { path: 'B.md', properties: {} }], d);
 const predicate = { kind: 'exists' as const, key: 'k' };
 expect(expressionFilter(p, lowerPredicate(predicate))).toEqual(legacyFilter(p, predicate));
 expect(filterNodes(p, predicate)).toEqual(new Uint8Array([1, 0]));
 expect(expressionFilter(p, checked('if(file.hasProperty("k"), true, false)', 'filter'))).toEqual(new Uint8Array([1, 0]));
 expect(expressionFilter(p, checked('file.hasProperty("k") && node.degree == 0', 'filter'))).toEqual(new Uint8Array([1, 0]));
});

test('callable docs and autocomplete derive from the parser/checker inventory', async () => {
 const doc = await readFile('docs/declaration-format.md', 'utf8');
 for (const [name, [min, max, result, scope]] of Object.entries(FUNCTIONS)) expect(doc).toContain(`| \`${name}\` | ${scope} | ${min === max ? min : `${min}–${max}`} | ${result} |`);
});

// Review B1: path reads count nested evaluations deterministically, not by wall clock.
test('mixed inFolder nesting evaluates its child once per row at every depth', async () => {
  const rows = Array.from({ length: 2000 }, (_, i) => ({ path: `A/${i}.md`, properties: { x: i % 2 === 0 } }));
  const p = buildProjection(rows, { ...defaultDeclaration('test@1'), columns: ['x'] });
  const receipt: unknown[] = [];
  for (const depth of [4, 8, 10, 12, 14, 15]) {
    let text = 'note.x'; for (let j = 0; j < depth; j++) text = `file.inFolder(if(${text}, "A", "B"))`;
    let reads = 0;
    const paths = new Proxy(p.paths, { get(target, key, receiver) { if (typeof key === 'string' && key !== 'length' && Number.isInteger(Number(key))) reads++; return Reflect.get(target, key, receiver); } });
    const kernel = compile(checked(text, 'filter'), { ...p, paths }); reads = 0;
    for (let i = 0; i < p.paths.length; i++) expect(kernel.at(i)).toBe(Number(p.paths[i]!.split("/")[1]!.split(".")[0]) % 2 === 0);
    expect(reads).toBe(rows.length * depth);
    const start = performance.now(); expressionFilter(p, checked(text, 'filter'));
    receipt.push({ depth, rows: rows.length, pathReads: reads, milliseconds: performance.now() - start });
  }
  await mkdir('.workspace/evidence', { recursive: true }); await writeFile('.workspace/evidence/expression-nesting.json', JSON.stringify(receipt, null, 2) + '\n');
});

test('identifier tokens have positioned 128-unit caps without capping legacy AST keys', () => {
  const key = 'a'.repeat(EXPR_LIMITS.identifier);
  expect(validate(`note.${key}`).ok).toBe(true);
  const invalid = validate(`note.${key}a`); expect(invalid.ok).toBe(false); expect(invalid.errors[0]!.pos).toBe(5); expect(invalid.errors[0]!.message).toContain('128');
  expect(validate('note.' + 'a'.repeat(2000)).ok).toBe(false);
  for (const name of [key + 'a', 'a'.repeat(EXPR_LIMITS.string)]) {
    const source = `note["${name}"]`; expect(validate(source).ok).toBe(true);
    expect(print(checked(source))).toBe(source); expect(validate(print(checked(source))).ok).toBe(true);
    expect(suggestions('', [name])).toContain(source);
  }
  expect(lowerPredicate({ kind: 'eq', key: 'a'.repeat(2000), value: 1 }).kind).toBe('op');
});

test('escaped quote and backslash payloads chunk by JSON length and round-trip exactly', () => {
  const safe = (v: unknown): void => {
    if (typeof v === 'string') expect(/\S{32,}/.test(JSON.stringify(v) + ',')).toBe(false);
    else if (Array.isArray(v)) v.forEach(safe);
    else if (v && typeof v === 'object') Object.values(v).forEach(safe);
  };
  for (const value of ['x'.repeat(29), '"'.repeat(16), '\\'.repeat(16), '"'.repeat(40), '\\'.repeat(40), '\\"'.repeat(40), '\u0001'.repeat(40), '😀'.repeat(40)]) {
    // JSON.stringify emits a valid expression literal, including doubled backslashes.
    const expr = `note.k == ${JSON.stringify(value)}`, s = defaults('test@1');
    // The language deliberately refuses the JSON short escape for some controls.
    if (!validate(expr, 'filter').ok) { safe(encodeText(value)); continue; }
    s.declaration.colors = [{ name: 'Escapes', color: '#123456', predicate: { kind: 'expr', expr } }];
    s.declaration.groups = [{ from: 'expr', expr: `if(${expr}, 1, 0)` }];
    s.explore.view.filters = [{ kind: 'expr', expr }];
    s.explore.savedViews = [{ name: value, view: s.explore.view, camera: null }];
    const stored = settingsForSave(s);
    const fields = [(stored.declaration.colors[0]!.predicate as any).expr, (stored.declaration.groups[0] as any).expr, stored.explore];
    fields.forEach(safe);
    for (const field of fields.slice(0, 2)) expect(/\S{32,}/.test(JSON.stringify(field, null, 2))).toBe(false);
    const loaded = upgradeSettings(JSON.parse(JSON.stringify(stored)), 'test@1');
    expect(loaded.declaration.colors).toEqual(s.declaration.colors); expect(loaded.declaration.groups).toEqual(s.declaration.groups);
    expect(loaded.explore).toEqual(s.explore);
  }
  // R3 excludes schema keys and pre-existing legacy declarations from the guard.
  const legacy = defaults('test@1'); legacy.declaration.colors = [{ name: 'Legacy', color: '#123456', predicate: { kind: 'eq', key: 'k', value: 'x'.repeat(100000) } }];
  expect(upgradeSettings(settingsForSave(legacy), 'test@1').declaration.colors).toEqual(legacy.declaration.colors);
});

test('operation-produced labels preserve legacy string collisions, raw groups remain typed', () => {
  const p = buildProjection([{ path: 'A.md', properties: { k: 1 } }, { path: 'B.md', properties: { k: '1' } }], { ...defaultDeclaration('test@1'), columns: ['k'] });
  const raw = expressionGroup(p, checked('note.k')), operated = expressionGroup(p, checked('coalesce(note.k)'));
  expect(raw.codes[0]).not.toBe(raw.codes[1]); expect(operated.codes[0]).toBe(operated.codes[1]); expect(operated.values).toEqual(['1']);
});

test('preview and member requests cannot supersede a packaged applied explore view', async () => {
  const { p, worker, n } = await cancellationFixture();
  try {
    let acknowledge!: () => void; const started = new Promise<void>(resolve => { acknowledge = resolve; }), original = worker.onmessage!;
    worker.onmessage = event => { original.call(worker, event); if (event.data.kind === 'started') acknowledge(); };
    const view = { ...emptyView(), group: { from: 'expr' as const, expr: '"applied"' }, filters: [{ kind: 'expr' as const, expr: expensiveExpression(true) }] };
    const applied = p.request<any>(1, { kind: 'explore', view, facetValues: 50 });
    await started;
    const count = p.request<any>(1, { kind: 'expression-count', expr: 'true', context: 'filter' });
    const members = p.request<any>(1, { kind: 'members', group: '0', view: 2 });
    const result = await applied; expect(result.view).toBe(2); expect(result.explore.matched).toBe(n);
    expect(await count).toEqual({ matched: n, total: n }); expect((await members).length).toBe(n);
    const detail = await p.request<any>(1, { kind: 'detail' }); expect(detail.view).toBe(2); expect(detail.explore.groupKeys).toEqual(['applied']);
  } finally { p.dispose(); }
});

test('raw packaged worker supersedes within kind only, including queued evaluations', async () => {
  const { p, worker, n } = await cancellationFixture();
  try {
    const original = worker.onmessage!, pending = new Map<number, { resolve(v: any): void; reject(e: Error): void }>();
    worker.onmessage = event => { if (event.data.id < 100) { original.call(worker, event); return; } if (event.data.kind) return; const waiter = pending.get(event.data.id); if (!waiter) return; pending.delete(event.data.id); event.data.error ? waiter.reject(new Error(event.data.error)) : waiter.resolve(event.data.result); };
    const send = (id: number, request: object) => new Promise<any>((resolve, reject) => { pending.set(id, { resolve, reject }); worker.postMessage({ id, revision: 1, ...request }); });
    const applied = send(100, { kind: 'explore', view: { ...emptyView(), filters: [{ kind: 'expr', expr: expensiveExpression(true) }] }, facetValues: 50 });
    const oldCount = send(101, { kind: 'expression-count', expr: expensiveExpression(), context: 'group' }).catch(String);
    const latestCount = send(102, { kind: 'expression-count', expr: 'true', context: 'filter' });
    const detail = send(103, { kind: 'detail' });
    expect((await applied).view).toBe(2); expect(await oldCount).toContain('Expression superseded'); expect(await latestCount).toEqual({ matched: n, total: n }); expect((await detail).view).toBe(2);
  } finally { p.dispose(); }
});
