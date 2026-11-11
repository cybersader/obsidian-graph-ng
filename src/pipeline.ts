import type { GraphDeclaration, Predicate } from './core/declaration';
import type { RowColumns } from './core/columns';
import { transferables } from './core/columns';
import type { LayoutOptions } from './core/layout';
import type { BinaryGeneration, GenerationMeta } from './core/binary-layout';
import type { RenderProjection } from './render-projection';
import type { GroupProjection } from './core/group-projection';
import type { ExploreResult, ExploreView } from './core/explore';
export const LAYOUT_PRODUCER = 'graph-ng-fa2@1';
export interface PipelineConfig { declaration: GraphDeclaration; layout: LayoutOptions; source: string; groupLevel: number; predicate?: Predicate; view?: ExploreView; facetValues?: number; streamEveryIterations: number }
export type PipelineRequest =
  | { kind: 'external'; bytes: Uint8Array; maxBytes: number; limits: { groups: number; pairs: number; carriers: number } }
  | { kind: 'configure'; config: PipelineConfig }
  | { kind: 'rows'; columns: RowColumns; reset?: boolean; removed?: string[] }
  | { kind: 'load'; generation: BinaryGeneration }
  | { kind: 'migrate'; generation: { key: string; identities: string[]; positions: number[]; producer: string; layoutHash?: string; edgeKeys?: string[] }; declarationHash: string }
  | { kind: 'project'; complete?: boolean } | { kind: 'detail' } | { kind: 'layout' } | { kind: 'encode' }
  | { kind: 'gpu' }
  | { kind: 'members'; group: string; view: number }
  | { kind: 'expression-count'; expr: string; context: 'filter' | 'group'; budgetMs?: number }
  | { kind: 'explore'; view: ExploreView; colors?: GraphDeclaration['colors']; facetValues: number; budgetMs?: number }
  | { kind: 'contributions'; pair: string; offset: number; count: number; view: number };
export interface ProjectResult { invalidSaved?: GenerationMeta; meta: GenerationMeta; nodes: number; edges: number; unresolved: number; quarantined: { path: string; id: string }[] }
export interface DetailResult { projection: RenderProjection; visible: Uint8Array; colors: Uint32Array; explore: ExploreResult; view: number }
export interface ViewResult { explore: ExploreResult; colors: Uint32Array; groups: GroupProjection; view: number }
export interface LayoutResult { positions: Float32Array; milliseconds: number; cached: boolean; stored?: string }
export interface GroupEvent { kind: 'groups'; revision: number; view: number; projection: GroupProjection }
export interface Transport { postMessage(message: unknown, transfer: Transferable[]): void; terminate(): void; onmessage: ((event: MessageEvent) => void) | null; onerror: ((event: ErrorEvent) => void) | null }
interface Pending { id: number; revision: number; request: PipelineRequest; resolve(v: any): void; reject(e: Error): void; timer?: ReturnType<typeof setTimeout> }
export interface Recovery { restart(): Transport; maxRestarts(): number; onRestart?(): void }
/** A new group projection can arrive before its detail dictionary. Never map new
 * member indices through the previous generation's still-retained dictionary. */
export const currentDetailGeneration = (requested: number, active: number, detail: number) => requested === active && requested === detail;
/** One active RPC, a queued processing acknowledgement, and bounded whole-worker recovery.
 * Detached input buffers are never replayed: the owner must reconfigure and ingest live rows. */
export class WorkerPipeline {
  private next = 0;
  private pending: Pending[] = [];
  private active?: Pending;
  private closed = false;
  private restarts = 0;
  onPositions?: (event: { revision: number; positions: Float32Array }) => void;
  onGroups?: (event: GroupEvent) => void;
  constructor(private worker: Transport, private timeoutMs: () => number, private cleanup = () => {}, private recovery?: Recovery) { this.attach(); }
  private attach() {
    const worker = this.worker;
    worker.onmessage = event => {
      if (worker !== this.worker || this.closed) return;
      const m = event.data, p = this.active;
      if (!p || m.revision !== p.revision) return;
      if (m.kind === 'positions') { this.onPositions?.(m); return; }
      if (m.kind === 'groups') { this.onGroups?.(m); return; }
      if (m.id !== p.id) return;
      if (m.kind === 'started') {
        clearTimeout(p.timer);
        // Only processing consumes the per-request budget; queued RPCs have no timer.
        p.timer = setTimeout(() => this.fail(new Error('Graph worker processing timed out')), this.timeoutMs()); return;
      }
      clearTimeout(p.timer); this.active = undefined;
      if (m.error) p.reject(new Error(m.error)); else p.resolve(m.result);
      this.dispatch();
    };
    worker.onerror = e => { if (worker === this.worker && !this.closed) this.fail(new Error(e.message)); };
  }
  request<T>(revision: number, request: PipelineRequest): Promise<T> {
    this.cancelEvaluation(request.kind);
    if (this.closed) return Promise.reject(new Error('Worker pipeline closed'));
    if (request.kind === 'expression-count' || request.kind === 'explore') this.pending = this.pending.filter(p => { if (p.request.kind !== request.kind) return true; p.reject(new Error('Expression superseded')); return false; });
    return new Promise((resolve, reject) => { this.pending.push({ id: ++this.next, revision, request, resolve, reject }); this.dispatch(); });
  }
  /** Bypass the serialized RPC queue only to stop cooperative expression work. */
  cancelEvaluation(kind: PipelineRequest['kind']) {
    if (this.active?.request.kind === kind && (this.active.request.kind === 'expression-count' || this.active.request.kind === 'explore')) {
      try { this.worker.postMessage({ kind: 'cancel-evaluation', id: this.active.id }, []); }
      catch (error) { this.fail(error instanceof Error ? error : new Error(String(error))); }
    }
  }
  private dispatch() {
    if (this.closed || this.active || !this.pending.length) return;
    const p = this.active = this.pending.shift()!;
    // A separate startup/dispatch watchdog covers a worker that never acknowledges.
    p.timer = setTimeout(() => this.fail(new Error('Graph worker did not start processing')), this.timeoutMs());
    try { this.worker.postMessage({ id: p.id, revision: p.revision, ...p.request, ...((p.request.kind === 'expression-count' || p.request.kind === 'explore') ? { budgetMs: p.request.budgetMs ?? this.timeoutMs() * .9 } : {}) }, transferables(p.request)); }
    catch (error) { this.fail(error instanceof Error ? error : new Error(String(error))); }
  }
  private rejectAll(error: Error) {
    if (this.active) { clearTimeout(this.active.timer); this.active.reject(error); this.active = undefined; }
    for (const p of this.pending) p.reject(error); this.pending = [];
  }
  private fail(error: Error) {
    this.worker.terminate(); this.rejectAll(error);
    this.onGroups = undefined; this.onPositions = undefined;
    if (this.recovery && this.restarts < this.recovery.maxRestarts()) {
      this.restarts++;
      try { this.worker = this.recovery.restart(); this.attach(); this.recovery.onRestart?.(); return; }
      catch { /* Exhaust this failure rather than retry-looping a broken factory. */ }
    }
    this.closed = true; this.cleanup();
  }
  recycle(buffer: ArrayBuffer) { if (!this.closed && buffer.byteLength) this.worker.postMessage({ kind: 'recycle', buffer }, [buffer]); }
  dispose(error = new Error('Graph worker closed')) {
    if (this.closed) return; this.closed = true; this.worker.terminate(); this.cleanup(); this.rejectAll(error);
  }
}
