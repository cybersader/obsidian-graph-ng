import { test, expect } from 'bun:test';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { FixtureFile } from './support/obsidian-fixture';

/** Opt-in synthetic-only benchmark. Preparation and exact invocations live in docs/benchmarks.md.
 * Reads the generated fixture, never an arbitrary vault. Native rendering/indexing is not measured. */
(process.env.PERF_BENCH === '1' ? test : test.skip)('synthetic 61000 note switch timing', async () => {
  const qa = new URL('../.workspace/visual-qa/', import.meta.url).pathname;
  const source = new URL(process.env.BENCH_BASELINE === '1' ? '../.workspace/baseline-source/src/' : '../src/', import.meta.url);
  const { LocalAdapter } = await import(new URL('adapter/local.ts', source).href);
  const { WorkerPipeline } = await import(new URL('pipeline.ts', source).href);
  const root = qa + 'vault-61k';
  const paths = readdirSync(root, { recursive: true }).filter(p => String(p).endsWith('.md')).map(String).sort();
  expect(paths.length).toBe(61000);
  const files = paths.map(p => new FixtureFile(p)), byPath = new Map(files.map(f => [f.path, f]));
  const caches = new Map<string, any>(), links: Record<string, Record<string, number>> = {}, ids = new Map<string, string>();
  // Deliberately just the synthetic generator's scalar/list syntax, not a production YAML parser.
  for (const path of paths) {
    const text = readFileSync(`${root}/${path}`, 'utf8'), fm: any = {}; let key = '';
    for (const line of text.split('---')[1]!.split('\n')) {
      if (line.startsWith('  - ')) { (fm[key] ||= []).push(line.slice(4)); continue; }
      const match = /^(\w+):\s*(.*)$/.exec(line);
      if (match) { key = match[1]!; fm[key] = match[2] || undefined; }
    }
    caches.set(path, { frontmatter: fm }); if (fm.uid) ids.set(fm.uid, path); links[path] = {};
  }
  for (const path of paths) for (const m of readFileSync(`${root}/${path}`, 'utf8').matchAll(/\[\[([^\]]+)\]\]/g)) {
    const target = ids.get(m[1]!); if (target) links[path]![target] = 1;
  }
  const settings = JSON.parse(readFileSync(qa + 'plugin-before/data.json', 'utf8')).settings;
  let notifications = 0;
  const app: any = {
    vault: { getMarkdownFiles: () => files, getAbstractFileByPath: (p: string) => byPath.get(p), on() {} },
    metadataCache: { resolvedLinks: links, getFileCache: (f: FixtureFile) => caches.get(f.path), on() {} },
  };
  const adapter = new LocalAdapter(app, { register() {}, registerEvent() {} }, 'obsidian-links@1.12.7', 100, () => notifications++, true, settings.declaration);
  const pipe = new WorkerPipeline(new Worker(new URL('layout-worker.ts', source).href), () => 300000);
  let ingested = ''; const runs: any[] = [];
  try {
    for (const notes of [false, true, false, true, false, true]) {
      settings.declaration = { ...settings.declaration, display: { reifiedAsNodes: notes } }; adapter.configure(settings.declaration);
      const times: any = { notes }, t = performance.now();
      const config = { declaration: settings.declaration, layout: settings.layout, source: 'obsidian-links@1.12.7/local', groupLevel: settings.groupLevel, streamEveryIterations: settings.streamEveryIterations };
      const hashes = await pipe.request(1, { kind: 'configure', config }); times.configure = performance.now() - t;
      let batches = 0, read = 0;
      for await (const batch of adapter.columns(ingested !== hashes.ingestHash, settings.ingest)) {
        read += batch.columns.paths.offsets.length - 1; await pipe.request(1, { kind: 'rows', ...batch }); batches++;
      }
      ingested = hashes.ingestHash; times.read = performance.now() - t - times.configure; times.readRows = read; times.batches = batches;
      const project = await pipe.request(1, { kind: 'project', complete: true });
      times.project = performance.now() - t - times.configure - times.read; times.nodes = project.nodes; times.edges = project.edges;
      expect(project.nodes).toBe(notes ? 61000 : 16000);
      await pipe.request(1, { kind: 'detail' }); times.detail = performance.now() - t - times.configure - times.read - times.project;
      let frames = 0; pipe.onPositions = (e: { positions: Float32Array }) => { frames++; pipe.recycle(e.positions.buffer); };
      const layout = await pipe.request(1, { kind: 'layout' });
      times.layout = layout.milliseconds; times.total = performance.now() - t; times.settled = layout.settled; times.streams = frames; times.notifications = notifications;
      expect(layout.positions.length).toBe(project.nodes * 2); expect(layout.positions.every(Number.isFinite)).toBe(true);
      runs.push(times); console.log('BENCH', JSON.stringify(times));
    }
    writeFileSync(new URL(`../.workspace/${process.env.BENCH_BASELINE === '1' ? 'before' : 'after'}-paired-timing.json`, import.meta.url), JSON.stringify(runs, null, 2));
  } finally { adapter.index.dispose(); pipe.dispose(); }
}, 300000);
