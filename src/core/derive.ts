/** Derived group values: a bounded, deterministic transform of one existing declared
 * value. Users never stamp new properties onto notes for the graph's sake. Only
 * linear-time split transforms exist; regular expressions are deliberately excluded
 * (no backtracking cost can be smuggled through user settings). */
export type DerivedTransform =
  | { kind: 'segment'; delimiter: string; index: number }
  | { kind: 'prefix'; delimiter: string; segments: number };
/** Input values are truncated before any transform; transforms run once per distinct value. */
export const DERIVE_INPUT_LIMIT = 256;
export const MISSING = '(missing)', NO_MATCH = '(no match)';
const record = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
export function validateTransform(t: unknown): asserts t is DerivedTransform {
  if (!record(t)) throw new Error('Derived transform must be an object');
  const keys = Object.keys(t), only = (allowed: string[]) => { for (const k of keys) if (!allowed.includes(k)) throw new Error(`Unknown field: ${k}`); };
  const delimiter = () => { if (typeof t.delimiter !== 'string' || !t.delimiter || t.delimiter.length > 8) throw new Error('Delimiter must be 1–8 characters'); };
  if (t.kind === 'segment') { only(['kind', 'delimiter', 'index']); delimiter(); if (!Number.isSafeInteger(t.index) || (t.index as number) < -64 || (t.index as number) > 63) throw new Error('Segment index must be -64…63'); }
  else if (t.kind === 'prefix') { only(['kind', 'delimiter', 'segments']); delimiter(); if (!Number.isSafeInteger(t.segments) || (t.segments as number) < 1 || (t.segments as number) > 32) throw new Error('Prefix segments must be 1…32'); }
  else if (t.kind === 'pattern') throw new Error('Pattern (regex) derived groups are no longer supported; use segment or prefix');
  else throw new Error('Derived transform kind must be segment or prefix');
}
/** Text for one raw property value: strings as-is, scalars stringified, first scalar of a list. */
export function deriveInput(value: unknown): string | undefined {
  const v = Array.isArray(value) ? value.find(x => x !== null && ['string', 'number', 'boolean'].includes(typeof x)) : value;
  return v === undefined || v === null || typeof v === 'object' ? undefined : String(v).slice(0, DERIVE_INPUT_LIMIT);
}
export function compileTransform(t: DerivedTransform): (text: string | undefined) => string {
  return text => {
    if (text === undefined) return MISSING;
    const parts = text.split(t.delimiter);
    if (t.kind === 'prefix') return parts.length > t.segments ? parts.slice(0, t.segments).join(t.delimiter) : NO_MATCH;
    return parts.length > 1 ? parts.at(t.index) || NO_MATCH : NO_MATCH;
  };
}
export const describeTransform = (t: DerivedTransform) => t.kind === 'prefix' ? `first ${t.segments} “${t.delimiter}” segments` : `segment ${t.index} of “${t.delimiter}”`;
