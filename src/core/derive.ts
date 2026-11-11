/** Derived group values: a bounded, deterministic transform of one existing declared
 * value. Users never stamp new properties onto notes for the graph's sake. */
export type DerivedTransform =
  | { kind: 'segment'; delimiter: string; index: number }
  | { kind: 'prefix'; delimiter: string; segments: number }
  | { kind: 'pattern'; pattern: string };
/** Input values are truncated before any transform; patterns run once per distinct value. */
export const DERIVE_INPUT_LIMIT = 256;
export const MISSING = '(missing)', NO_MATCH = '(no match)';
const record = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
/** Restricted regex subset: one capture group, no alternation, nesting, lookaround or
 * backreference; at most three quantified atoms, one unbounded, bounded counts ≤ 16.
 * Length < 32 keeps settings free of long opaque-looking strings. */
export function validatePattern(pattern: unknown): asserts pattern is string {
  if (typeof pattern !== 'string' || !pattern || pattern.length > 31) throw new Error('Derived pattern must be 1–31 characters');
  let i = 0, groups = 0, depth = 0, quantified = 0, unbounded = 0, atom = false;
  const fail = (why: string): never => { throw new Error(`Derived pattern rejected: ${why}`); };
  while (i < pattern.length) {
    const c = pattern[i]!;
    if (c === '\\') { const n = pattern[i + 1]; if (n === undefined || /[1-9bBkpPuxc0]/.test(n)) fail('unsupported escape'); i += 2; atom = true; continue; }
    if (c === '[') { const end = pattern.indexOf(']', i + 2); if (end < 0 || pattern.slice(i + 1, end).includes('[')) fail('unterminated or nested class'); i = end + 1; atom = true; continue; }
    if (c === '(') { if (depth || groups || pattern[i + 1] === '?') fail('only one plain capture group is allowed'); depth++; groups++; i++; atom = false; continue; }
    if (c === ')') { if (!depth) fail('unbalanced group'); depth--; i++; if (/[*+?{]/.test(pattern[i] ?? '')) fail('a group cannot be quantified'); atom = false; continue; }
    if (c === '|') fail('alternation is not allowed');
    if (c === '*' || c === '+' || c === '?' || c === '{') {
      if (!atom) fail('quantifier without an atom');
      if (c === '{') { const m = /^\{(\d{1,2})(?:,(\d{1,2}))?\}/.exec(pattern.slice(i)); if (!m || Number(m[2] ?? m[1]) > 16 || Number(m[1]) > Number(m[2] ?? m[1])) fail('bounded counts must be ≤ 16'); i += m![0].length; }
      else { if (c !== '?') unbounded++; i++; }
      if (pattern[i] === '?') i++;
      quantified++; atom = false;
      if (quantified > 3 || unbounded > 1) fail('too many quantifiers');
      continue;
    }
    i++; atom = c !== '^' && c !== '$';
  }
  if (depth) fail('unbalanced group');
  new RegExp(pattern, 'u');
}
export function validateTransform(t: unknown): asserts t is DerivedTransform {
  if (!record(t)) throw new Error('Derived transform must be an object');
  const keys = Object.keys(t), only = (allowed: string[]) => { for (const k of keys) if (!allowed.includes(k)) throw new Error(`Unknown field: ${k}`); };
  const delimiter = () => { if (typeof t.delimiter !== 'string' || !t.delimiter || t.delimiter.length > 8) throw new Error('Delimiter must be 1–8 characters'); };
  if (t.kind === 'segment') { only(['kind', 'delimiter', 'index']); delimiter(); if (!Number.isSafeInteger(t.index) || (t.index as number) < -64 || (t.index as number) > 63) throw new Error('Segment index must be -64…63'); }
  else if (t.kind === 'prefix') { only(['kind', 'delimiter', 'segments']); delimiter(); if (!Number.isSafeInteger(t.segments) || (t.segments as number) < 1 || (t.segments as number) > 32) throw new Error('Prefix segments must be 1…32'); }
  else if (t.kind === 'pattern') { only(['kind', 'pattern']); validatePattern(t.pattern); }
  else throw new Error('Derived transform kind must be segment, prefix or pattern');
}
/** Text for one raw property value: strings as-is, scalars stringified, first scalar of a list. */
export function deriveInput(value: unknown): string | undefined {
  const v = Array.isArray(value) ? value.find(x => x !== null && ['string', 'number', 'boolean'].includes(typeof x)) : value;
  return v === undefined || v === null || typeof v === 'object' ? undefined : String(v).slice(0, DERIVE_INPUT_LIMIT);
}
export function compileTransform(t: DerivedTransform): (text: string | undefined) => string {
  const regex = t.kind === 'pattern' ? new RegExp(t.pattern, 'u') : undefined;
  return text => {
    if (text === undefined) return MISSING;
    if (t.kind === 'pattern') { const m = regex!.exec(text); return m ? (m[1] ?? m[0]) || NO_MATCH : NO_MATCH; }
    const parts = text.split(t.delimiter);
    if (t.kind === 'prefix') return parts.length > t.segments ? parts.slice(0, t.segments).join(t.delimiter) : NO_MATCH;
    return parts.length > 1 ? parts.at(t.index) || NO_MATCH : NO_MATCH;
  };
}
export const describeTransform = (t: DerivedTransform) => t.kind === 'pattern' ? `pattern ${t.pattern}` : t.kind === 'prefix' ? `first ${t.segments} “${t.delimiter}” segments` : `segment ${t.index} of “${t.delimiter}”`;
