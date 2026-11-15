import { registerAction, type RendererControls } from './interaction';
import { VIEW_LIMITS } from './core/explore';
import { renderPath, type RenderProjection } from './render-projection';

/** What a graph view lends find-a-note: its main-realm projection, the ranking and today's text filter. */
export interface SearchSource {
  /** The projection the stage's renderer draws (paths and counts for rows), or undefined while none is shown. */
  projection(): RenderProjection | undefined;
  /** Up to 20 notes kept by `keep`, best first (the worker's `searchSteps` over the cached search
   * text, so identities never leave it). Rejects when superseded. */
  rank(query: string, keep: Uint8Array): Promise<number[]>;
  /** Shift+Enter: apply the query as the text filter. */
  filter(query: string): void;
}
export const SEARCH_DEBOUNCE_MS = 120;
const sources = new WeakMap<Element, SearchSource>(), boxes = new WeakMap<HTMLCanvasElement, Omnibox>();
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
  private findKeys: HTMLElement;
  /** Ranked note indices. */
  findHits: number[] = [];
  /** Previewed row, or -1 (Enter then takes the first). */
  findActive = -1;
  /** The normalised query the hits answer. */
  private ranked = '';
  private findTimer?: ReturnType<typeof setTimeout>;
  private findToken = 0;
  private findId = `graph-ng-find-${++serial}`;
  constructor(private host: RendererControls, parent: HTMLElement, private findSource: SearchSource) {
    const make = <T extends HTMLElement>(tag: string, cls: string, into: HTMLElement) => into.appendChild(Object.assign(document.createElement(tag), { className: cls })) as T;
    const root = this.findBox = make('div', 'graph-ng-find', parent); root.hidden = true;
    const input = this.findInput = make<HTMLInputElement>('input', 'graph-ng-find-input', root);
    input.type = 'search'; input.placeholder = 'Find a note…'; input.maxLength = VIEW_LIMITS.query; input.spellcheck = false;
    for (const [k, v] of [['role', 'combobox'], ['aria-label', 'Find a note by name or ID'], ['aria-autocomplete', 'list'], ['aria-expanded', 'false'], ['aria-controls', this.findId]]) input.setAttribute(k!, v!);
    this.findList = make('div', 'graph-ng-find-list', root); this.findList.id = this.findId; this.findList.setAttribute('role', 'listbox');
    this.findStatus = make('div', 'graph-ng-find-status', root); this.findStatus.setAttribute('aria-live', 'polite');
    this.findKeys = make('div', 'graph-ng-find-keys', root);
    this.findRing = make('div', 'graph-ng-find-ring', parent); this.findRing.hidden = true; this.findRing.setAttribute('aria-hidden', 'true');
    input.oninput = () => { this.findReset(); this.findTimer = setTimeout(() => void this.findSearch(), SEARCH_DEBOUNCE_MS); };
    input.onkeydown = this.findKey;
    input.onblur = (e: FocusEvent) => { if (!root.contains(e.relatedTarget as Node | null)) this.findClose(false); };
  }
  get findOpen() { return !this.findBox.hidden; }
  findShow() {
    // With a note selected, Alt+Enter (or Alt-click) on a result is a keyboard-only path start.
    const from = this.host.selected, p = from >= 0 ? this.findSource.projection() : undefined, name = p && from < p.nodeCount ? renderPath(p, from).replace(/^.*\//, '').replace(/\.md$/i, '') : '';
    this.findKeys.textContent = 'Enter: go there. Shift+Enter: filter.' + (name ? ` Alt+Enter: find path from ${name}.` : '');
    this.findBox.hidden = false; this.findInput.focus(); this.findInput.select?.(); if (this.findInput.value) void this.findSearch(); }
  private findReset() {
    this.findToken++; clearTimeout(this.findTimer); this.findHits = []; this.findActive = -1; this.ranked = '';
    this.findRing.hidden = true; this.findPaint();
  }
  findClose(refocus = true) {
    this.findReset(); this.findBox.hidden = true;
    if (refocus && this.host.live) this.host.focusCanvas();
  }
  dispose() {
    this.findClose(false);
    this.findInput.oninput = this.findInput.onkeydown = this.findInput.onblur = null;
    this.findBox.remove(); this.findRing.remove();
  }
  /** Rank the notes the view can open for the box's query; a newer search or close wins. */
  async findSearch() {
    clearTimeout(this.findTimer);
    const token = ++this.findToken, query = normal(this.findInput.value), h = this.host, p = this.findSource.projection();
    const visible = h.visible; let best: number[] = [], failed = false;
    if (query && p && h.live && p.nodeCount === h.visible.length) {
      const keep = new Uint8Array(p.nodeCount); for (let i = 0; i < keep.length; i++) keep[i] = +h.openable(i);
      // `keep` is transferred to the worker (its buffer detaches), so re-check results against the live view.
      try { best = (await this.findSource.rank(query, keep)).filter(n => Number.isInteger(n) && n >= 0 && n < p.nodeCount && h.openable(n)).slice(0, 20); } catch { failed = true; }
    }
    if (token !== this.findToken || !h.live || p !== this.findSource.projection() || visible !== h.visible || query !== normal(this.findInput.value)) return;
    this.ranked = query; this.findHits = best; this.findActive = -1; this.findRing.hidden = true; this.findPaint(p);
    if (failed) this.findStatus.textContent = 'Search unavailable. Try again.';
  }
  private findPaint(p?: RenderProjection) {
    const list = this.findList; list.textContent = ''; this.findInput.setAttribute('aria-expanded', String(this.findHits.length > 0)); this.findInput.removeAttribute('aria-activedescendant');
    this.findStatus.textContent = this.ranked && !this.findHits.length ? 'No matching notes' : '';
    if (!p) return;
    const o = p.offsets;
    this.findHits.forEach((node, i) => {
      const row = list.appendChild(Object.assign(document.createElement('div'), { className: 'graph-ng-find-row', id: `${this.findId}-${i}` })), path = renderPath(p, node), count = o[node + 1]! - o[node]!;
      row.setAttribute('role', 'option'); row.setAttribute('aria-selected', 'false');
      const span = (cls: string, text: string) => { row.appendChild(Object.assign(document.createElement('span'), { className: cls, textContent: text })); };
      span('graph-ng-find-name', path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/i, '')); span('graph-ng-find-count', `${count.toLocaleString()} connection${count === 1 ? '' : 's'}`); span('graph-ng-find-path', path);
      // Keep focus in the input so a row click is not a blur.
      row.onpointerdown = (e: PointerEvent) => e.preventDefault(); row.onclick = (e: MouseEvent) => void this.findGo(i, e.altKey);
    });
  }
  /** Ring the row's note where it is; the camera stays put. */
  findPreview(i: number) {
    const node = this.findHits[i], h = this.host; if (node === undefined || !h.openable(node)) return;
    this.findActive = i; this.findInput.setAttribute('aria-activedescendant', `${this.findId}-${i}`);
    [...this.findList.children].forEach((row, j) => row.setAttribute('aria-selected', String(j === i)));
    (this.findList.children[i] as HTMLElement | undefined)?.scrollIntoView?.({ block: 'nearest' });
    const q = h.screenPoint(node), x = Math.max(8, Math.min(h.width - 8, q.x)), y = Math.max(8, Math.min(h.height - 8, q.y));
    this.findRing.hidden = false; this.findRing.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px) translate(-50%, -50%)`;
  }
  /** Fly to a row (default: the previewed one, else the first, ranking a changed query first), select it and open its card.
   * `path`: with a note selected, find the path from it to the row's note instead. */
  async findGo(i?: number, path = false) {
    if (i === undefined && normal(this.findInput.value) !== this.ranked) await this.findSearch();
    const node = this.findHits[Math.max(0, i ?? this.findActive)]; if (node === undefined || !this.findOpen || !this.host.live || !this.host.openable(node)) return;
    const from = this.host.selected; this.findClose();
    if (path && from >= 0 && from !== node) this.host.findPath(from, node); else this.host.flyToNote(node);
  }
  findKey = (e: KeyboardEvent) => {
    const k = e.key, n = this.findHits.length; if (e.isComposing) return;
    if (k === 'ArrowDown' || k === 'ArrowUp') { if (n) this.findPreview(((k === 'ArrowDown' ? this.findActive + 1 : this.findActive < 0 ? n - 1 : this.findActive - 1) + n) % n); }
    else if (k === 'Enter' && e.shiftKey) { this.findSource.filter(this.findInput.value.trim()); this.findClose(); }
    else if (k === 'Enter') void this.findGo(undefined, e.altKey);
    else if (k === 'Escape') this.findClose();
    else return;
    e.preventDefault(); e.stopPropagation();
  };
}

/** A filter change invalidates ranked rows and pending replies without creating a box. */
export function invalidateSearch(canvas: HTMLCanvasElement) { const box = boxes.get(canvas); if (box) box.findClose(box.findOpen); }
/** The find box lives beside the canvas, so renderer teardown must remove it explicitly. */
export function disposeSearch(canvas: HTMLCanvasElement) { boxes.get(canvas)?.dispose(); boxes.delete(canvas); }

/** The view's find box for this renderer, created on first use; undefined when the stage is not searchable. */
export function omnibox(host: RendererControls) {
  let box = boxes.get(host.canvas); const parent = host.canvas.parentElement, source = parent && sources.get(parent);
  if (!box && parent && source) boxes.set(host.canvas, box = new Omnibox(host, parent, source));
  return box;
}
// "/" or Ctrl/Cmd+K opens the box; its Escape outranks the card's (order 10).
registerAction({
  id: 'find-note', label: 'Find a note', key: ['/', 'k', 'K'],
  when: ({ host, event: e }) => !!e && !e.altKey && (e.key === '/' ? !e.ctrlKey && !e.metaKey : e.ctrlKey || e.metaKey) && host.live && !!omnibox(host),
  run: ({ host }) => omnibox(host)!.findShow(),
});
registerAction({ id: 'close-find', label: 'Close find a note', key: 'Escape', order: 5, when: ({ host }) => !!boxes.get(host.canvas)?.findOpen, run: ({ host }) => boxes.get(host.canvas)!.findClose() });
