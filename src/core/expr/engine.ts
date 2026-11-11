/** SPDX-License-Identifier: MIT
 * Total expression kernels over projection columns; no I/O, dynamic code or regex. */
import { yieldTask } from '../scheduler';
import type { Projection, DictionaryColumn } from '../projection';
import type { Predicate, GroupSource, Scalar } from '../declaration';
import { call, check, checked, constantNumber, lit, op, print, ref, validate, EXPR_LIMITS, type Ast, type Value } from './syntax';
export { validate, checked, print, EXPR_LIMITS } from './syntax';
const bounded = (v: unknown): Value => Array.isArray(v) ? v.slice(0, EXPR_LIMITS.list).filter(x => x === null || ['string', 'number', 'boolean'].includes(typeof x)) : v === null || ['string', 'boolean'].includes(typeof v) || typeof v === 'number' && Number.isFinite(v) ? v as Value : undefined;
const text = (value: Value, limit: number = EXPR_LIMITS.input): string | null | undefined => {
  const v = Array.isArray(value) ? value.find(x => x !== null && ['string', 'number', 'boolean'].includes(typeof x)) : value;
  return v === undefined || v === null ? v : String(v).slice(0, limit);
};
const truth = (v: Value) => Array.isArray(v) ? v.length > 0 : Boolean(v);
const finite = (n: number): Value => Number.isFinite(n) ? n : null;
function apply(name: string, values: Value[], receiver?: Value, method = false): Value {
  const a = values[0], b = values[1];
  if (!method) {
    if (name === 'if') return truth(a) ? b : values[2] ?? null;
    if (name === 'coalesce') return values.find(v => v !== undefined && v !== null) ?? null;
    if (name === 'list') return Array.isArray(a) ? a : a === undefined ? [] : [a];
    if (name === 'number') return a === undefined ? undefined : a === null || Array.isArray(a) || typeof a === 'string' && !a.trim() ? null : finite(Number(a));
    if (name === 'min' || name === 'max') return values.some(v => v === undefined) ? undefined : values.some(v => typeof v !== 'number') ? null : finite((name === 'min' ? Math.min : Math.max)(...values as number[]));
    return null;
  }
  if (name === 'isTruthy') return truth(receiver);
  if (name === 'isEmpty') return receiver === undefined || receiver === null || receiver === '' || Array.isArray(receiver) && !receiver.length;
  if (name === 'isType') return a === 'null' ? receiver === null : a === 'list' ? Array.isArray(receiver) : !Array.isArray(receiver) && typeof receiver === a;
  // Preserve the legacy null/empty-list coercion point for these two transforms.
  if (name === 'segment' || name === 'prefix') {
    const s = text(receiver, 256); if (s === undefined || s === null) return undefined;
    const parts = s.split(a as string), n = b as number;
    return name === 'prefix' ? parts.length > n ? parts.slice(0, n).join(a as string) : null : parts.length > 1 ? parts.at(n) || null : null;
  }
  if (receiver === undefined || receiver === null) return receiver;
  if (name === 'toString') return text(receiver);
  if (name === 'index') { if (!Array.isArray(receiver) || typeof a !== 'number' || !Number.isInteger(a)) return null; return receiver.at(a) ?? null; }
  if (Array.isArray(receiver)) {
    if (name === 'length') return receiver.length;
    if (name === 'slice') return typeof a === 'number' && (b === undefined || typeof b === 'number') ? receiver.slice(a, b as number | undefined) : null;
    if (name === 'contains' || name === 'containsAny' || name === 'containsAll') { const contains = (v: Value) => v !== undefined && !Array.isArray(v) && receiver.includes(v); return name === 'containsAll' ? values.every(contains) : values.some(contains); }
    if (name === 'join') { const sep = text(a) ?? ''; let out = ''; for (let i = 0; i < receiver.length && out.length < EXPR_LIMITS.input; i++) out += (i ? sep : '') + (text(receiver[i]) ?? ''); return out.slice(0, EXPR_LIMITS.input); }
  }
  if (['abs', 'floor', 'ceil', 'round'].includes(name)) {
    if (typeof receiver !== 'number') return null;
    if (name === 'round') { if (a !== undefined && (typeof a !== 'number' || !Number.isInteger(a) || Math.abs(a) > 308)) return null; const factor = 10 ** (a as number ?? 0); return finite(Math.round(receiver * factor) / factor); }
    return finite((name === 'abs' ? Math.abs : name === 'floor' ? Math.floor : Math.ceil)(receiver));
  }
  const s = text(receiver); if (s === null || s === undefined) return s;
  const needle = text(a);
  if (name === 'lower') return s.toLowerCase().slice(0, EXPR_LIMITS.input);
  if (name === 'upper') return s.toUpperCase().slice(0, EXPR_LIMITS.input);
  if (name === 'trim') return s.trim();
  if (name === 'length') return s.length;
  if (name === 'containsAny' || name === 'containsAll') { const contains = (v: Value) => { const t = text(v); return t !== undefined && t !== null && s.includes(t); }; return name === 'containsAll' ? values.every(contains) : values.some(contains); }
  if (name === 'slice') return typeof a === 'number' && (b === undefined || typeof b === 'number') ? s.slice(a, b as number | undefined) : null;
  if (needle === undefined || needle === null) return needle;
  if (name === 'contains') return s.includes(needle);
  if (name === 'startsWith') return s.startsWith(needle);
  if (name === 'endsWith') return s.endsWith(needle);
  if (name === 'split') return b === undefined || typeof b === 'number' && Number.isSafeInteger(b) && b >= 0 ? s.split(needle, Math.min(b as number ?? EXPR_LIMITS.list, EXPR_LIMITS.list)) : null;
  if (name === 'replace') {
    const replacement = text(b); if (replacement === undefined || replacement === null) return replacement;
    // Build at most the output cap; do not allocate an input × replacement product.
    let out = '', cursor = 0;
    if (!needle.length) { for (let i = 0; i <= s.length && out.length < EXPR_LIMITS.input; i++) out += replacement + (s[i] ?? ''); return out.slice(0, EXPR_LIMITS.input); }
    while (out.length < EXPR_LIMITS.input) { const at = s.indexOf(needle, cursor); if (at < 0) return (out + s.slice(cursor)).slice(0, EXPR_LIMITS.input); out += s.slice(cursor, at) + replacement; cursor = at + needle.length; }
    return out.slice(0, EXPR_LIMITS.input);
  }
  return null;
}
function operation(name: string, v: Value[]): Value {
  const a = v[0], b = v[1];
  if (name === '!') return !truth(a);
  if (name === '&&') return v.every(truth);
  if (name === '||') return v.some(truth);
  if (['==', '!=', '<', '>', '<=', '>='].includes(name)) {
    if (a === undefined || b === undefined) return false;
    if (name === '==') return a === b;
    if (name === '!=') return a !== b;
    if (typeof a !== typeof b || typeof a !== 'number' && typeof a !== 'string') return false;
    const x = a as number, y = b as number;
    return name === '<' ? x < y : name === '>' ? x > y : name === '<=' ? x <= y : x >= y;
  }
  if (a === undefined || name !== 'neg' && b === undefined) return undefined;
  if (name === '+' && typeof a === 'string' && typeof b === 'string') return (a.slice(0, EXPR_LIMITS.input) + b.slice(0, EXPR_LIMITS.input)).slice(0, EXPR_LIMITS.input);
  if (typeof a !== 'number' || name !== 'neg' && typeof b !== 'number') return null;
  return finite(name === 'neg' ? -a : name === '+' ? a + (b as number) : name === '-' ? a - (b as number) : name === '*' ? a * (b as number) : name === '/' ? a / (b as number) : a % (b as number));
}
export interface Context { property(name: string): Value; present?(name: string): boolean; path: string; identity: string; degree: number }
const inFolder = (path: string, folder: string) => { while (folder.endsWith('/')) folder = folder.slice(0, -1); return !folder || path.startsWith(folder + '/'); };
export function evaluate(n: Ast, c: Context): Value {
  if (n.kind === 'literal') return n.value;
  if (n.kind === 'ref') {
    if (n.space === 'note') return c.property(n.name);
    if (n.space === 'node') return n.name === 'identity' ? c.identity : c.degree;
    const name = c.path.slice(c.path.lastIndexOf('/') + 1), dot = name.lastIndexOf('.');
    return n.name === 'path' ? c.path : n.name === 'name' ? name : n.name === 'folder' ? c.path.slice(0, Math.max(0, c.path.lastIndexOf('/'))) : n.name === 'basename' ? dot < 0 ? name : name.slice(0, dot) : dot < 0 ? '' : name.slice(dot + 1);
  }
  if (n.kind === 'call' && n.name === 'file.hasProperty') { const key = (n.args[0] as { value: string }).value; return c.present?.(key) ?? c.property(key) !== undefined; }
  if (n.kind === 'call' && n.name === 'file.inFolder') { const v = evaluate(n.args[0]!, c); return typeof v === 'string' && inFolder(c.path, v); }
  if (n.kind === 'op') {
    if (n.name === '&&') { for (const a of n.args) if (!truth(evaluate(a, c))) return false; return true; }
    if (n.name === '||') { for (const a of n.args) if (truth(evaluate(a, c))) return true; return false; }
    return operation(n.name, n.args.map(a => evaluate(a, c)));
  }
  if (n.name === 'if') return truth(evaluate(n.args[0]!, c)) ? evaluate(n.args[1]!, c) : n.args[2] ? evaluate(n.args[2], c) : null;
  return apply(n.name, n.args.map(a => evaluate(a, c)), n.receiver ? evaluate(n.receiver, c) : undefined, Boolean(n.receiver));
}
export function lowerPredicate(p: Predicate): Ast {
  if (p.kind === 'expr') return checked(p.expr, 'filter');
  if (p.kind === 'folder') { let path = Array.isArray(p.prefix) ? p.prefix.join('/') : p.prefix; while (path.endsWith('/')) path = path.slice(0, -1); return path ? call('file.inFolder', [lit(path)]) : lit(true); }
  if (p.kind === 'exists') return call('file.hasProperty', [lit(p.key)]);
  return p.kind === 'eq' ? op('==', [ref('note', p.key), lit(p.value)]) : call('contains', [ref('note', p.key)], lit(p.values));
}
export function lowerGroup(g: Exclude<GroupSource, { from: 'folder' }>): Ast {
  if (g.from === 'expr') return checked(g.expr);
  const source = g.from === 'derived' && g.key === '$path' ? ref('file', 'path') : g.from === 'derived' && g.key === '$identity' ? ref('node', 'identity') : ref('note', g.key);
  return g.from === 'key' ? source : call(g.transform.kind, [lit(g.transform.delimiter), lit(g.transform.kind === 'segment' ? g.transform.index : g.transform.segments)], source);
}
/** Shape recognition is also the stable historical cache representation. */
export function builderPredicate(n: Ast): Exclude<Predicate, { kind: 'expr' }> | undefined {
  if (n.kind === 'literal' && n.value === true) return { kind: 'folder', prefix: [] };
  if (n.kind === 'op' && n.name === '==' && n.args[1]?.kind === 'op' && constantNumber(n.args[1]) !== undefined) return builderPredicate({ ...n, args: [n.args[0]!, lit(constantNumber(n.args[1]))] });
  if (n.kind === 'op' && n.name === '==' && n.args[0]?.kind === 'ref' && n.args[0].space === 'note' && n.args[1]?.kind === 'literal' && !Array.isArray(n.args[1].value) && n.args[1].value !== undefined) return { kind: 'eq', key: n.args[0].name, value: n.args[1].value };
  if (n.kind === 'call' && n.name === 'contains' && n.receiver?.kind === 'literal' && Array.isArray(n.receiver.value) && n.args[0]?.kind === 'ref' && n.args[0].space === 'note') return { kind: 'in', key: n.args[0].name, values: n.receiver.value };
  if (n.kind === 'call' && n.name === 'file.hasProperty' && n.args[0]?.kind === 'literal' && typeof n.args[0].value === 'string') return { kind: 'exists', key: n.args[0].value };
  if (n.kind === 'call' && n.name === 'file.inFolder' && n.args[0]?.kind === 'literal' && typeof n.args[0].value === 'string') return { kind: 'folder', prefix: n.args[0].value.split('/').filter(Boolean) };
  return undefined;
}
export function builderGroup(n: Ast): Exclude<GroupSource, { from: 'expr' | 'folder' }> | undefined {
  if (n.kind === 'ref' && n.space === 'note') return { from: 'key', key: n.name };
  if (n.kind !== 'call' || !n.receiver || !['segment', 'prefix'].includes(n.name) || n.receiver.kind !== 'ref' || n.args[0]?.kind !== 'literal' || typeof n.args[0].value !== 'string') return undefined;
  const r = n.receiver, v = constantNumber(n.args[1]!); if (v === undefined) return undefined;
  const key = r.space === 'note' ? r.name : r.space === 'file' && r.name === 'path' ? '$path' : r.space === 'node' && r.name === 'identity' ? '$identity' : undefined;
  return key === undefined ? undefined : { from: 'derived', key, transform: n.name === 'segment' ? { kind: 'segment', delimiter: n.args[0].value, index: v } : { kind: 'prefix', delimiter: n.args[0].value, segments: v } };
}
export function plan(n: Ast): unknown { const normalized = n.kind === 'op' && n.name === 'neg' && constantNumber(n) !== undefined ? lit(constantNumber(n)) : n; return normalized.kind === 'literal' ? ['literal', normalized.value] : normalized.kind === 'ref' ? ['ref', normalized.space, normalized.name] : [normalized.kind, normalized.name, normalized.kind === 'call' && normalized.receiver ? plan(normalized.receiver) : null, normalized.args.map(plan)]; }
export const predicateIdentity = (p: Predicate): unknown => { const ast = lowerPredicate(p); return builderPredicate(ast) ?? { kind: 'expr', plan: plan(ast) }; };
export const groupIdentity = (g: GroupSource): unknown => g.from === 'folder' ? g : builderGroup(lowerGroup(g)) ?? { from: 'expr', plan: plan(lowerGroup(g)) };
export function editAsExpression(entry: Predicate | GroupSource): { text?: string; reason?: string } {
  if ('from' in entry && entry.from === 'folder') return { reason: 'Folder depth stays a built-in group source' };
  const source = print('kind' in entry ? lowerPredicate(entry) : lowerGroup(entry));
  const result = validate(source, 'kind' in entry ? 'filter' : 'group');
  return result.ok ? { text: source } : { reason: 'Too large for an expression; edit in the builder' };
}
interface Kernel { at(i: number): Value }
const emptyContext: Context = { property: () => undefined, path: '', identity: '', degree: 0 };
/** Distinct input dictionary -> typed lookup -> row code; no per-node AST walk. */
function* compileSteps(ast: Ast, p: Projection): Generator<void, Kernel> {
  const deps = (n: Ast, out = new Set<string>()): Set<string> => {
    if (n.kind === 'ref') out.add(n.space === 'note' ? `p:${n.name}` : `${n.space}:${n.name}`);
    if (n.kind === 'call' && n.name === 'file.hasProperty') out.add(`p:${(n.args[0] as { value: string }).value}`);
    if (n.kind === 'call' && n.name === 'file.inFolder') out.add('file:path');
    if (n.kind === 'op' || n.kind === 'call') { n.args.forEach(a => deps(a, out)); if (n.kind === 'call' && n.receiver) deps(n.receiver, out); }
    return out;
  };
  const context = (i: number): Context => ({ path: p.paths[i]!, identity: p.identities[i]!, degree: p.offsets[i + 1]! - p.offsets[i]!, property: name => { const c = p.columns[name]; return c ? decode(c.values[c.codes[i]!]!) : undefined; }, present: name => { const c = p.columns[name]; return Boolean(c && c.values[c.codes[i]!] !== 'undefined'); } });
  function* distinct(n: Ast, key: string): Generator<void, Kernel> {
    const c = p.columns[key]; if (!c) throw new Error(`Undeclared column: ${key}; apply to materialize it`);
    const shape = builderPredicate(n);
    // Exact legacy dictionary matching also preserves presence of non-scalars.
    const selected = shape?.kind === 'in' || shape?.kind === 'eq' ? new Set((shape.kind === 'in' ? shape.values : [shape.value]).map(v => JSON.stringify(v))) : undefined;
    const values: Value[] = [];
    for (let i = 0; i < c.values.length; i++) {
      const raw = c.values[i]!, value = selected || shape?.kind === 'exists' ? undefined : decode(raw);
      values.push(selected ? selected.has(raw) : shape?.kind === 'exists' ? raw !== 'undefined' : evaluate(n, { ...emptyContext, property: name => name === key ? value : undefined, present: name => name === key && raw !== 'undefined' }));
      if (i % 64 === 63) yield;
    }
    return yield* lookup(values, c.codes);
  }
  function* build(n: Ast): Generator<void, Kernel> {
    const dependencies = deps(n);
    if (!dependencies.size) { const value = evaluate(n, emptyContext); return { at: () => value }; }
    if (dependencies.size === 1 && [...dependencies][0]!.startsWith('p:')) return yield* distinct(n, [...dependencies][0]!.slice(2));
    if (n.kind === 'call' && n.name === 'file.inFolder' && n.args[0]?.kind === 'literal' && typeof n.args[0].value === 'string') {
      let folder = n.args[0].value; while (folder.endsWith('/')) folder = folder.slice(0, -1);
      const bits = new Uint8Array(p.paths.length), range = p.folders.get(folder); if (range) bits.fill(1, range[0], range[1]); return { at: i => Boolean(bits[i]) };
    }
    if ([...dependencies].every(d => d.startsWith('file:') || d.startsWith('node:'))) { const values: Value[] = []; for (let i = 0; i < p.paths.length; i++) { values.push(evaluate(n, context(i))); if (i % 64 === 63) yield; } return yield* lookup(values); }
    if (n.kind === 'op') {
      const children: Kernel[] = []; for (const a of n.args) children.push(yield* build(a));
      if (n.name === '&&' || n.name === '||') { const bits = new Uint8Array(p.paths.length).fill(n.name === '&&' ? 1 : 0); for (const child of children) for (let i = 0; i < bits.length; i++) { if (n.name === '&&' ? bits[i] : !bits[i]) bits[i] = truth(child.at(i)) ? 1 : 0; if (i % 1024 === 1023) yield; } return { at: i => Boolean(bits[i]) }; }
      return { at: i => operation(n.name, children.map(c => c.at(i))) };
    }
    if (n.kind === 'call') {
      const children: Kernel[] = []; for (const a of n.args) children.push(yield* build(a)); const receiver = n.receiver ? yield* build(n.receiver) : undefined;
      return { at: i => {
        if (n.name === 'file.inFolder') { const folder = children[0]!.at(i); return typeof folder === 'string' && inFolder(p.paths[i]!, folder); }
        return n.name === 'if' ? truth(children[0]!.at(i)) ? children[1]!.at(i) : children[2] ? children[2].at(i) : null : apply(n.name, children.map(c => c.at(i)), receiver?.at(i), Boolean(receiver));
      } };
    }
    return { at: i => evaluate(n, context(i)) };
  }
  return yield* build(ast);
}
function decode(raw: string): Value { if (raw === 'undefined') return undefined; try { return bounded(JSON.parse(raw)); } catch { return undefined; } }
function* lookup(values: Value[], codes?: Uint32Array): Generator<void, Kernel> {
  const read = codes ? (i: number) => codes[i]! : (i: number) => i;
  if (values.every(v => typeof v === 'boolean')) { const table = Uint8Array.from(values, v => v ? 1 : 0); return { at: i => Boolean(table[read(i)]) }; }
  if (values.every(v => typeof v === 'number')) { const table = Float64Array.from(values as number[]); return { at: i => table[read(i)] }; }
  const dictionary: Value[] = [], index = new Map<Value, number>(), table = new Uint32Array(values.length);
  for (let i = 0; i < values.length; i++) { const v = values[i]; let code = index.get(v); if (code === undefined) { code = dictionary.length; index.set(v, code); dictionary.push(v); } table[i] = code; if (i % 64 === 63) yield; }
  return { at: i => dictionary[table[read(i)]!] };
}
/** One generator authority supports both pure synchronous and cooperative worker callers. */
function drain<T>(work: Generator<void, T>): T { let step = work.next(); while (!step.done) step = work.next(); return step.value; }
export interface EvaluationControl { cancelled(): boolean; budgetMs: number }
export async function cooperative<T>(work: Generator<void, T>, control: EvaluationControl): Promise<T> {
  if (!Number.isFinite(control.budgetMs) || control.budgetMs <= 0) throw new Error('Invalid expression budget');
  const start = performance.now(); let slice = start;
  const guard = () => { if (control.cancelled()) throw new Error('Expression superseded'); if (performance.now() - start >= control.budgetMs) throw new Error('Expression time budget exceeded'); };
  try {
    while (true) {
      guard(); const step = work.next(); guard(); if (step.done) return step.value;
      if (performance.now() - slice >= 8) { await yieldTask(); guard(); slice = performance.now(); }
    }
  } finally { work.return(undefined as T); }
}
export const compile = (ast: Ast, p: Projection): Kernel => drain(compileSteps(ast, p));
export function* filterSteps(p: Projection, ast: Ast): Generator<void, Uint8Array> {
  const kernel = yield* compileSteps(ast, p), bits = new Uint8Array(p.paths.length);
  for (let i = 0; i < bits.length; i++) { bits[i] = kernel.at(i) === true ? 1 : 0; if (i % 1024 === 1023) yield; }
  return bits;
}
export function* groupSteps(p: Projection, ast: Ast): Generator<void, DictionaryColumn> {
  // Raw property groups retain the complete historical typed dictionary.
  if (ast.kind === 'ref' && ast.space === 'note') { const c = p.columns[ast.name]; if (!c) throw new Error(`Undeclared column: ${ast.name}; apply to materialize it`); return { ...c, encoded: true }; }
  const kernel = yield* compileSteps(ast, p), rows: string[] = [];
  for (let i = 0; i < p.paths.length; i++) { const v = kernel.at(i); rows.push(v === undefined ? '(missing)' : v === null || Array.isArray(v) ? '(no match)' : String(v)); if (i % 64 === 63) yield; }
  const values = [...new Set(rows)].sort(), index = new Map(values.map((v, i) => [v, i]));
  return { values, codes: Uint32Array.from(rows, v => index.get(v)!), encoded: false };
}
export const expressionFilter = (p: Projection, ast: Ast): Uint8Array => drain(filterSteps(p, ast));
export const expressionGroup = (p: Projection, ast: Ast): DictionaryColumn => drain(groupSteps(p, ast));
export const expressionReferences = (source: string) => check(checked(source)).references;
