/** Synthetic owner's case (no vault data): a 221-connection hub near the top-left whose six best-connected
 * neighbours sit just under the Recent strip and tier legend, with long declared-group names. World units
 * are pixels at camera scale 1 with the hub at the origin. Shared by the unit test and the browser evidence. */
export function topLeftHub() {
  const n = 240, pairs: [number, number][] = [], xy = new Float32Array(n * 2), groups = ['Frameworks/Referenced by SCF', 'Controls/Access control family', 'Mappings/Crosswalk rows', 'Evidence/Audit artefacts', 'Policies/Corporate standards', 'Risks/Register entries'];
  for (let i = 1; i <= 221; i++) {
    pairs.push([0, i]);
    // The six best-connected neighbours sit just under the panels; the rest fan out right and down.
    const a = -Math.PI / 6 + (i * 2.399) % (Math.PI * .75), d = 150 + (i * 37) % 160;
    if (i <= 6) { xy[i * 2] = -60 + 40 * i; xy[i * 2 + 1] = 52; } else { xy[i * 2] = Math.cos(a) * d; xy[i * 2 + 1] = Math.sin(a) * d; }
  }
  for (let i = 222; i < n; i++) { pairs.push([1 + (i - 222) % 6, i]); xy[i * 2] = 600 + (i % 6) * 20; xy[i * 2 + 1] = 400 + (i % 3) * 20; }
  const paths = Array.from({ length: n }, (_, i) => i ? `${groups[i % 6]}/Control ${String(i).padStart(3, '0')} account management and access enforcement.md` : 'Frameworks/NIST SP 800-53 Rev 5 crosswalk hub.md');
  return { n, pairs, xy, paths, groupCodes: Uint32Array.from({ length: n }, (_, i) => i % 6), groupLabels: groups };
}
