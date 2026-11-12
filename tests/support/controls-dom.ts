import { expect } from 'bun:test';
/** Minimal deterministic DOM seam: no layout, CSS computation or native keyboard simulation. */
export class ControlElement {
  children: ControlElement[] = [];
  attributes: Record<string, string> = {};
  classes = new Set<string>();
  parent?: ControlElement;
  textContent = '';
  hidden = false;
  disabled = false;
  value = '';
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
  setAttribute(key: string, value: string) { this.attributes[key] = value; if (key === 'id') this.id = value; }
  getAttribute(key: string) { return this.attributes[key] ?? null; }
  addClass(cls: string) { this.classes.add(cls); }
  toggleClass(cls: string, on: boolean) { if (on) this.classes.add(cls); else this.classes.delete(cls); }
  empty() { this.children = []; }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); }
  focus() { ControlElement.active = this; }
  click() { if (!this.disabled) this.onclick?.(); }
  querySelectorAll(selector: string): ControlElement[] {
    const all = this.children.flatMap(child => [child, ...child.querySelectorAll('*')]);
    return selector === '*' ? all : all.filter(child => selector.startsWith('.') ? child.classes.has(selector.slice(1)) : child.tagName.toLowerCase() === selector);
  }
  querySelector(selector: string) { return this.querySelectorAll(selector)[0]; }
}
export function control(root: ControlElement, text: string) {
  const found = root.querySelectorAll('button').find(child => child.textContent === text);
  expect(found).toBeDefined(); return found!;
}
