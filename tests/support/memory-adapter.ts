import type { BinaryAdapter } from '../../src/core/binary-layout';
/** In-memory stand-in for the plugin directory DataAdapter; survives a simulated app reload. */
export class MemoryAdapter implements BinaryAdapter {
  files = new Map<string, Uint8Array>(); dirs = new Set<string>(); reads: string[] = []; writes = 0;
  async exists(p: string) { return this.files.has(p) || this.dirs.has(p); }
  async mkdir(p: string) { this.dirs.add(p); }
  async read(p: string) { this.reads.push(p); const b = this.files.get(p); if (!b) throw new Error('absent'); return new TextDecoder().decode(b); }
  async write(p: string, s: string) { this.writes++; this.files.set(p, new TextEncoder().encode(s)); }
  async readBinary(p: string) { this.reads.push(p); const b = this.files.get(p); if (!b) throw new Error('absent'); return b.slice().buffer; }
  async writeBinary(p: string, b: ArrayBuffer) { this.files.set(p, new Uint8Array(b).slice()); }
  async stat(p: string) { const b = this.files.get(p); return b ? { size: b.length } : null; }
  async rename(from: string, to: string) { for (const [p, b] of [...this.files]) if (p === from || p.startsWith(from + '/')) { this.files.set(to + p.slice(from.length), b); this.files.delete(p); } for (const p of [...this.dirs]) if (p === from || p.startsWith(from + '/')) { this.dirs.add(to + p.slice(from.length)); this.dirs.delete(p); } }
  async rmdir(p: string) { for (const k of this.files.keys()) if (k.startsWith(p + '/')) this.files.delete(k); for (const k of [...this.dirs]) if (k === p || k.startsWith(p + '/')) this.dirs.delete(k); }
  async remove(p: string) { this.files.delete(p); }
  async list(p: string) { const direct = (s: string) => s.startsWith(p + '/') && !s.slice(p.length + 1).includes('/'); return { files: [...this.files.keys()].filter(direct), folders: [...this.dirs].filter(direct) }; }
}
