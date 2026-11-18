import { latestWork, type WorkQueue } from './latest-work';
import { hashBytes as sha, MAX_CHUNK_BYTES as FACT_CHUNK, type BinaryAdapter } from '../core/binary-layout';
import type { FactRow } from '../core/projection';
import { digest } from '../core/declaration';
import { yieldTask } from '../core/scheduler';

export const FACT_FORMAT = 1, FACT_BYTES = 32 * 1024 * 1024;
const FACT_VALUES = 65536;
const invalid = (): never => { throw Error('Saved facts invalid or over limit'); };
type CacheKey = string | ((check: () => void) => Promise<string>);
interface Part { bytes: number; hash: string }
interface Manifest { format: number; key: string; parts: Part[] }
// Retain only a void-valued queue across plugin module reloads, never loaded facts.
interface Queue extends WorkQueue { epoch: number }
const queueKey = Symbol.for('graph-ng.startup-facts.queues');
const queues = (globalThis as unknown as Record<symbol, WeakMap<BinaryAdapter, Map<string, Queue>>>)[queueKey] ??= new WeakMap();
function bounded(value: unknown, depth = 0) {
  const pending: [unknown, number][] = [[value, depth]]; let left = FACT_VALUES;
  while (pending.length) {
    const [v, depth] = pending.pop()!;
    if (typeof v === 'number' && !Number.isFinite(v)) invalid();
    if (!v || typeof v !== 'object') continue;
    if (depth >= 64) invalid();
    const children = Object.values(v); if ((left -= children.length) < 0) invalid();
    for (const child of children) pending.push([child, depth + 1]);
  }
  return FACT_VALUES - left;
}
/** Disposable plaintext facts. One operation/IO at a time, including after a timeout.
 * A timed-out host operation cannot be cancelled; keep its queue slot until it settles. */
export class FactCache {
  paused = false;
  private queue: Queue;
  constructor(private disk: BinaryAdapter, private readonly factDirectory: string, private yieldNow = yieldTask, private deadlineMs = 15000) {
    let targets = queues.get(disk); if (!targets) queues.set(disk, targets = new Map());
    let queue = targets.get(factDirectory);
    if (!queue) targets.set(factDirectory, queue = { work: Promise.resolve(), epoch: 0 });
    this.queue = queue;
  }
  private run<T>(current: () => boolean, action: (check: () => void) => Promise<T>): Promise<T> {
    const queue = this.queue, epoch = queue.epoch, until = performance.now() + this.deadlineMs; let expired = false, timer: ReturnType<typeof setTimeout>;
    const check = () => { if (expired || performance.now() >= until) throw Error('Saved facts deadline exceeded'); if (epoch !== queue.epoch || !current()) throw Error('Saved facts cancelled'); };
    const next = queue.work.then(() => { check(); return action(check); });
    queue.work = next.then(() => {}, () => {});
    return Promise.race([next, new Promise<never>((_, reject) => { timer = setTimeout(() => { expired = true; reject(Error('Saved facts deadline exceeded')); }, this.deadlineMs); })]).finally(() => clearTimeout(timer));
  }
  clear(pause = false) {
    this.paused ||= pause; this.queue.epoch++;
    return this.run(() => true, async check => { check(); if (await this.disk.exists(this.factDirectory)) { check(); await this.disk.rmdir(this.factDirectory, true); } });
  }
  private async partition(identity?: string) {
    return identity ? `${this.factDirectory}/${await digest(identity)}` : this.factDirectory;
  }
  // Partitions and root operations share the SAME adapter/directory queue. A root
  // clear cancels every child; retiring one identity does not cancel a sibling.
  dropPartition(identity: string, current = () => true) {
    return this.run(current, async check => {
      const dir = await this.partition(identity); check();
      if (await this.disk.exists(dir)) { check(); await this.disk.rmdir(dir, true); }
    });
  }
  private child(path: string, parent: string, pattern: RegExp) {
    return path.startsWith(parent + '/') && pattern.test(path.slice(parent.length + 1));
  }
  // Churn while host I/O is stuck replaces one root-owned request, not the
  // promise tail. Its inventory and execution deadline start at service time.
  prunePartitions(inventory: () => string[] | undefined, current: () => boolean, onError?: (e: unknown) => void) {
    const prune = async (check: () => void) => {
      check(); if (!await this.disk.exists(this.factDirectory) || !this.disk.list || !this.disk.remove) return;
      check(); const { folders, files } = await this.disk.list(this.factDirectory);
      const ids = inventory(); if (!ids?.length) return;
      const known = new Set(ids), keep = new Set<string>();
      for (const id of known) { check(); keep.add(await this.partition(id)); }
      // Hashing and each deletion yield. A fresh successful inventory must
      // contain no unaccounted-for identity at the call to destructive I/O.
      const safe = () => { check(); const live = inventory(); return live?.length && live.every(id => known.has(id)); };
      for (const dir of folders) if (this.child(dir, this.factDirectory, /^[a-f0-9]{64}$/) && !keep.has(dir)) {
        if (!safe()) return; await this.disk.rmdir(dir, true);
      }
      for (const file of files) if (this.child(file, this.factDirectory, /^(manifest\.json|\d+\.bin)$/)) {
        if (!safe()) return; await this.disk.remove(file);
      }
    };
    if (!onError) return this.run(current, prune);
    const epoch = this.queue.epoch;
    void latestWork(this.queue, async () => {
      const until = performance.now() + this.deadlineMs;
      await prune(() => { if (!current() || epoch !== this.queue.epoch || performance.now() >= until) throw Error('Saved facts reconciliation stopped'); }).catch(onError);
    });
  }
  load(key: CacheKey, current: () => boolean, identity?: string, budget = { bytes: 0, parts: 0 }): Promise<Map<string, FactRow> | undefined> {
    return this.run(current, async check => {
      const dir = await this.partition(identity);
      const path = `${dir}/manifest.json`; check();
      if (!await this.disk.exists(path)) return;
      key = typeof key === 'string' ? key : await key(check); check();
      check(); const size = (await this.disk.stat(path))?.size;
      if (!size || size > FACT_CHUNK) invalid();
      check(); const m: Manifest = JSON.parse(await this.disk.read(path));
      if (m.format !== FACT_FORMAT || m.key !== key) { check(); await this.disk.rmdir(dir, true); check(); return; }
      if (!Array.isArray(m.parts) || m.parts.length > 4096) invalid();
      if (budget.parts + m.parts.length > 4096) return;
      let bytesRead = 0;
      const rows = new Map<string, FactRow>();
      for (let i = 0; i < m.parts.length; i++) {
        check(); const p = m.parts[i]!;
        if (!Number.isSafeInteger(p.bytes) || p.bytes < 1 || p.bytes > FACT_CHUNK || typeof p.hash !== 'string' || !/^[a-f0-9]{64}$/.test(p.hash) || (bytesRead += p.bytes) > FACT_BYTES) invalid();
        if (budget.bytes + bytesRead > FACT_BYTES) return;
        const file = `${dir}/${i}.bin`;
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
      check(); budget.parts += m.parts.length; budget.bytes += bytesRead; return rows;
    });
  }
  save(key: CacheKey, rows: Iterable<FactRow>, current: () => boolean, commitCurrent = current, identity?: string) {
    return this.run(current, async check => {
      const dir = await this.partition(identity);
      key = typeof key === 'string' ? key : await key(check); check();
      // Retire the old commit point before overwriting chunks; no partial generation can load.
      check(); if (await this.disk.exists(dir)) { check(); await this.disk.rmdir(dir, true); }
      const pieces = dir.split('/');
      for (let i = 1; i <= pieces.length; i++) { check(); const p = pieces.slice(0, i).join('/'); if (!await this.disk.exists(p)) { check(); await this.disk.mkdir(p); } }
      const parts: Part[] = []; let batch: string[] = [], size = 2, values = 0, total = 0, count = 0;
      let siblings = 0;
      if (identity) {
        // Charge actual sibling chunks (even unfinished writes), within the same
        // queue slot. Partitioning must not multiply the existing storage ceiling.
        if (!this.disk.list) return invalid();
        check(); const { folders } = await this.disk.list(this.factDirectory);
        for (const other of folders) if (other !== dir && this.child(other, this.factDirectory, /^[a-f0-9]{64}$/)) {
          check(); const { files } = await this.disk.list(other);
          for (const file of files) if (this.child(file, other, /^\d+\.bin$/)) {
            check(); const n = (await this.disk.stat(file))?.size;
            if (n === undefined || !Number.isSafeInteger(n) || n < 0 || (total += n) > FACT_BYTES || ++siblings > 4096) invalid();
          }
        }
      }
      const flush = async () => {
        check(); const bytes = new TextEncoder().encode(`[${batch.join(',')}]`);
        if (bytes.length > FACT_CHUNK || (total += bytes.length) > FACT_BYTES || siblings + parts.length >= 4096) invalid();
        const hash = await sha(bytes); check();
        const part = parts.length;
        await this.disk.writeBinary(`${dir}/${part}.bin`, bytes.buffer);
        parts.push({ bytes: bytes.length, hash }); batch = []; size = 2; values = 0; await this.yieldNow();
      };
      for (const row of rows) {
        check(); if (++count > 100000) invalid();
        bounded(row, 1); // Reject cycles, excessive depth and nonfinite values before JSON can normalize them.
        const text = JSON.stringify(row), bytes = new TextEncoder().encode(text).length;
        if (bytes + 2 > FACT_CHUNK) invalid();
        // Count the exact JSON representation, including sparse-array nulls and the batch row slot.
        const children = bounded(JSON.parse(text), 1) + 1;
        if (children > FACT_VALUES) invalid();
        if (size + bytes + (batch.length ? 1 : 0) > FACT_CHUNK || values + children > FACT_VALUES) await flush();
        size += bytes + (batch.length ? 1 : 0); values += children; batch.push(text);
        if (batch.length === 256) await flush();
      }
      if (batch.length) await flush();
      const commitCheck = () => { if (!commitCurrent()) throw Error('Saved facts cancelled'); check(); };
      commitCheck(); await this.disk.write(`${dir}/manifest.json`, JSON.stringify({ format: FACT_FORMAT, key, parts }));
      // An in-flight host write cannot be cancelled. Withdraw a stale commit
      // while this queue still owns the directory, before any subsequent load.
      try { commitCheck(); } catch (error) { await this.disk.rmdir(dir, true); throw error; }
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
