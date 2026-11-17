import { hashBytes as sha, MAX_CHUNK_BYTES as FACT_CHUNK, type BinaryAdapter } from '../core/binary-layout';
import type { FactRow } from '../core/projection';
import { digest } from '../core/declaration';
import { yieldTask } from '../core/scheduler';

export const FACT_FORMAT = 1, FACT_BYTES = 32 * 1024 * 1024;
const invalid = (): never => { throw Error('Saved facts invalid or over limit'); };
interface Part { bytes: number; hash: string }
interface Manifest { format: number; key: string; parts: Part[] }
/** Disposable plaintext facts. One operation/IO at a time, including after a timeout.
 * A timed-out host operation cannot be cancelled; keep its queue slot until it settles. */
export class FactCache {
  private work: Promise<unknown> = Promise.resolve();
  private epoch = 0;
  paused = false;
  constructor(private disk: BinaryAdapter, private readonly factDirectory: string, private yieldNow = yieldTask, private deadlineMs = 15000) {}
  private run<T>(current: () => boolean, action: (check: () => void) => Promise<T>): Promise<T> {
    const epoch = this.epoch; let expired = false, timer: ReturnType<typeof setTimeout>;
    const check = () => { if (expired || epoch !== this.epoch || !current()) throw Error('Saved facts cancelled'); };
    const next = this.work.catch(() => {}).then(() => { check(); return action(check); });
    this.work = next;
    return Promise.race([next, new Promise<never>((_, reject) => { timer = setTimeout(() => { expired = true; reject(Error('Saved facts deadline exceeded')); }, this.deadlineMs); })]).finally(() => clearTimeout(timer));
  }
  clear(pause = false) {
    this.paused ||= pause; this.epoch++;
    return this.run(() => true, async check => { check(); if (await this.disk.exists(this.factDirectory)) { check(); await this.disk.rmdir(this.factDirectory, true); } });
  }
  load(key: string, current: () => boolean): Promise<Map<string, FactRow> | undefined> {
    return this.run(current, async check => {
      const path = `${this.factDirectory}/manifest.json`; check();
      if (!await this.disk.exists(path)) return;
      check(); const size = (await this.disk.stat(path))?.size;
      if (!size || size > FACT_CHUNK) invalid();
      check(); const m: Manifest = JSON.parse(await this.disk.read(path));
      if (m.format !== FACT_FORMAT || m.key !== key) return;
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
  save(key: string, rows: Iterable<FactRow>, current: () => boolean) {
    return this.run(current, async check => {
      // Retire the old commit point before overwriting chunks; no partial generation can load.
      check(); if (await this.disk.exists(this.factDirectory)) { check(); await this.disk.rmdir(this.factDirectory, true); }
      const pieces = this.factDirectory.split('/');
      for (let i = 1; i <= pieces.length; i++) { check(); const p = pieces.slice(0, i).join('/'); if (!await this.disk.exists(p)) { check(); await this.disk.mkdir(p); } }
      const parts: Part[] = []; let batch: FactRow[] = [], total = 0, count = 0;
      const flush = async () => {
        check(); const bytes = new TextEncoder().encode(JSON.stringify(batch));
        if (bytes.length > FACT_CHUNK || (total += bytes.length) > FACT_BYTES || parts.length >= 4096) invalid();
        const hash = await sha(bytes); check();
        const part = parts.length;
        await this.disk.writeBinary(`${this.factDirectory}/${part}.bin`, bytes.buffer);
        parts.push({ bytes: bytes.length, hash }); batch = []; await this.yieldNow();
      };
      for (const row of rows) { check(); if (++count > 100000) invalid(); batch.push(row); if (batch.length === 256) await flush(); }
      if (batch.length) await flush();
      check(); await this.disk.write(`${this.factDirectory}/manifest.json`, JSON.stringify({ format: FACT_FORMAT, key, parts }));
      check();
    });
  }
}
/** Whole-vault resolution namespace, not just declared/excluded Markdown rows.
 * File stamps invalidate cheaply but never establish content equality. */
export async function factKey(files: { path: string; stat: { mtime: number; size: number } }[], scope: unknown, current: () => boolean) {
  const ordered = files.map(f => [f.path, f.stat.mtime, f.stat.size] as const).sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0), parts: string[] = [];
  for (let i = 0; i < ordered.length; i += 256) {
    if (!current()) invalid();
    const part = ordered.slice(i, i + 256);
    if (part.some(f => !Number.isFinite(f[1]) || !Number.isSafeInteger(f[2]) || f[2] < 0)) invalid();
    parts.push(await digest(part)); await yieldTask();
  }
  if (!current()) invalid();
  return digest({ format: FACT_FORMAT, scope, parts });
}
