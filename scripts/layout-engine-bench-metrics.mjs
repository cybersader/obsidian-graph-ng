export function compare(a, b) {
  const nearestOverlap = a.near.reduce((sum, ids, i) => sum + ids.filter(id => b.near[i].includes(id)).length, 0) / (a.near.length * a.near[0].length);
  return { edge: Math.abs(a.edgeStress - b.edgeStress), graph: Math.abs(a.graphStress - b.graphStress), overlap: nearestOverlap };
}

function thresholdTimes(rows, metric) {
  return [0.8, 0.9, 0.95].map(fraction => {
    const meets = row => Number.isFinite(row[metric]) && row[metric] >= fraction;
    const lastBelow = rows.findLastIndex(row => !meets(row));
    return { fraction, firstMs: rows.find(meets)?.ms ?? null, sustainedMs: rows[lastBelow + 1]?.ms ?? null };
  });
}

export function checkpointTiming(checkpoints, final, settled, intervalMs) {
  const initial = compare(checkpoints[0].quality, final);
  const rows = checkpoints.map(({ quality: sample, ...row }) => {
    const { edge, graph, overlap } = compare(sample, final), finite = sample.finite && final.finite;
    // Also track the large-scale signal without requiring exact local neighbour IDs.
    const stressAgreement = Math.max(0, 1 - Math.max(edge / Math.max(initial.edge, Number.EPSILON), graph / Math.max(initial.graph, Number.EPSILON)));
    return { ...row, edgeStress: sample.edgeStress, graphStress: sample.graphStress, overlap,
      stressAgreement: finite ? stressAgreement : null,
      agreement: finite ? Math.min(1 - edge, 1 - graph, overlap) : null };
  });
  return { intervalMs, reference: settled ? 'first-settled' : 'step-cap',
    thresholds: thresholdTimes(rows, 'agreement'), stressThresholds: thresholdTimes(rows, 'stressAgreement'), checkpoints: rows };
}
