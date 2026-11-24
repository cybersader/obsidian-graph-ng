import { plural } from './graph-information';
import { workingText } from './working';
import { iconButton, panelHelp } from './panel-help';
import { registerAction, type RendererControls } from './interaction';
import { VIEW_LIMITS } from './core/explore';
import { renderPath, type RenderProjection } from './render-projection';

/** What a graph view lends find-a-note: its main-realm projection, the ranking and today's text filter. */
export interface SearchSource {
  /** The projection the stage's renderer draws (paths and counts for rows), or undefined while none is shown. */
  projection(): RenderProjection | undefined;
  /** Up to 20 notes kept by `keep`, best first (the worker's `searchSteps` over the cached search
   * text, so identities never leave it). Rejects when superseded. */
  rank(query: string, keep: Uint8Array): Promise<{ nodes: number[]; total: number }>;
  /** Set aside the committed text query locally. Wait for its replacement mask before ranking. */
  clearQuery?(): Promise<boolean | undefined> | undefined;
  /** Shift+Enter: apply the query as the text filter. */
  filter(query: string): void;
}
export const SEARCH_DEBOUNCE_MS = 120;
const sources = new WeakMap<Element, SearchSource>(), boxes = new WeakMap<HTMLCanvasElement, Omnibox>();
const toolbarBoxes = new WeakMap<HTMLCanvasElement, Omnibox>();
let serial = 0;

/** Renderers drawn inside `stage` may open find-a-note over it. */
export function searchable(stage: HTMLElement, source: SearchSource) { sources.set(stage, source); }

const normal = (q: string) => q.trim().toLowerCase().replace(/\0/g, '');

/** Find-and-fly: a box over the graph that lists up to 20 ranked notes (name prefix, then name
 * substring, then identity), previews the active one with a ring, and on Enter flies there and
 * opens its card. Ranking runs once per typing pause, in the worker's bounded chunks; nothing runs per frame. */
export class Omnibox {
  readonly findBox: HTMLElement;
  readonly findInput: HTMLInputElement;
  readonly findList: HTMLElement;
  readonly findStatus: HTMLElement;
  readonly findRing: HTMLElement;
  /** Ranked note indices. */
  findHits: number[] = [];
  /** Previewed row, or -1 (Enter then takes the first). */
  findActive = -1;
  /** The normalised query the hits answer. */
  private ranked = '';
  private findTimer?: ReturnType<typeof setTimeout>;
  private findToken = 0;
  private findId = `graph-ng-find-${++serial}`;
  private matchCount = '';
  /** Pending mask adoption, or false after a failed adoption until the next edit. */
  private filterReady?: Promise<boolean | undefined> | false;
  private restoreInput?: () => void;
  constructor(private host: RendererControls, parent: HTMLElement, private findSource: SearchSource, toolbar?: HTMLInputElement) {
    const make = <T extends HTMLElement>(tag: string, cls: string, into: HTMLElement) => into.appendChild(Object.assign(document.createElement(tag), { className: cls })) as T;
    const root = this.findBox = make('div', 'graph-ng-find', toolbar?.parentElement ?? parent); root.hidden = true;
    const attrs = { role: 'combobox', 'aria-autocomplete': 'list', 'aria-expanded': 'false', 'aria-controls': this.findId };
    let pressing = false;
    if (toolbar) {
      this.findInput = toolbar;
      const previous = toolbar.oninput, outside = (e: Event) => { if (!root.contains(e.target as Node)) { pressing = false; if (this.findOpen && e.target !== toolbar) this.findClose(false); } };
      root.onpointerdown = e => { if (this.findList.contains(e.target as Node)) { pressing = true; e.preventDefault(); } };
      const doc = toolbar.ownerDocument, listeners = new AbortController(), capture = { capture: true, signal: listeners.signal }, release = (e: PointerEvent) => {
        if (!pressing) return; pressing = false;
        if (e.type === 'pointerup' && root.contains(doc.elementFromPoint(e.clientX, e.clientY))) toolbar.focus({ preventScroll: true });
        else if (doc.activeElement !== toolbar) this.findClose(false);
      };
      doc.addEventListener('pointerup', release, capture); doc.addEventListener('pointercancel', release, capture);
      toolbar.onblur = () => { if (!pressing) this.findClose(false); };
      doc.addEventListener('pointerdown', outside, capture);
      this.restoreInput = () => {
        listeners.abort(); toolbar.onblur = null; toolbar.oninput = previous;
        for (const k of Object.keys(attrs)) toolbar.removeAttribute(k);
      };
    } else {
      const head = make('div', 'graph-ng-find-head', root), input = this.findInput = make<HTMLInputElement>('input', 'graph-ng-find-input', head);
      const close = iconButton(head, 'Close search', 'x', 'clickable-icon graph-ng-find-close'); close.type = 'button'; close.onclick = () => this.findClose();
      input.type = 'search'; input.placeholder = 'Find a note…'; input.maxLength = VIEW_LIMITS.query; input.spellcheck = false;
      input.setAttribute('aria-label', 'Find a note by name or ID');
    }
    const input = this.findInput;
    for (const [k,v] of Object.entries(attrs)) input.setAttribute(k, v);
    this.findList = make('div', 'graph-ng-find-list', root); this.findList.id = this.findId; this.findList.setAttribute('role', 'listbox');
    this.findStatus = make('div', 'graph-ng-find-status', root); this.findStatus.setAttribute('aria-live', 'polite');
    if (!toolbar) panelHelp(make('div', 'graph-ng-find-keys', root), 'Keys', '↑ ↓ preview. Enter jumps. Shift+Enter filters. Alt+Enter finds a path from the selected note. Escape dismisses.');
    this.findRing = make('div', 'graph-ng-find-ring', parent); this.findRing.hidden = true; this.findRing.setAttribute('aria-hidden', 'true');
    input.oninput = () => {
      if (toolbar) {
        root.hidden = !input.value.trim();
        if (!this.filterReady) {
          const clear = this.filterReady = this.findSource.clearQuery?.();
          if (clear) void clear.then(ok => { this.filterReady = ok === false ? false : undefined; });
        }
      }
      this.findReset();
      if (!root.hidden) this.queueRanking();
    };
    input.onkeydown = this.findKey;
    root.addEventListener('focusout', this.findBlur);
  }
  private queueRanking() { if (this.restoreInput) workingText(this.findStatus, 'Searching…', true); this.findTimer = setTimeout(() => void this.findSearch(), SEARCH_DEBOUNCE_MS); }
  refreshSearchMask() {
    // A clear already has a ranking waiting on adoption. Subsequent view refreshes must not silently dismiss an edited query.
    if (this.findOpen && !this.filterReady) { this.findReset(); this.queueRanking(); }
  }
  private findBlur = (e: FocusEvent) => { if (!this.findBox.contains(e.relatedTarget as Node | null)) this.findClose(false); };
  get findOpen() { return !this.findBox.hidden; }
  findShow() {
    this.findBox.hidden = false; this.findInput.focus(); this.findInput.select?.(); if (this.findInput.value) void this.findSearch(); }
  private findReset() {
    this.findToken++; clearTimeout(this.findTimer); this.findHits = []; this.findActive = -1; this.ranked = '';
    this.findRing.hidden = true; this.findPaint();
  }
  findClose(refocus = true) {
    this.findBox.hidden = true; this.findReset();
    if (refocus && !this.restoreInput && this.host.live) this.host.focusCanvas();
  }
  dispose() {
    this.findClose(false);
    this.findInput.oninput = this.findInput.onkeydown = null;
    this.restoreInput?.();
    this.findBox.removeEventListener('focusout', this.findBlur);
    this.findBox.remove(); this.findRing.remove();
  }
  /** Rank the notes the view can open for the box's query; a newer search or close wins. */
  async findSearch() {
    clearTimeout(this.findTimer);
    const token = ++this.findToken, query = normal(this.findInput.value), h = this.host;
    const ready = this.filterReady === undefined || await this.filterReady;
    if (token !== this.findToken || ready === undefined) return;
    const p = this.findSource.projection();
    const mask = () => this.restoreInput ? h.filterVisible : h.visible, visible = mask(); let best: number[] = [], total = 0, failed = !ready;
    if (ready && query && p && h.live && p.nodeCount === visible.length) {
      workingText(this.findStatus, 'Searching…', true);
      const eligible = (n: number) => this.restoreInput ? !!h.filterVisible[n] : h.openable(n);
      const keep = this.restoreInput ? visible.slice() : Uint8Array.from(visible, (_, i) => +h.openable(i));
      // `keep` is transferred to the worker (its buffer detaches), so re-check results against the live view.
      try { const result = await this.findSource.rank(query, keep); total = result.total; best = result.nodes.filter(n => Number.isInteger(n) && n >= 0 && n < p.nodeCount && eligible(n)).slice(0, 20); } catch { failed = true; }
    }
    if (token !== this.findToken) return;
    if (!h.live || p !== this.findSource.projection() || visible !== mask() || query !== normal(this.findInput.value)) { this.findReset(); return; }
    this.ranked = query; this.findHits = best; this.findActive = -1; this.findRing.hidden = true; this.findPaint(p, failed ? undefined : total);
    if (failed) workingText(this.findStatus, 'Search unavailable. Try again.');
  }
  private findPaint(p?: RenderProjection, total?: number) {
    const list = this.findList; list.textContent = ''; this.findInput.setAttribute('aria-expanded', String(this.restoreInput ? this.findOpen : this.findHits.length > 0)); this.findInput.removeAttribute('aria-activedescendant');
    workingText(this.findStatus, this.ranked && !this.findHits.length ? 'No matching notes' : '');
    if (!p) return;
    const option = (i: number, pick: (e: MouseEvent) => void) => {
      const row = list.appendChild(Object.assign(document.createElement('div'), { className: 'graph-ng-find-row', id: `${this.findId}-${i}` }));
      row.setAttribute('role', 'option'); row.setAttribute('aria-selected', 'false');
      row.onpointerdown = e => e.preventDefault(); row.onclick = e => { if (this.restoreInput) this.findInput.focus({ preventScroll: true }); pick(e); }; return row;
    };
    this.findHits.forEach((node, i) => {
      const row = option(i, e => void this.findGo(i, e.altKey)), path = renderPath(p, node);
      const span = (cls: string, text: string) => { row.appendChild(Object.assign(document.createElement('span'), { className: cls, textContent: text })); };
      span('graph-ng-find-name', path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/i, '')); span('graph-ng-find-group', this.host.groupLabel?.(node) ?? 'Ungrouped'); span('graph-ng-find-path', path);
    });
    if (this.restoreInput && this.ranked && total !== undefined) {
      this.matchCount = plural(total, 'matching note');
      workingText(this.findStatus, this.matchCount);
      option(this.findHits.length, () => this.applyFilter()).textContent = `Show only matching notes (${total.toLocaleString()} in this view)`;
      if (this.findHits.length) { this.findActive = 0; this.syncJumpReady(); }
    }
  }
  /** Ring the row's note where it is; the camera stays put. */
  findPreview(i: number) {
    const node = this.findHits[i], h = this.host;
    this.findActive = i; this.findInput.setAttribute('aria-activedescendant', `${this.findId}-${i}`);
    [...this.findList.children].forEach((row, j) => row.setAttribute('aria-selected', String(j === i)));
    (this.findList.children[i] as HTMLElement | undefined)?.scrollIntoView?.({ block: 'nearest' });
    if (node === undefined || !h.openable(node)) { this.findRing.hidden = true; return; }
    const q = h.screenPoint(node), x = Math.max(8, Math.min(h.width - 8, q.x)), y = Math.max(8, Math.min(h.height - 8, q.y));
    this.findRing.hidden = false; this.findRing.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px) translate(-50%, -50%)`;
  }
  /** Fly to a row (default: the previewed one, else the first, ranking a changed query first), select it and open its card.
   * `path`: with a note selected, find the path from it to the row's note instead. */
  async findGo(i?: number, path = false) {
    const query = normal(this.findInput.value);
    if (i === undefined && query !== this.ranked) { await this.findSearch(); if (query !== this.ranked) return; }
    if (this.restoreInput && this.findActive === this.findHits.length && i === undefined && this.findOpen) return this.applyFilter();
    const node = this.findHits[Math.max(0, i ?? this.findActive)]; if (node === undefined || !this.findOpen || !this.host.live) return;
    if (!this.host.openable(node)) { if (this.restoreInput) this.syncJumpReady(); return; }
    const from = this.host.selected; this.findClose();
    if (!this.restoreInput && path && from >= 0 && from !== node) this.host.findPath(from, node); else this.host.flyToNote(node);
  }
  syncJumpReady() {
    if (!this.findOpen || !this.findHits.length) return;
    const busy = !this.host.openable(this.findHits[0]!);
    workingText(this.findStatus, busy ? 'Arranging. Jump available when ready.' : this.matchCount, busy);
    this.findPreview(this.findActive);
  }
  private applyFilter() { this.findSource.filter(this.findInput.value.trim()); this.findClose(); }
  findKey = (e: KeyboardEvent) => {
    const k = e.key, n = this.findList.children.length; if (e.isComposing) return;
    if (!this.findOpen) {
      if (k !== 'Enter' || !this.restoreInput || !e.shiftKey && !this.findInput.value.trim()) return;
      if (!e.shiftKey) { this.findBox.hidden = false; this.findPaint(); }
    }
    if (k === 'ArrowDown' || k === 'ArrowUp') { if (n) this.findPreview(((k === 'ArrowDown' ? this.findActive + 1 : this.findActive < 0 ? n - 1 : this.findActive - 1) + n) % n); }
    else if (k === 'Enter' && e.shiftKey) this.applyFilter();
    else if (k === 'Enter') void this.findGo(undefined, e.altKey);
    else if (k === 'Escape') this.findClose();
    else return;
    e.preventDefault(); e.stopPropagation();
  };
}

/** Geometry can change without changing eligibility. Refresh the hint and ring, not the ranking. */
export function syncJumpReady(canvas: HTMLCanvasElement) { toolbarBoxes.get(canvas)?.syncJumpReady(); }
/** A filter change invalidates ranked rows and pending replies without creating a box. */
export function invalidateSearch(canvas: HTMLCanvasElement, mask = false) { const bar = toolbarBoxes.get(canvas); if (mask) bar?.refreshSearchMask(); else bar?.findClose(false); const box = boxes.get(canvas); if (box) box.findClose(box.findOpen); }
/** The find box lives beside the canvas, so renderer teardown must remove it explicitly. */
export function disposeSearch(canvas: HTMLCanvasElement) { for (const map of [boxes, toolbarBoxes]) { map.get(canvas)?.dispose(); map.delete(canvas); } }

/** Bind only in Notes jump mode. Releasing restores the toolbar's ordinary filter handler. */
export function bindToolbar(host: RendererControls | undefined, input?: HTMLInputElement) {
  if (!host) return;
  const box = toolbarBoxes.get(host.canvas);
  if (box?.findInput === input) return box;
  box?.dispose(); toolbarBoxes.delete(host.canvas);
  if (input) return bindBox(toolbarBoxes, host, input);
}
function bindBox(map: typeof boxes, host: RendererControls, input?: HTMLInputElement) {
  const canvas = host.canvas, parent = canvas.parentElement, source = parent && sources.get(parent);
  if (parent && source) { const box = new Omnibox(host, parent, source, input); map.set(canvas, box); return box; }
}
/** The view's find box for this renderer, created on first use. */
export function omnibox(host: RendererControls) { return boxes.get(host.canvas) ?? bindBox(boxes, host); }
// "/" or Ctrl/Cmd+K opens the box; its Escape outranks the card's (order 10).
registerAction({
  id: 'find-note', label: 'Find a note', key: ['/', 'k', 'K'],
  when: ({ host, event: e }) => !!e && !e.altKey && (e.key === '/' ? !e.ctrlKey && !e.metaKey : e.ctrlKey || e.metaKey) && host.live && !!omnibox(host),
  run: ({ host }) => omnibox(host)!.findShow(),
});
registerAction({ id: 'close-find', label: 'Close find a note', key: 'Escape', order: 5, when: ({ host }) => !!boxes.get(host.canvas)?.findOpen, run: ({ host }) => boxes.get(host.canvas)!.findClose() });
