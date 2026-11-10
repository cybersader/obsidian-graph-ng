// MIT. Independently implemented compatibility probes, not copied policy code.
// Behaviour reference: tab settings preflight at revision 0736b9ee,
// experimental/browser-native/connected-spike/lib/plugin-settings-policy.js.
// This checks the two reported declaration false-positive classes only, not
// credential detection or a substitute for the host's full sharing boundary.
export function credentialShapedField(name: string): boolean {
  const parts = name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const last = parts.at(-1) ?? '';
  if (!/^keys?$/.test(last)) return /(?:source|target|type)keys?$/i.test(last);
  const previous = parts.at(-2) ?? '';
  return !['', 'property', 'prop', 'field', 'column', 'attribute', 'attr', 'frontmatter', 'group', 'cache', 'sort', 'index', 'primary', 'foreign', 'lookup', 'row', 'record', 'id', 'name', 'metadata'].includes(previous);
}
export function opaqueHighEntropy(value: string): boolean {
  for (const run of value.split(/\s+/)) {
    if (run.length < 32) continue;
    const alphabet = new Set(run); let bits = 0;
    for (const character of alphabet) { const frequency = [...run].filter(c => c === character).length / run.length; bits -= frequency * Math.log2(frequency); }
    if (bits >= 4) return true;
  }
  return false;
}
export function compatibilityIssues(value: unknown): string[] {
  const issues: string[] = [];
  function visit(v: unknown, path: string) {
    if (typeof v === 'string' && opaqueHighEntropy(v)) issues.push(path);
    if (Array.isArray(v)) { v.forEach((child, i) => visit(child, `${path}[${i}]`)); return; }
    if (!v || typeof v !== 'object') return;
    for (const [key, child] of Object.entries(v)) { if (credentialShapedField(key) && child !== undefined && child !== null && child !== '') issues.push(`${path}.${key}`); visit(child, `${path}.${key}`); }
  }
  visit(value, '$'); return issues;
}
