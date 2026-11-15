import { builderPredicate, editAsExpression } from './core/expr/engine';
import { validate, type Ast } from './core/expr/syntax';
import { folderPath, type Predicate, type Scalar } from './core/declaration';

/** Plain-English text for a filter. `code` marks expressions shown verbatim (monospace). Display only. */
export interface FilterSummary { text: string; code: boolean }
type Shape = Exclude<Predicate, { kind: 'expr' }>;
const value = (v: Scalar) => v === null ? 'empty' : typeof v === 'string' ? `“${v}”` : String(v);
const list = (values: readonly Scalar[]) => `${values.slice(0, 3).map(value).join(', ')}${values.length > 3 ? ` +${values.length - 3} more` : ''}`;
function phrase(p: Shape, negated: boolean): string | undefined {
  if (p.kind === 'exists') return `${p.key} ${negated ? 'is missing' : 'exists'}`;
  if (p.kind === 'eq') return `${p.key} ${negated ? 'is not' : 'is'} ${value(p.value)}`;
  if (p.kind === 'in') return `${p.key} is ${negated ? 'none' : 'any'} of ${list(p.values)}`;
  const path = folderPath(p.prefix);
  if (!path) return negated ? undefined : 'All notes';
  return `${negated ? 'Not in' : 'In'} folder ${path}`;
}
/** A recognizable filter as one builder shape plus negation parity (`!`, `!=`); undefined for anything else. */
/** `strict` marks a `!=` comparison, which (unlike `!(a == b)`) is false for a note missing the key, so it hides those too. */
export function filterShape(p: Predicate): { shape: Shape; negated: boolean; strict?: boolean } | undefined {
  if (p.kind !== 'expr') return { shape: p, negated: false };
  const parsed = validate(p.expr, 'filter'); if (!parsed.ok) return undefined;
  let ast: Ast = parsed.ast, negated = false, strict = false;
  while (ast.kind === 'op' && ast.name === '!' && ast.args.length === 1) { negated = !negated; ast = ast.args[0]!; }
  if (ast.kind === 'op' && ast.name === '!=') { negated = !negated; strict = true; ast = { ...ast, name: '==' }; }
  const shape = builderPredicate(ast);
  return shape && (!negated || shape.kind !== 'folder' || shape.prefix.length) ? { shape, negated, strict } : undefined;
}
export function filterSummary(p: Predicate): FilterSummary {
  const s = filterShape(p), text = s && phrase(s.shape, s.negated);
  return text ? { text, code: false } : { text: p.kind === 'expr' ? p.expr : '', code: true };
}
/** What a filter hides, worded to follow "Hiding 12 notes": "where kind exists", "outside folder A". */
export function hiddenClause(p: Predicate): FilterSummary {
  const s = filterShape(p), text = s && phrase(s.shape, !s.negated);
  if (!text) return { text: filterSummary(p).text, code: true };
  return { text: text.startsWith('Not in') ? `outside${text.slice(6)}` : text.startsWith('In ') ? `in${text.slice(2)}` : `where ${text}`, code: false };
}
const expr = (text: string): Predicate => ({ kind: 'expr', expr: text });
/** Raw dictionary values (facet `raw`, "undefined" for missing) of `key` that toggle-shaped filters hide,
 * and which filters those are. Only negated value lists and presence tests on `key` count as toggles. */
export function toggledValues(filters: readonly Predicate[], key: string, present: readonly string[]) {
  const hidden = new Set<string>(), owned: number[] = [];
  filters.forEach((f, i) => {
    const s = filterShape(f), shape = s?.shape;
    if (!shape || shape.kind === 'folder' || shape.key !== key || (shape.kind !== 'exists' && !s.negated)) return;
    owned.push(i);
    if (shape.kind === 'exists') { if (s.negated) present.forEach(v => hidden.add(v)); else hidden.add('undefined'); }
    else { for (const v of shape.kind === 'in' ? shape.values : [shape.value]) hidden.add(JSON.stringify(v)); if (s.strict) hidden.add('undefined'); }
  });
  return { hidden, owned };
}
/** Replace the toggle-shaped filters on `key` with the fewest filters hiding exactly `hidden`, in place. */
export function setToggles(filters: readonly Predicate[], key: string, present: readonly string[], hidden: ReadonlySet<string>): Predicate[] {
  const { owned } = toggledValues(filters, key, present), next = filters.filter((_, i) => !owned.includes(i)), add: Predicate[] = [];
  const exists = editAsExpression({ kind: 'exists', key }).text, values = present.filter(v => hidden.has(v));
  if (!exists || !toggleable(values)) return [...filters];
  if (hidden.has('undefined')) add.push(expr(exists));
  if (values.length && values.length === present.length) add.push(expr(`!${exists}`));
  else if (values.length) {
    // An inexpressible list leaves the user's filters untouched rather than writing a broken one.
    const list = editAsExpression({ kind: 'in', key, values: values.map(v => JSON.parse(v) as Scalar) }).text; if (!list) return [...filters];
    add.push(expr(`!${list}`));
  }
  next.splice(owned[0] ?? next.length, 0, ...add);
  return next;
}
/** Toggles only cover scalar values: a list or object value (a multi-valued property) has no value-list filter. */
export const toggleable = (raws: readonly string[]) => raws.every(v => v === 'undefined' || !/^[[{]/.test(v));
