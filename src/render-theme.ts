import type { Settings } from './settings';
export interface GraphTheme { background: string; node: string; edge: string; group: string; text: string; accent: string; font: string; palette: Uint8Array }
const validColor = /^(?:#[0-9a-f]{6}(?:[0-9a-f]{2})?|var\(--[a-z0-9-]+\))$/i;
export function readTheme(container: HTMLElement, settings: Settings): GraphTheme {
  const style = getComputedStyle(container), canvas = document.createElement('canvas');
  // Palette conversion is CPU readback, not a drawing surface. Avoid a GPU
  // synchronization for each color when opening or switching the group view.
  canvas.width = canvas.height = 1;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  const resolve = (color: string, fallback: string) => {
    if (!validColor.test(color)) return fallback;
    if (color.startsWith('var(')) color = style.getPropertyValue(color.slice(4, -1)).trim();
    // Host CSS may use rgb()/hsl(); normalize with Canvas, never inject vault text into CSS/DOM.
    ctx.fillStyle = fallback; ctx.fillStyle = color; return String(ctx.fillStyle);
  };
  const css = (name: string, host: string, fallback: string) => {
    const value = style.getPropertyValue(`--graph-ng-${name}`).trim() || style.getPropertyValue(host).trim();
    ctx.fillStyle = fallback; if (value) ctx.fillStyle = value; return String(ctx.fillStyle);
  };
  const theme = { background: css('bg', '--background-primary', settings.backgroundColor), node: css('node', '--graph-node', settings.nodeColor), edge: css('edge', '--graph-line', settings.edgeColor), group: css('group', '--graph-node', settings.groupColor), text: css('text', '--graph-text', settings.textColor), accent: css('accent', '--graph-node-focused', settings.nodeColor), font: style.getPropertyValue('--graph-ng-font').trim() || style.getPropertyValue('--font-interface').trim() || 'sans-serif', palette: new Uint8Array(Math.max(256, Math.ceil((settings.declaration.colors.length + 5) / 256) * 256) * 4) };
  const colors = [theme.node, theme.edge, theme.background, theme.text, theme.accent, ...settings.declaration.colors.map(c => resolve(c.color, theme.node))];
  for (let i = 0; i < colors.length; i++) {
    ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = colors[i]!; ctx.fillRect(0, 0, 1, 1); theme.palette.set(ctx.getImageData(0, 0, 1, 1).data, i * 4);
  }
  return theme;
}
