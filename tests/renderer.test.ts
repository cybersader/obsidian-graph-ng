import { test, expect } from 'bun:test';
import { PickGrid, positionTexture, incidentEdges, segmentDistance, placeLabels, labelLOD, LABEL_RATIOS, canvasDetailEdges, resizeDrawingBuffer } from '../src/render-data';
import { buildProjection } from '../src/core/projection';
import { defaultDeclaration, validateDeclaration } from '../src/core/declaration';
import { defaults, upgradeSettings, validateSettings } from '../src/settings';

test('packed picking handles negative coordinates, ties, hidden and empty nodes', () => {
  const grid = new PickGrid(new Float32Array([-10, -5, -10, -5, 50, 50]), new Uint8Array([1, 1, 0]));
  expect(grid.pick(-10, -5, 1)).toBe(0); expect(grid.pick(50, 50, 1)).toBe(-1); expect(grid.pick(1e9, 1e9, 1)).toBe(-1);
  expect(new PickGrid(new Float32Array(), new Uint8Array()).pick(0, 0, 10)).toBe(-1);
  expect(() => new PickGrid(new Float32Array([0]), new Uint8Array([1]))).toThrow('RENDER_POSITION_COUNT');
  expect(() => new PickGrid(new Float32Array([NaN, 0]), new Uint8Array([1]))).toThrow('RENDER_NONFINITE_POSITION');
});
test('packed grid picks agree with a brute-force oracle for seeded synthetic points', () => {
  const positions = new Float32Array(4000), visible = new Uint8Array(2000); let state = 17;
  const random = () => ((state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < 2000; i++) { positions[i * 2] = random() * 1000 - 500; positions[i * 2 + 1] = random() * 1000 - 500; visible[i] = i % 3 ? 1 : 0; }
  const grid = new PickGrid(positions, visible);
  for (let j = 0; j < 300; j++) {
    const x = random() * 1200 - 600, y = random() * 1200 - 600, r = random() * 80; let best = -1, distance = r * r;
    for (let i = 0; i < visible.length; i++) if (visible[i]) { const d = (positions[i * 2]! - x) ** 2 + (positions[i * 2 + 1]! - y) ** 2; if (d < distance) { distance = d; best = i; } }
    expect(grid.pick(x, y, r)).toBe(best);
  }
});
test('position texture preserves SoA coordinates, pads only final row and reuses aligned data', () => {
  const a = new Float32Array([1, 2, 3, 4, 5, 6]), t = positionTexture(a, 2);
  expect(t.width).toBe(2); expect(t.height).toBe(2); expect([...t.data]).toEqual([1, 2, 3, 4, 5, 6, 0, 0]);
  expect(positionTexture(a, 3).data).toBe(a); expect(positionTexture(new Float32Array()).data.length).toBe(2);
});
test('incident edge CSR includes incoming, outgoing, parallel and self edges', () => {
  const d = defaultDeclaration('test@1'); d.edges = [{ kind: 'inline', name: 'link', key: 'to', type: 'link' }];
  const p = buildProjection([{ path: 'A.md', properties: { to: ['A.md', 'B.md'] } }, { path: 'B.md', properties: { to: ['A.md'] } }], d), csr = incidentEdges(p);
  expect([...csr.offsets]).toEqual([0, 4, 6]);
  expect([...csr.edges.slice(csr.offsets[0], csr.offsets[1])].sort()).toEqual([0, 0, 1, 2]);
});
test('segment picking clamps endpoints and handles zero-length edges', () => {
  expect(segmentDistance(5, 2, 0, 0, 10, 0)).toBe(2); expect(segmentDistance(12, 0, 0, 0, 10, 0)).toBe(2); expect(segmentDistance(3, 4, 0, 0, 0, 0)).toBe(5);
});
test('per-LOD greedy placement is deterministic, bounded, nonoverlapping and crosses grid cells', () => {
  const candidates = Array.from({ length: 200 }, (_, node) => ({ node, x: node % 20 * 6 - 50, y: Math.floor(node / 20) * 8 - 50, w: 20, h: 14 }));
  const placed = placeLabels(candidates, 16, 15); expect(placed.length).toBe(15); expect(placeLabels(candidates, 16, 15)).toEqual(placed);
  for (let i = 0; i < placed.length; i++) for (let j = i + 1; j < placed.length; j++) { const a = placed[i]!, b = placed[j]!; expect(a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y).toBe(false); }
});
test('LOD picks conservative precomputed scale, including out-of-range zoom', () => {
  expect(labelLOD(.3)).toBe(2); expect(labelLOD(1)).toBe(3); expect(labelLOD(.001)).toBe(0); expect(labelLOD(99)).toBe(LABEL_RATIOS.length - 1);
});
test('declared colors accept bounded variable references, not arbitrary CSS', () => {
  const d = defaultDeclaration('test@1'); d.colors = [{ name: 'color', color: 'var(--graph-custom-node)', predicate: { kind: 'folder', prefix: '' } }];
  expect(() => validateDeclaration(d)).not.toThrow();
  d.colors[0]!.color = 'url(https://invalid.example/x)'; expect(() => validateDeclaration(d)).toThrow('Color must');
});
test('new renderer knobs migrate missing settings and reject invalid ranges', () => {
  const s = defaults('test@1'), old = structuredClone(s) as any;
  const keys = ['labelsMaxPerViewport', 'canvasMaxDetailNodes', 'canvasMaxDetailEdges', 'labelCandidateMultiplier', 'frameBackstopMs', 'shaderPollMs', 'contextRestoreTimeoutMs', 'cameraMinRatio', 'cameraMaxRatio'] as const;
  for (const key of keys) delete old[key];
  const upgraded = upgradeSettings(old, 'test@1');
  for (const key of keys) { expect(upgraded[key]).toBe(s[key]); expect(() => validateSettings({ ...s, [key]: 0 })).toThrow(); }
  expect(() => validateSettings({ ...s, cameraMinRatio: 8, cameraMaxRatio: 8 })).toThrow('cameraMinRatio');
  expect(() => validateSettings({ ...s, labelCandidateMultiplier: 1.5 })).toThrow();
});
test('software edge and node budgets reject excess work, never silently truncate', () => {
  const p = { source: new Uint32Array([0, 0, 1, 2]), target: new Uint32Array([0, 1, 0, 0]) }, visible = new Uint8Array([1, 1, 0]);
  expect([...canvasDetailEdges(p, visible, 2, 3)]).toEqual([0, 1, 2]);
  expect(() => canvasDetailEdges(p, visible, 1, 3)).toThrow('CANVAS_DETAIL_NODE_LIMIT');
  expect(() => canvasDetailEdges(p, visible, 2, 2)).toThrow('CANVAS_DETAIL_EDGE_LIMIT');
});

test('drawing-buffer resize never resets an unchanged axis', () => {
  let width = 800, height = 600; const writes: string[] = [];
  const canvas = { get width() { return width; }, set width(v: number) { writes.push('width'); width = v; },
    get height() { return height; }, set height(v: number) { writes.push('height'); height = v; } };
  resizeDrawingBuffer(canvas, 800, 600); expect(writes).toEqual([]);
  resizeDrawingBuffer(canvas, 800, 500); expect(writes).toEqual(['height']);
  resizeDrawingBuffer(canvas, 900, 500); expect(writes).toEqual(['height', 'width']);
  resizeDrawingBuffer(canvas, 1800, 1000); expect(writes).toEqual(['height', 'width', 'width', 'height']);
  expect([canvas.width, canvas.height]).toEqual([1800, 1000]);
});
