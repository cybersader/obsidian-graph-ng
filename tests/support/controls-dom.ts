import { expect } from 'bun:test';
/** Minimal deterministic DOM seam: no layout, CSS computation or native keyboard simulation. */
export class ControlElement {
  children: ControlElement[] = [];
  attributes: Record<string, string> = {};
  classes = new Set<string>();
  parent?: ControlElement;
  private text = '';
  get textContent(): string { return this.text + this.children.map(child => child.textContent).join(''); }
  set textContent(value: string) { this.empty(); this.text = value; }
  hidden = false;
  scrollTop = 0;
  style: Record<string, string> = {};
  type = '';
  contains(node: unknown): boolean { return node === this || this.children.some(child => child.contains(node)); }
  appendChild(node: ControlElement) { node.remove(); node.parent = this; this.children.push(node); return node; }
  append(...nodes: ControlElement[]) { nodes.forEach(node => this.appendChild(node)); }
  disabled = false;
  value = '';
  selectionStart: number | null = null;
  selectionEnd: number | null = null;
  setSelectionRange(start: number | null, end: number | null) { this.selectionStart = start; this.selectionEnd = end; }
  id = '';
  dataset: Record<string, string> = {};
  onclick?: () => void;
  static active?: ControlElement;
  constructor(readonly tagName = 'DIV') {}
  createEl(tag: string, options: any = {}) {
    const child = new ControlElement(tag.toUpperCase());
    child.parent = this; child.textContent = options.text ?? ''; child.value = options.value ?? '';
    for (const cls of (options.cls ?? '').split(' ').filter(Boolean)) child.classes.add(cls);
    for (const [key, value] of Object.entries(options.attr ?? {})) child.setAttribute(key, value as string);
    this.children.push(child); return child;
  }
  createDiv(options?: any) { return this.createEl('div', options); }
  createSpan(options?: any) { return this.createEl('span', options); }
  setAttribute(key: string, value: string) { this.attributes[key] = value; if (key === 'id') this.id = value; if (key === 'type') this.type = value; }
  getAttribute(key: string) { return this.attributes[key] ?? null; }
  addClass(cls: string) { this.classes.add(cls); }
  toggleClass(cls: string, on: boolean) { if (on) this.classes.add(cls); else this.classes.delete(cls); }
  empty() { this.text = ''; this.children.forEach(child => { child.parent = undefined; }); this.children = []; }
  before(node: ControlElement) { node.remove(); const p = this.parent!; node.parent = p; p.children.splice(p.children.indexOf(this), 0, node); }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); }
  onblur?: () => void;
  focus() { if (this.disabled) return; if (ControlElement.active !== this) ControlElement.active?.onblur?.(); ControlElement.active = this; }
  click() { if (!this.disabled) this.onclick?.(); }
  querySelectorAll(selector: string): ControlElement[] {
    const all = this.children.flatMap(child => [child, ...child.querySelectorAll('*')]);
    return selector === '*' ? all : all.filter(child => selector.split(',').some(s => s.startsWith('.') ? child.classes.has(s.slice(1)) : child.tagName.toLowerCase() === s));
  }
  querySelector(selector: string) { return this.querySelectorAll(selector)[0]; }
}
/** A button by its visible text, else (icon buttons) by its accessible name. */
export function control(root: ControlElement, text: string) {
  const buttons = root.querySelectorAll('button'), found = buttons.find(child => child.textContent === text) ?? buttons.find(child => child.attributes['aria-label'] === text);
  expect(found).toBeDefined(); return found!;
}
