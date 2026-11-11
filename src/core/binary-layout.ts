import { encodeStrings, decodeStrings } from './columns';
import type { LayoutOptions } from './layout';
// Keyed group summaries are not dictionary-compatible with slice-2 cached paint.
export const CACHE_FORMAT = 3;
export const MAX_CHUNK_BYTES = 1024 * 1024;
export interface GenerationMeta {
  format: number; declarationHash: string; key: string; layoutHash: string; layout: LayoutOptions;
  producer: string; source: string; groupLevel: number; streamEveryIterations: number;
}
export interface BinaryGeneration { meta: GenerationMeta; files: Record<string, Uint8Array> }
export interface BinaryLayout { meta: GenerationMeta; identities: string[]; positions: Float32Array; edgeKeys: Uint32Array; groups?: unknown }
const bytes = (v: ArrayBufferView) => new Uint8Array(v.buffer as ArrayBuffer, v.byteOffset, v.byteLength).slice();
export function encodeLayout(g: BinaryLayout): BinaryGeneration {
  validateLayout(g);
  const ids = encodeStrings(g.identities);
  return { meta: g.meta, files: { positions: bytes(g.positions), identities: ids.bytes, offsets: bytes(ids.offsets), edgekeys: bytes(g.edgeKeys), groups: new TextEncoder().encode(JSON.stringify(g.groups ?? null)) } };
}
export function decodeLayout(g: BinaryGeneration): BinaryLayout {
  const f = g.files;
  if (!f.positions || !f.identities || !f.offsets || !f.edgekeys || f.positions.byteLength % 4 || f.offsets.byteLength % 4 || f.edgekeys.byteLength % 8) throw new Error('Truncated binary generation');
  const layout = { meta: g.meta, identities: decodeStrings({ bytes: f.identities, offsets: new Uint32Array(f.offsets.buffer, f.offsets.byteOffset, f.offsets.byteLength / 4) }),
    positions: new Float32Array(f.positions.buffer, f.positions.byteOffset, f.positions.byteLength / 4),
    edgeKeys: new Uint32Array(f.edgekeys.buffer, f.edgekeys.byteOffset, f.edgekeys.byteLength / 4),
    groups: f.groups ? JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(f.groups)) : undefined };
  validateLayout(layout); return layout;
}
export function validateLayout(g: BinaryLayout) {
  if (g.meta.format !== CACHE_FORMAT || g.positions.length !== g.identities.length * 2 || !g.positions.every(Number.isFinite) || new Set(g.identities).size !== g.identities.length || g.edgeKeys.length % 2) throw new Error('Invalid binary layout');
}
export interface BinaryAdapter {
  exists(path: string): Promise<boolean>; mkdir(path: string): Promise<void>;
  read(path: string): Promise<string>; write(path: string, content: string): Promise<void>;
  readBinary(path: string): Promise<ArrayBuffer>; writeBinary(path: string, data: ArrayBuffer): Promise<void>;
  rename(from: string, to: string): Promise<void>; rmdir(path: string, recursive: boolean): Promise<void>;
  stat(path: string): Promise<{ size: number; mtime?: number } | null>;
  list?(path: string): Promise<{ files: string[]; folders: string[] }>;
  remove?(path: string): Promise<void>;
}
interface Part { name: string; bytes: number; chunks: { bytes: number; hash: string }[] }
interface Manifest { meta: GenerationMeta; parts: Part[] }
interface Entry { declarationHash: string; key: string }
export interface StoreOptions { directory: string; chunkBytes: number; maxGenerationBytes: number; cachedDeclarations: number; retainedArtifacts?: number; maxRetainedBytes?: number }
const hash = async (b: Uint8Array) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', b as Uint8Array<ArrayBuffer>)), n => n.toString(16).padStart(2, '0')).join('');
const id = (s: unknown): s is string => typeof s === 'string' && /^[a-f0-9]{64}$/.test(s);
export class BinaryLayoutStore {
  readonly trace: { action: string; declarationHash: string; key: string }[] = [];
  constructor(private adapter: BinaryAdapter, readonly options: StoreOptions, private yieldNow: () => Promise<void> = async () => {}) {
    if (!Number.isSafeInteger(options.chunkBytes) || options.chunkBytes < 4 || options.chunkBytes > MAX_CHUNK_BYTES || !Number.isSafeInteger(options.maxGenerationBytes) || options.maxGenerationBytes < options.chunkBytes) throw new Error('Invalid binary store budget');
  }
  private path(e: Entry) { if (!id(e.declarationHash) || !id(e.key)) throw new Error('Invalid generation identifier'); return `${this.options.directory}/${e.declarationHash}/${e.key}`; }
  private async mkdir(path: string) { const parts = path.split('/'); for (let i = 1; i <= parts.length; i++) { const p = parts.slice(0, i).join('/'); if (!await this.adapter.exists(p)) await this.adapter.mkdir(p); } }
  private async entries(): Promise<Entry[]> {
    const path = `${this.options.directory}/index.json`;
    if (!await this.adapter.exists(path)) return [];
    try { if ((await this.adapter.stat(path))!.size > MAX_CHUNK_BYTES) throw new Error('Oversized cache index'); const entries = JSON.parse(await this.adapter.read(path));
      if (!Array.isArray(entries) || entries.length > 10000 || entries.some(e => !id(e?.key) || !id(e?.declarationHash))) throw new Error('Invalid cache index'); return entries;
    } catch { await this.adapter.rename(path, `${path}.corrupt-${Date.now()}`); return []; }
  }
  async write(g: BinaryGeneration) {
    try { await this.writeGeneration(g); } finally { await this.pruneArtifacts(); }
  }
  private async writeGeneration(g: BinaryGeneration) {
    const directory = this.path(g.meta); await this.mkdir(directory);
    if (Object.values(g.files).reduce((n, f) => n + f.byteLength, 0) > this.options.maxGenerationBytes) throw new Error('Generation byte budget exceeded');
    const parts: Part[] = [];
    for (const [name, file] of Object.entries(g.files)) {
      if (!/^[a-z]+$/.test(name)) throw new Error('Invalid part name');
      const part: Part = { name, bytes: file.byteLength, chunks: [] };
      for (let offset = 0, i = 0; offset < file.byteLength; offset += this.options.chunkBytes, i++) {
        const chunk = file.slice(offset, offset + this.options.chunkBytes);
        const chunkPath = `${directory}/${name}.${i}.bin`, checksum = await hash(chunk);
        const reusable = (await this.adapter.stat(chunkPath))?.size === chunk.byteLength && await hash(new Uint8Array(await this.adapter.readBinary(chunkPath))) === checksum;
        if (!reusable) await this.adapter.writeBinary(chunkPath, chunk.buffer);
        part.chunks.push({ bytes: chunk.byteLength, hash: await hash(chunk) }); await this.yieldNow();
      }
      parts.push(part);
    }
    // Commit point is the small manifest, then the LRU pointer. Incomplete writes are never loaded.
    const manifest = JSON.stringify({ meta: g.meta, parts });
    if (new TextEncoder().encode(manifest).length > MAX_CHUNK_BYTES) throw new Error('Manifest byte budget exceeded');
    await this.adapter.write(`${directory}/manifest.json`, manifest);
    const all = (await this.entries()).filter(e => !(e.declarationHash === g.meta.declarationHash && e.key === g.meta.key));
    all.push({ declarationHash: g.meta.declarationHash, key: g.meta.key });
    // One current generation per declaration, with an overall configurable declaration LRU.
    const keep = all.filter((e, i) => !all.slice(i + 1).some(n => n.declarationHash === e.declarationHash)).slice(-this.options.cachedDeclarations);
    const index = JSON.stringify(keep); if (new TextEncoder().encode(index).byteLength > MAX_CHUNK_BYTES) throw new Error('Cache index byte budget exceeded');
    await this.adapter.write(`${this.options.directory}/index.json`, index);
    for (const e of all) {
      const kept = keep.some(k => k.key === e.key && k.declarationHash === e.declarationHash);
      this.record(kept ? 'kept' : 'removed', e); if (!kept && await this.adapter.exists(this.path(e))) await this.adapter.rmdir(this.path(e), true);
    }
  }
  private record(action: string, e: Entry) { this.trace.push({ action, ...e }); if (this.trace.length > 100) this.trace.shift(); }
  async discard() { if (await this.adapter.exists(this.options.directory)) await this.adapter.rmdir(this.options.directory, true); }
  async latest(declarationHash: string, expected?: { source: string; layoutHash: string; producer: string }): Promise<BinaryGeneration | undefined> {
    await this.pruneArtifacts();
    const e = (await this.entries()).reverse().find(e => e.declarationHash === declarationHash);
    if (!e) return;
    try {
      const path = this.path(e), manifestPath = `${path}/manifest.json`;
      if ((await this.adapter.stat(manifestPath))!.size > MAX_CHUNK_BYTES) throw new Error('Oversized manifest');
      const m: Manifest = JSON.parse(await this.adapter.read(manifestPath));
      if (!m.meta || m.meta.format !== CACHE_FORMAT || m.meta.key !== e.key || m.meta.declarationHash !== e.declarationHash || !Array.isArray(m.parts) || m.parts.length !== 5 || new Set(m.parts.map(p => p.name)).size !== 5) throw new Error('Invalid manifest');
      if (expected && (m.meta.source !== expected.source || m.meta.layoutHash !== expected.layoutHash || m.meta.producer !== expected.producer)) throw new Error('Source/view or producer mismatch');
      let total = 0; const files: Record<string, Uint8Array> = Object.create(null);
      for (const part of m.parts) {
        if (!['positions', 'identities', 'offsets', 'edgekeys', 'groups'].includes(part.name) || !Number.isSafeInteger(part.bytes) || part.bytes < 0 || !Array.isArray(part.chunks)) throw new Error('Invalid manifest part');
        total += part.bytes; if (total > this.options.maxGenerationBytes || part.chunks.length > Math.ceil(this.options.maxGenerationBytes / 4)) throw new Error('Generation byte budget exceeded');
        const out = new Uint8Array(part.bytes); let offset = 0;
        for (let i = 0; i < part.chunks.length; i++) {
          const chunk = part.chunks[i]!, filePath = `${path}/${part.name}.${i}.bin`;
          if (!Number.isSafeInteger(chunk.bytes) || chunk.bytes < 1 || chunk.bytes > MAX_CHUNK_BYTES || offset + chunk.bytes > part.bytes || !id(chunk.hash) || (await this.adapter.stat(filePath))?.size !== chunk.bytes) throw new Error('Invalid or oversized chunk');
          const buffer = new Uint8Array(await this.adapter.readBinary(filePath));
          if (buffer.byteLength !== chunk.bytes || await hash(buffer) !== chunk.hash) throw new Error('Truncated or corrupt chunk');
          out.set(buffer, offset); offset += buffer.byteLength; await this.yieldNow();
        }
        if (offset !== part.bytes) throw new Error('Truncated generation'); files[part.name] = out;
      }
      this.record('loaded', e); return { meta: m.meta, files };
    } catch { await this.quarantine(e); return; }
  }
  async quarantine(e: Entry) {
    const path = this.path(e);
    if (await this.adapter.exists(path)) await this.adapter.rename(path, `${path}.corrupt-${Date.now()}`);
    const entries = (await this.entries()).filter(k => k.key !== e.key || k.declarationHash !== e.declarationHash);
    await this.adapter.write(`${this.options.directory}/index.json`, JSON.stringify(entries)); this.record('quarantined', e);
    await this.pruneArtifacts();
  }
  /** Only disposable cache artifacts in this exact namespace are eligible. Source/settings
   * quarantines are deliberately excluded. DataAdapter has no portable directory trash API. */
  async pruneArtifacts() {
    if (!this.adapter.list || !this.adapter.remove || !await this.adapter.exists(this.options.directory)) return;
    const root = this.options.directory, committed = new Set((await this.entries()).map(e => this.path(e)));
    const candidates: { path: string; directory: boolean; bytes: number; age: number }[] = [];
    const direct = (parent: string, path: string) => path.startsWith(parent + '/') && !path.slice(parent.length + 1).includes('/');
    const listing = await this.adapter.list(root);
    for (const path of listing.files) if (direct(root, path) && /^index\.json\.corrupt-\d+$/.test(path.slice(root.length + 1))) {
      const stat = await this.adapter.stat(path); candidates.push({ path, directory: false, bytes: stat?.size ?? 0, age: stat?.mtime ?? Number(path.split('-').at(-1)) });
    }
    for (const declaration of listing.folders) {
      if (!direct(root, declaration) || !id(declaration.slice(root.length + 1))) continue;
      for (const path of (await this.adapter.list(declaration)).folders) {
        if (!direct(declaration, path) || !/^[a-f0-9]{64}(?:\.corrupt-\d+)?$/.test(path.slice(declaration.length + 1)) || committed.has(path)) continue;
        const contents = await this.adapter.list(path);
        if (contents.folders.length) continue; // Never recursively chase an unexpected cache tree.
        let bytes = 0, age = (await this.adapter.stat(path))?.mtime ?? 0;
        for (const file of contents.files) if (direct(path, file)) { const stat = await this.adapter.stat(file); bytes += stat?.size ?? 0; age = Math.max(age, stat?.mtime ?? 0); }
        candidates.push({ path, directory: true, bytes, age }); await this.yieldNow();
      }
    }
    candidates.sort((a, b) => b.age - a.age || b.path.localeCompare(a.path));
    let count = 0, bytes = 0;
    for (const item of candidates) {
      if (count < (this.options.retainedArtifacts ?? 8) && bytes + item.bytes <= (this.options.maxRetainedBytes ?? this.options.maxGenerationBytes)) { count++; bytes += item.bytes; continue; }
      if (item.directory) await this.adapter.rmdir(item.path, true); else await this.adapter.remove(item.path);
      await this.yieldNow();
    }
  }
}
