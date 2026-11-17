import { hashBytes as sha, MAX_CHUNK_BYTES as FACT_CHUNK, type BinaryAdapter } from '../core/binary-layout';
import type { FactRow } from '../core/projection';
import { digest } from '../core/declaration';
import { yieldTask } from '../core/scheduler';

export const FACT_FORMAT = 1, FACT_BYTES = 32 * 1024 * 1024;
const invalid = (): never => { throw Error('Saved facts invalid or over limit'); };
type CacheKey = string | ((check: () => void) => Promise<string>);
interface Part { bytes: number; hash: string }
interface Manifest { format: number; key: string; parts: Part[] }
// Retain only a void-valued queue across plugin module reloads, never loaded facts.
interface Queue { work: Promise<void>; epoch: number }
const queueKey = Symbol.for('graph-ng.startup-facts.queue');
const queue = (globalThis as unknown as Record<symbol, Queue>)[queueKey] ??= { work: Promise.resolve(), epoch: 0 };
function bounded(value: unknown) {
  const pending: [unknown, number][] = [[value, 0]]; let left = 65536;
  while (pending.length) {
    const [v, depth] = pending.pop()!;
    if (typeof v === 'number' && !Number.isFinite(v)) invalid();
    if (!v || typeof v !== 'object') continue;
    if (depth >= 64) invalid();
    const children = Object.values(v); if ((left -= children.length) < 0) invalid();
    for (const child of children) pending.push([child, depth + 1]);
  }
}
/** Disposable plaintext facts. One operation/IO at a time, including after a timeout.
 * A timed-out host operation cannot be cancelled; keep its queue slot until it settles. */
export class FactCache {
  paused = false;
  constructor(private disk: BinaryAdapter, private readonly factDirectory: string, private yieldNow = yieldTask, private deadlineMs = 15000) {}
  private run<T>(current: () => boolean, action: (check: () => void) => Promise<T>): Promise<T> {
    const epoch = queue.epoch, until = performance.now() + this.deadlineMs; let expired = false, timer: ReturnType<typeof setTimeout>;
    const check = () => { if (expired || performance.now() >= until) throw Error('Saved facts deadline exceeded'); if (epoch !== queue.epoch || !current()) throw Error('Saved facts cancelled'); };
    const next = queue.work.then(() => { check(); return action(check); });
    queue.work = next.then(() => {}, () => {});
    return Promise.race([next, new Promise<never>((_, reject) => { timer = setTimeout(() => { expired = true; reject(Error('Saved facts deadline exceeded')); }, this.deadlineMs); })]).finally(() => clearTimeout(timer));
  }
  clear(pause = false) {
    this.paused ||= pause; queue.epoch++;
    return this.run(() => true, async check => { check(); if (await this.disk.exists(this.factDirectory)) { check(); await this.disk.rmdir(this.factDirectory, true); } });
  }
  load(key: CacheKey, current: () => boolean): Promise<Map<string, FactRow> | undefined> {
    return this.run(current, async check => {
      const path = `${this.factDirectory}/manifest.json`; check();
      if (!await this.disk.exists(path)) return;
      key = typeof key === 'string' ? key : await key(check); check();
      check(); const size = (await this.disk.stat(path))?.size;
      if (!size || size > FACT_CHUNK) invalid();
      check(); const m: Manifest = JSON.parse(await this.disk.read(path));
      if (m.format !== FACT_FORMAT || m.key !== key) { check(); await this.disk.rmdir(this.factDirectory, true); check(); return; }
      if (!Array.isArray(m.parts) || m.parts.length > 4096) invalid();
      const rows = new Map<string, FactRow>(); let total = 0;
      for (let i = 0; i < m.parts.length; i++) {
        check(); const p = m.parts[i]!;
        if (!Number.isSafeInteger(p.bytes) || p.bytes < 1 || p.bytes > FACT_CHUNK || typeof p.hash !== 'string' || !/^[a-f0-9]{64}$/.test(p.hash) || (total += p.bytes) > FACT_BYTES) invalid();
        const file = `${this.factDirectory}/${i}.bin`;
        if ((await this.disk.stat(file))?.size !== p.bytes) invalid();
        check(); const bytes = new Uint8Array(await this.disk.readBinary(file));
        if (bytes.length !== p.bytes || await sha(bytes) !== p.hash) invalid();
        const batch: FactRow[] = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
        if (!Array.isArray(batch) || batch.length > 256) invalid();
        bounded(batch);
        for (const row of batch) {
          if (!row || typeof row.path !== 'string' || rows.has(row.path) || !row.properties || typeof row.properties !== 'object' || Array.isArray(row.properties) || (row.links !== undefined && (!row.links || typeof row.links !== 'object' || Object.values(row.links).some(v => !Array.isArray(v) || v.some(p => typeof p !== 'string'))))) invalid();
          rows.set(row.path, row);
          if (rows.size > 100000) invalid();
        }
        await this.yieldNow();
      }
      check(); return rows;
    });
  }
  save(key: CacheKey, rows: Iterable<FactRow>, current: () => boolean) {
    return this.run(current, async check => {
      key = typeof key === 'string' ? key : await key(check); check();
      // Retire the old commit point before overwriting chunks; no partial generation can load.
      check(); if (await this.disk.exists(this.factDirectory)) { check(); await this.disk.rmdir(this.factDirectory, true); }
      const pieces = this.factDirectory.split('/');
      for (let i = 1; i <= pieces.length; i++) { check(); const p = pieces.slice(0, i).join('/'); if (!await this.disk.exists(p)) { check(); await this.disk.mkdir(p); } }
      const parts: Part[] = []; let batch: string[] = [], size = 2, total = 0, count = 0;
      const flush = async () => {
        check(); const bytes = new TextEncoder().encode(`[${batch.join(',')}]`);
        if (bytes.length > FACT_CHUNK || (total += bytes.length) > FACT_BYTES || parts.length >= 4096) invalid();
        const hash = await sha(bytes); check();
        const part = parts.length;
        await this.disk.writeBinary(`${this.factDirectory}/${part}.bin`, bytes.buffer);
        parts.push({ bytes: bytes.length, hash }); batch = []; size = 2; await this.yieldNow();
      };
      for (const row of rows) {
        check(); if (++count > 100000) invalid();
        const text = JSON.stringify(row), bytes = new TextEncoder().encode(text).length;
        if (bytes + 2 > FACT_CHUNK) invalid();
        if (size + bytes + (batch.length ? 1 : 0) > FACT_CHUNK) await flush();
        size += bytes + (batch.length ? 1 : 0); batch.push(text);
        if (batch.length === 256) await flush();
      }
      if (batch.length) await flush();
      check(); await this.disk.write(`${this.factDirectory}/manifest.json`, JSON.stringify({ format: FACT_FORMAT, key, parts }));
      check();
    });
  }
}
/** Whole-vault resolution namespace, not just declared/excluded Markdown rows.
 * File stamps invalidate cheaply but never establish content equality. */
export async function factKey(files: { path: string; stat: { mtime: number; size: number } }[], scope: unknown, check: () => void) {
  if (files.length > 100000) invalid();
  type Stamp = [string, number, number];
  let ordered: Stamp[] = []; const parts: string[] = [];
  for (let i = 0; i < files.length; i += 256) {
    check(); const part: Stamp[] = [];
    for (const f of files.slice(i, i + 256)) {
      if (!Number.isFinite(f.stat.mtime) || !Number.isSafeInteger(f.stat.size) || f.stat.size < 0) invalid();
      part.push([f.path, f.stat.mtime, f.stat.size]);
    }
    part.sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0); ordered.push(...part);
    await yieldTask();
  }
  let scratch = new Array<Stamp>(ordered.length);
  for (let width = 256; width < ordered.length; width *= 2) {
    check();
    for (let start = 0; start < ordered.length; start += width * 2) {
      let left = start, right = Math.min(start + width, ordered.length);
      const middle = right, end = Math.min(start + width * 2, ordered.length);
      for (let k = start; k < end; k++) {
        scratch[k] = left < middle && (right === end || ordered[left]![0] <= ordered[right]![0]) ? ordered[left++]! : ordered[right++]!;
        if ((k & 1023) === 1023) { check(); await yieldTask(); }
      }
    }
    [ordered, scratch] = [scratch, ordered];
  }
  for (let i = 0; i < ordered.length; i += 256) {
    check(); parts.push(await digest(ordered.slice(i, i + 256))); await yieldTask();
  }
  check(); return digest({ format: FACT_FORMAT, scope, parts });
}
