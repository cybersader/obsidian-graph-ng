import { test, expect } from 'bun:test';
import { FixtureFile } from './support/obsidian-fixture';

test('refresh invalidates an in-flight carrier index before a replacement graph arrives', async () => {
  const { GraphView } = await import('../src/main');
  const view: any = Object.create(GraphView.prototype);
  let finishRead!: (text: string) => void, refreshing: Promise<void> | undefined, paginated = 0;
  const read = new Promise<string>(resolve => { finishRead = resolve; });
  const status = { textContent: '', remove() {} };
  const graph = { groups: [], groupEdges: [] };
  const declaration = { groups: [], carrierResolvers: [{ kind: 'synthetic-id', key: 'id' }] };
  const settings = { declaration, projectionFile: 'aggregate.json', groupLevel: 0, listPageSize: 25, ingest: { chunkRows: 1, budgetMs: 8 }, maxProjectionBytes: 1024 };
  const row = { path: 'Old.md', properties: { get id() { refreshing = view.refreshOnce(); return 'old'; } } };
  Object.assign(view, {
    revision: 0, renderRevision: 0, closed: false, contributions: new Map(), members: new Map(), groupGraph: graph,
    contributionScope: JSON.stringify(['local', settings.projectionFile, settings.groupLevel, declaration.groups]),
    contributionPage: { clear() {}, suspend() {} }, status: {}, contentEl: { dataset: {} },
    panel: { empty() {}, createEl() {}, createDiv() { return status; } },
    plugin: { settings, sourceIdentity: 'local', nextRevision: 0, adapter: { *values() { yield row; } }, pipeline: { async request() { return { groups: [], groupEdges: [] }; } } },
    app: { vault: { getAbstractFileByPath() { return new FixtureFile('aggregate.json'); }, read() { return read; } } },
    paginate() { paginated++; }, showGroups() {},
  });
  await view.edgeList({ a: 'a', b: 'b', total: 1, typeCounts: { related: 1 }, carriers: { kind: 'synthetic-id', ids: ['old'] } }, graph, 1);
  expect(refreshing).toBeDefined(); expect(view.carrierLookup).toBeUndefined(); expect(paginated).toBe(0);
  finishRead('{}'); await refreshing;
});

test('late upload-window resize is reconciled before first draw and restoration', async () => {
  const previous = (globalThis as any).window;
  (globalThis as any).window = { devicePixelRatio: 1 };
  try {
    const { DetailRenderer } = await import('../src/webgl-renderer');
    const r: any = Object.create(DetailRenderer.prototype), container = { clientWidth: 800, clientHeight: 600 };
    let resized = false;
    Object.assign(r, {
      container, canvas: { width: 0, height: 0, style: {} }, ready: false, lost: false, disposed: false,
      width: 0, height: 0, dpr: 1, timings: {}, grid: { width: 1, height: 1 }, refresh() {},
      settings: { workerTimeoutMs: 1000, shaderPollMs: 1 },
      positions: new Float32Array([0, 0]), visible: new Uint8Array([1]), colorIds: new Uint32Array([0]),
      projection: { source: new Uint32Array(), target: new Uint32Array() }, theme: { palette: new Uint8Array(1024) },
      programs: [], vaos: [], discBuffers: [], async program() { return {}; }, texture() {}, uploadPalette() {}, buffer() {}, uploadView() {},
      integer() { if (!resized) { resized = true; container.clientWidth += 400; r.resize(); expect(r.canvas.width).not.toBe(container.clientWidth); } },
      gl: { SYNC_GPU_COMMANDS_COMPLETE: 1, ALREADY_SIGNALED: 2, CONDITION_SATISFIED: 3, WAIT_FAILED: 4,
        fenceSync() { return {}; }, flush() {}, clientWaitSync(_fence: unknown, _flags: number, timeout: number) { expect(timeout).toBe(0); return 2; }, deleteSync() {},
        getParameter() { return 2048; }, texImage2D() {}, createVertexArray() { return {}; }, bindVertexArray() {}, enable() {}, blendFunc() {},
        createBuffer() { return {}; }, bindBuffer() {}, enableVertexAttribArray() {}, vertexAttribPointer() {}, vertexAttribDivisor() {} },
    });
    // Both first initialization and context restoration run this same method.
    for (let pass = 0; pass < 2; pass++) {
      resized = false; r.ready = false; r.programs = []; r.vaos = [];
      await r.initialize();
      expect(r.ready).toBe(true); expect(r.canvas.width).toBe(container.clientWidth); expect(r.canvas.height).toBe(container.clientHeight);
    }
  } finally {
    if (previous === undefined) delete (globalThis as any).window;
    else (globalThis as any).window = previous;
  }
});

test('GPU resize fences poll without blocking, enforce deadline and always release', async () => {
  const { DetailRenderer } = await import('../src/webgl-renderer');
  for (const scenario of ['complete', 'failed', 'disposed', 'lost', 'timeout', 'no-fence']) {
    const r: any = Object.create(DetailRenderer.prototype); let polls = 0, deleted = 0, flushed = 0;
    Object.assign(r, { canvas: { width: 1, height: 1 }, width: 2, height: 2, dpr: 1,
      resize() {}, disposed: scenario === 'disposed', lost: scenario === 'lost', settings: { workerTimeoutMs: 1, shaderPollMs: 2 },
      gl: { SYNC_GPU_COMMANDS_COMPLETE: 1, ALREADY_SIGNALED: 2, CONDITION_SATISFIED: 3, WAIT_FAILED: 4,
        fenceSync() { return scenario === 'no-fence' ? null : {}; }, flush() { flushed++; },
        clientWaitSync(_fence: unknown, flags: number, timeout: number) {
          expect(flags).toBe(0); expect(timeout).toBe(0); polls++;
          if (scenario === 'failed') return 4;
          return scenario === 'complete' && polls > 1 ? 2 : 5;
        }, deleteSync() { deleted++; } },
    });
    if (scenario === 'complete') await r.waitForResize();
    else await expect(r.waitForResize()).rejects.toThrow(({ failed: 'GL_RESIZE_WAIT', disposed: 'Renderer superseded', lost: 'Renderer superseded', timeout: 'GL_RESIZE_TIMEOUT', 'no-fence': 'GL_RESIZE_FENCE' } as Record<string, string>)[scenario]);
    expect(deleted).toBe(scenario === 'no-fence' ? 0 : 1); expect(flushed).toBe(scenario === 'no-fence' ? 0 : 1);
  }
});
