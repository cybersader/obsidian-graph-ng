import { builderPredicate } from './core/expr/engine';
import { validate, type Ast } from './core/expr/syntax';
import { folderPath, type Predicate, type Scalar } from './core/declaration';

/** Plain-English text for a filter. `code` marks expressions shown verbatim (monospace). Display only. */
export interface FilterSummary { text: string; code: boolean }
const value = (v: Scalar) => v === null ? 'empty' : typeof v === 'string' ? `“${v}”` : String(v);
const list = (values: readonly Scalar[]) => `${values.slice(0, 3).map(value).join(', ')}${values.length > 3 ? ` +${values.length - 3} more` : ''}`;
function phrase(p: Exclude<Predicate, { kind: 'expr' }>, negated: boolean): string | undefined {
  if (p.kind === 'exists') return `${p.key} ${negated ? 'is missing' : 'exists'}`;
  if (p.kind === 'eq') return `${p.key} ${negated ? 'is not' : 'is'} ${value(p.value)}`;
  if (p.kind === 'in') return `${p.key} is ${negated ? 'none' : 'any'} of ${list(p.values)}`;
  const path = folderPath(p.prefix);
  if (!path) return negated ? undefined : 'All notes';
  return `${negated ? 'Not in' : 'In'} folder ${path}`;
}
function fromAst(ast: Ast): string | undefined {
  const negated = ast.kind === 'op' && ast.name === '!' && ast.args.length === 1;
  const inner = negated ? ast.args[0]! : ast;
  if (inner.kind === 'op' && inner.name === '!=' && !negated) {
    const shape = builderPredicate({ ...inner, name: '==' });
    return shape?.kind === 'eq' ? phrase(shape, true) : undefined;
  }
  const shape = builderPredicate(inner);
  return shape && phrase(shape, negated);
}
export function filterSummary(p: Predicate): FilterSummary {
  if (p.kind !== 'expr') return { text: phrase(p, false) ?? '', code: false };
  const parsed = validate(p.expr, 'filter'), text = parsed.ok ? fromAst(parsed.ast) : undefined;
  return text ? { text, code: false } : { text: p.expr, code: true };
}
