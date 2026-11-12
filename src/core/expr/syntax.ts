/** SPDX-License-Identifier: MIT
 * Bounded Bases-aligned expression syntax. No host imports or pattern engine. */
export const EXPR_LIMITS = { text: 2048, nodes: 256, depth: 32, identifier: 128, string: 256, input: 4096, list: 10000, references: 16 } as const;
export type Value = undefined | null | boolean | number | string | (null | boolean | number | string)[];
export type Ast = { kind: 'literal'; value: Value; pos: number } | { kind: 'ref'; space: 'note' | 'file' | 'node'; name: string; pos: number } | { kind: 'call'; name: string; args: Ast[]; receiver?: Ast; pos: number } | { kind: 'op'; name: string; args: Ast[]; pos: number };
export class ExprError extends Error { constructor(message: string, readonly pos: number) { super(message); } }
const M = { depth: 'Expression exceeds depth 32', scalar: 'List entries must be scalar literals', regex: 'Regex is not supported; use split/startsWith/contains', boolean: 'Use true/false or .isTruthy()', literal: 'Delimiter/find must be a literal string; regex is not supported', forbidden: 'Forbidden name' };
function fail(message: string, pos: number): never { throw new ExprError(message, pos); }
const alpha = (c: string) => c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c === '_';
const digit = (c: string) => c >= '0' && c <= '9';
const blocked = ['constructor', '__proto__', 'prototype', 'eval', 'Function', 'this'];
interface Token { text: string; pos: number; value?: string | number; type: string }
function lex(source: string): Token[] {
  if (source.length > EXPR_LIMITS.text) fail('Expression exceeds 2,048 characters', EXPR_LIMITS.text);
  const tokens: Token[] = []; let i = 0;
  while (i < source.length) {
    const c = source[i]!, pos = i;
    if (c.charCodeAt(0) <= 32) { i++; continue; }
    if (c === '"' || c === "'") {
      let value = ''; i++; let closed = false;
      while (i < source.length) {
        let ch = source[i++]!;
        if (ch === c) { closed = true; break; }
        if (ch === '\\') {
          ch = source[i++] ?? '';
          if (ch === 'n') ch = '\n'; else if (ch === 't') ch = '\t';
          else if (ch === 'u') {
            const hex = source.slice(i, i + 4);
            if (hex.length !== 4 || [...hex].some(h => !digit(h) && !(h.toLowerCase() >= 'a' && h.toLowerCase() <= 'f'))) fail('Expected four hexadecimal digits', i);
            ch = String.fromCharCode(parseInt(hex, 16)); i += 4;
          } else if (ch !== '\\' && ch !== '"' && ch !== "'") fail('Unsupported escape; use \\n, \\t or \\uXXXX', i - 1);
        } else if (ch.charCodeAt(0) < 32) fail('Escape control characters in strings', i - 1);
        value += ch;
        if (value.length > EXPR_LIMITS.string) fail('String literal exceeds 256 characters', pos);
      }
      if (!closed) fail('Unclosed string', pos);
      tokens.push({ text: source.slice(pos, i), pos, value, type: 'string' }); continue;
    }
    if (digit(c) || c === '.' && digit(source[i + 1] ?? '')) {
      while (digit(source[i] ?? '')) i++;
      if (source[i] === '.') { i++; while (digit(source[i] ?? '')) i++; }
      const value = Number(source.slice(pos, i)); if (!Number.isFinite(value)) fail('Number must be finite', pos);
      tokens.push({ text: source.slice(pos, i), pos, value, type: 'number' }); continue;
    }
    if (alpha(c)) {
      i++; while (alpha(source[i] ?? '') || digit(source[i] ?? '')) i++;
      const text = source.slice(pos, i);
      if (text.length > EXPR_LIMITS.identifier) fail('Identifier exceeds 128 characters; use a bracket key', pos);
      if (blocked.includes(text)) fail(M.forbidden, pos);
      if (text === 'and' || text === 'or' || text === 'not') fail(`Use ${text === 'and' ? '&&' : text === 'or' ? '||' : '!'} instead of ${text}`, pos);
      tokens.push({ text, pos, type: 'ident' }); continue;
    }
    const pair = source.slice(i, i + 2);
    if (['&&', '||', '==', '!=', '<=', '>='].includes(pair)) { tokens.push({ text: pair, pos, type: 'symbol' }); i += 2; continue; }
    if (c === '=') fail('Use == for exact-type equality', pos);
    if ('()+-*/%!.[],<>'.includes(c)) { tokens.push({ text: c, pos, type: 'symbol' }); i++; continue; }
    fail(`Unexpected character ${c}`, pos);
  }
  tokens.push({ text: '', pos: source.length, type: 'end' }); return tokens;
}
const precedence: Record<string, number> = { '||': 1, '&&': 2, '==': 4, '!=': 4, '<': 4, '>': 4, '<=': 4, '>=': 4, '+': 5, '-': 5, '*': 6, '/': 6, '%': 6 };
export function parse(source: string): Ast {
  const tokens = lex(source); let cursor = 0, count = 0;
  const peek = () => tokens[cursor]!;
  const take = () => tokens[cursor++]!;
  const expect = (s: string) => { if (peek().text !== s) fail(`Expected ${s}`, peek().pos); take(); };
  const make = (node: Ast): Ast => node;
  const literal = (): Extract<Ast, { kind: 'literal' }> => {
    const t = take(); let sign = 1;
    if (t.text === '-') { sign = -1; const n = take(); if (n.type !== 'number') fail(M.scalar, n.pos); return { kind: 'literal', value: -(n.value as number), pos: t.pos }; }
    if (t.type === 'number' || t.type === 'string') return { kind: 'literal', value: typeof t.value === 'number' ? sign * t.value : t.value!, pos: t.pos };
    if (['true', 'false', 'null'].includes(t.text)) return { kind: 'literal', value: t.text === 'null' ? null : t.text === 'true', pos: t.pos };
    fail(M.scalar, t.pos);
  };
  const args = (depth: number): Ast[] => {
    expect('('); const out: Ast[] = [];
    if (peek().text !== ')') { do { out.push(expression(0, depth + 1)); if (peek().text !== ',') break; take(); } while (true); }
    expect(')'); return out;
  };
  const expression = (min: number, depth: number): Ast => {
    if (depth > EXPR_LIMITS.depth) fail(M.depth, peek().pos);
    const t = take(); let node: Ast;
    if (t.text === '/' && min === 0) fail(M.regex, t.pos);
    if (t.text === '!' || t.text === '-') node = make({ kind: 'op', name: t.text === '!' ? '!' : 'neg', args: [expression(t.text === '!' ? 3 : 7, depth + 1)], pos: t.pos });
    else if (t.text === '(') { node = expression(0, depth + 1); expect(')'); }
    else if (t.text === '[') {
      const values: Exclude<Value, undefined | unknown[]>[] = [];
      if (peek().text !== ']') do { if (values.length === EXPR_LIMITS.list) fail('List exceeds 10,000 items', peek().pos); values.push(literal().value as null | boolean | number | string); if (peek().text !== ',') break; take(); } while (true);
      expect(']'); node = make({ kind: 'literal', value: values, pos: t.pos });
    } else if (t.type === 'number' || t.type === 'string' || ['true', 'false', 'null'].includes(t.text)) { cursor--; node = make(literal()); }
    else if (t.type === 'ident') {
      if (peek().text === '(') node = make({ kind: 'call', name: t.text, args: args(depth), pos: t.pos });
      else if (['note', 'file', 'node'].includes(t.text)) {
        let name: string;
        if (peek().text === '[') { take(); const key = take(); if (key.type !== 'string') fail('Property names must be literal strings', key.pos); name = key.value as string; expect(']'); }
        else { expect('.'); const key = take(); if (key.type !== 'ident') fail('Expected property name; use brackets for other keys', key.pos); name = key.text; }
        if (blocked.includes(name)) fail(M.forbidden, t.pos);
        if (t.text === 'file' && peek().text === '(') node = make({ kind: 'call', name: `file.${name}`, args: args(depth), pos: t.pos });
        else node = make({ kind: 'ref', space: t.text as 'note' | 'file' | 'node', name, pos: t.pos });
      } else if (['formula', 'edge'].includes(t.text)) fail(`${t.text} context is deferred; use note, file or node`, t.pos);
      else node = make({ kind: 'ref', space: 'note', name: t.text, pos: t.pos });
    } else fail('Expected an expression', t.pos);
    while (true) {
      if (peek().text === '.') {
        take(); const name = take(); if (name.type !== 'ident') fail('Expected method or length', name.pos);
        node = make({ kind: 'call', name: name.text, receiver: node, args: peek().text === '(' ? args(depth) : FUNCTIONS[name.text]?.[0] === 0 && name.text === 'length' ? [] : fail('Expected method arguments', name.pos), pos: name.pos });
      } else if (peek().text === '[') {
        const p = take().pos, index = expression(0, depth + 1); expect(']'); node = make({ kind: 'call', name: 'index', receiver: node, args: [index], pos: p });
      } else break;
    }
    while ((precedence[peek().text] ?? 0) > min) {
      const op = take(), p = precedence[op.text]!;
      const right = expression(p, depth + 1);
      node = make({ kind: 'op', name: op.text, args: (op.text === '&&' || op.text === '||') ? [...(node.kind === 'op' && node.name === op.text ? node.args : [node]), ...(right.kind === 'op' && right.name === op.text ? right.args : [right])] : [node, right], pos: op.pos });
      if (p === 4 && precedence[peek().text] === 4) fail('Comparisons do not chain; use &&', peek().pos);
    }
    return node;
  };
  const ast = expression(0, 1); if (peek().type !== 'end') fail('Unexpected token; use ==, && and ||', peek().pos);
  // Postfix chains count toward depth even though parsing them is iterative.
  const checkDepth = (n: Ast, depth: number) => { if (++count > EXPR_LIMITS.nodes) fail('Expression exceeds 256 AST nodes', n.pos); if (depth > EXPR_LIMITS.depth) fail(M.depth, n.pos); if (n.kind === 'op' || n.kind === 'call') { n.args.forEach(a => checkDepth(a, depth + 1)); if (n.kind === 'call' && n.receiver) checkDepth(n.receiver, depth + 1); } };
  checkDepth(ast, 1); return ast;
}
export const lit = (value: Value): Ast => ({ kind: 'literal', value, pos: 0 });
export const ref = (space: 'note' | 'file' | 'node', name: string): Ast => ({ kind: 'ref', space, name, pos: 0 });
export const call = (name: string, args: Ast[], receiver?: Ast): Ast => ({ kind: 'call', name, args, ...(receiver ? { receiver } : {}), pos: 0 });
export const op = (name: string, args: Ast[]): Ast => ({ kind: 'op', name, args, pos: 0 });
const identifier = (s: string) => Boolean(s) && s.length <= EXPR_LIMITS.identifier && alpha(s[0]!) && [...s].every(c => alpha(c) || digit(c)) && !blocked.includes(s);
/** Print only required parentheses, preserving bounded unary depth and exact precedence. */
const quote = (v: Value) => (JSON.stringify(v) ?? 'null').replaceAll('\\r', '\\u000d').replaceAll('\\b', '\\u0008').replaceAll('\\f', '\\u000c');
export function print(n: Ast): string {
  if (n.kind === 'literal') {
    if (Array.isArray(n.value)) return `[${n.value.map(v => print(lit(v))).join(', ')}]`;
    if (typeof n.value === 'number' && n.value.toString().includes('e')) { const [m, e] = n.value.toString().split('e'); const negative = m!.startsWith('-'), digits = m!.replace('.', '').replace('-', ''), point = (m!.includes('.') ? m!.indexOf('.') : m!.length) - (negative ? 1 : 0) + Number(e); return (negative ? '-' : '') + (point <= 0 ? '0.' + '0'.repeat(-point) + digits : point >= digits.length ? digits + '0'.repeat(point - digits.length) : digits.slice(0, point) + '.' + digits.slice(point)); }
    return quote(n.value);
  }
  if (n.kind === 'ref') return identifier(n.name) ? `${n.space}.${n.name}` : `${n.space}[${quote(n.name)}]`;
  if (n.kind === 'call') { const receiver = n.receiver && (n.receiver.kind === 'op' ? `(${print(n.receiver)})` : print(n.receiver)); return receiver ? n.name === 'index' ? `${receiver}[${print(n.args[0]!)}]` : `${receiver}.${n.name}${n.name === 'length' ? '' : `(${n.args.map(print).join(', ')})`}` : `${n.name}(${n.args.map(print).join(', ')})`; }
  const level = (a: Ast) => a.kind === 'op' ? a.name === 'neg' ? 7 : a.name === '!' ? 3 : precedence[a.name]! : 9;
  const p = level(n), operand = (a: Ast, right = false) => level(a) < p || right && level(a) === p || p === 4 && level(a) === p ? `(${print(a)})` : print(a);
  if (n.name === '!' || n.name === 'neg') return `${n.name === 'neg' ? '-' : '!'}${operand(n.args[0]!)}`;
  return n.args.map((a, i) => operand(a, i > 0 && n.name !== '&&' && n.name !== '||')).join(` ${n.name} `);
}
export type ExprType = 'boolean' | 'number' | 'string' | 'list' | 'null' | 'unknown';
/** Single callable inventory: min/max arity, result, receiver/global scope, argument rule. */
export const FUNCTIONS: Record<string, readonly [number, number, ExprType, string, string]> = {
  'if': [2, 3, 'unknown', 'global', ''],
  'number': [1, 1, 'number', 'global', ''],
  'max': [1, 256, 'number', 'global', ''],
  'min': [1, 256, 'number', 'global', ''],
  'list': [1, 1, 'list', 'global', ''],
  'coalesce': [1, 256, 'unknown', 'global', ''],
  'file.inFolder': [1, 1, 'boolean', 'global', ''],
  'file.hasProperty': [1, 1, 'boolean', 'global', 'property'],
  'isTruthy': [0, 0, 'boolean', 'any', ''],
  'isEmpty': [0, 0, 'boolean', 'any', ''],
  'toString': [0, 0, 'string', 'any', ''] as const,
  'isType': [1, 1, 'boolean', 'any', 'type'],
  'lower': [0, 0, 'string', 'string', ''],
  'upper': [0, 0, 'string', 'string', ''],
  'trim': [0, 0, 'string', 'string', ''],
  'length': [0, 0, 'number', 'string list', ''],
  'contains': [1, 1, 'boolean', 'string list', ''],
  'containsAny': [1, 256, 'boolean', 'string list', ''],
  'containsAll': [1, 256, 'boolean', 'string list', ''],
  'startsWith': [1, 1, 'boolean', 'string', ''],
  'endsWith': [1, 1, 'boolean', 'string', ''],
  'slice': [1, 2, 'unknown', 'string list', ''],
  'split': [1, 2, 'list', 'string', 'literal'],
  'replace': [2, 2, 'string', 'string', 'literal'],
  'join': [1, 1, 'string', 'list', ''],
  'index': [1, 1, 'unknown', 'list', ''],
  'abs': [0, 0, 'number', 'number', ''],
  'floor': [0, 0, 'number', 'number', ''],
  'ceil': [0, 0, 'number', 'number', ''],
  'round': [0, 1, 'number', 'number', ''],
  'segment': [2, 2, 'string', 'string', 'transform'],
  'prefix': [2, 2, 'string', 'string', 'transform'],
};
export function check(ast: Ast, context: 'filter' | 'group' = 'group'): { references: string[]; type: ExprType } {
  const references = new Set<string>();
  const infer = (n: Ast): ExprType => {
    if (n.kind === 'literal') return n.value === null ? 'null' : Array.isArray(n.value) ? 'list' : typeof n.value === 'undefined' ? 'unknown' : typeof n.value as ExprType;
    if (n.kind === 'ref') {
      if (blocked.includes(n.name)) fail(M.forbidden, n.pos);
      if (n.space === 'note') { references.add(n.name); return 'unknown'; }
      if (n.space === 'file' && ['path', 'name', 'basename', 'folder', 'ext'].includes(n.name)) return 'string';
      if (n.space === 'node' && ['identity', 'degree'].includes(n.name)) return n.name === 'degree' ? 'number' : 'string';
      fail('Unknown file/node fact', n.pos);
    }
    const types = n.args.map(infer);
    if (n.kind === 'op') {
      if (['&&', '||', '!'].includes(n.name) && types.some(t => t !== 'unknown' && t !== 'boolean')) fail(M.boolean, n.pos);
      return ['&&', '||', '!', '==', '!=', '<', '>', '<=', '>='].includes(n.name) ? 'boolean' : n.name === '+' && types.includes('string') ? 'string' : 'number';
    }
    const receiverType = n.receiver ? infer(n.receiver) : undefined;
    const spec = Object.hasOwn(FUNCTIONS, n.name) ? FUNCTIONS[n.name] : undefined;
    if (!spec || (n.receiver ? spec[3] === 'global' : spec[3] !== 'global')) fail(`Unknown call ${n.name}; ${M.regex}`, n.pos);
    if (n.args.length < spec[0] || n.args.length > spec[1]) fail(`${n.name} needs ${spec[0]}…${spec[1]} arguments`, n.pos);
    if ((spec[4] === 'literal' || spec[4] === 'transform') && (n.args[0]?.kind !== 'literal' || typeof n.args[0].value !== 'string')) fail(M.literal, n.pos);
    if (n.name === 'segment' || n.name === 'prefix') {
      const a = n.args[0]!, b = n.args[1]!; const v = constantNumber(b);
      if (a.kind !== 'literal' || typeof a.value !== 'string' || a.value.length < 1 || a.value.length > 8 || v === undefined || !Number.isInteger(v) || (n.name === 'segment' ? v < -64 || v > 63 : v < 1 || v > 32)) fail('Use delimiter 1–8 chars; segment -64…63 / prefix 1…32', n.pos);
    }
    if (n.name === 'file.hasProperty' && n.args[0]?.kind === 'literal' && typeof n.args[0].value === 'string') references.add(n.args[0].value);
    if (n.name === 'file.hasProperty' && (n.args[0]?.kind !== 'literal' || typeof n.args[0].value !== 'string')) fail('Property name must be a literal string', n.pos);
    if (n.name === 'isType' && n.args[0]?.kind === 'literal' && (typeof n.args[0].value !== 'string' || !['string', 'number', 'boolean', 'list', 'null'].includes(n.args[0].value))) fail('isType needs string, number, boolean, list or null', n.pos);
    if (n.name === 'if') { if (types[0] !== 'boolean' && types[0] !== 'unknown') fail('if needs a boolean condition', n.pos); return types[1] === types[2] ? types[1]! : 'unknown'; }
    if (n.name === 'coalesce') return types.every(t => t === types[0]) ? types[0]! : 'unknown';
    if (n.name === 'slice') return receiverType === 'list' ? 'list' : receiverType === 'string' ? 'string' : 'unknown';
    return spec[2];
  };
  const type = infer(ast);
  if (references.size > EXPR_LIMITS.references) fail('Expression exceeds 16 property references', ast.pos);
  if (context === 'filter' && type !== 'boolean' && type !== 'unknown') fail(`Filter needs true/false, got ${type}; use .isTruthy()`, ast.pos);
  if (context === 'group' && type === 'list') fail('Group-by needs a scalar, got a list', ast.pos);
  return { references: [...references].sort(), type };
}
export function constantNumber(n: Ast): number | undefined { return n.kind === 'literal' && typeof n.value === 'number' ? n.value : n.kind === 'op' && n.name === 'neg' && n.args[0]?.kind === 'literal' && typeof n.args[0].value === 'number' ? -n.args[0].value : undefined; }
export function validate(source: string, context: 'filter' | 'group' = 'group') {
  try { const ast = parse(source), info = check(ast, context); return { ok: true as const, ast, ...info, errors: [] }; }
  catch (e) { return { ok: false as const, references: [] as string[], errors: [{ pos: e instanceof ExprError ? e.pos : 0, message: e instanceof Error ? e.message : 'Invalid expression' }] }; }
}
export function checked(source: string, context: 'filter' | 'group' = 'group'): Ast { const result = validate(source, context); if (!result.ok) throw new ExprError(result.errors[0]!.message, result.errors[0]!.pos); return result.ast; }
