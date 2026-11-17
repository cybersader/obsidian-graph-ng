import { Modal, Notice, Setting } from 'obsidian';
import { disclosure, disclosureBody, panelButton, panelHelp, settingRow, settingSelect } from './panel-help';
import { devicePerformance, type PerformanceMode } from './performance';
import type { Settings } from './settings';
import type GraphPlugin from './main';
export type PerformanceChoice = 'fast' | 'labels' | 'curves' | 'motion' | 'relationships';
export function performanceChoices(s: Settings): [PerformanceChoice, string, string][] {
  const rows: [PerformanceChoice, string, string][] = [];
  if (!devicePerformance.fast(s.performance)) rows.push(['fast', 'Use Fast mode', 'Lower resolution, no motion. Layout accuracy is unchanged.']);
  if (s.visuals.labelStyle === 'ranked') rows.push(['labels', 'Use anchored labels', 'Avoid the ranked glyph texture. Names remain available.']);
  if (s.visuals.curvedEdges && s.visuals.edgeMode !== 'off' && s.visuals.edgeOpacity > 0) rows.push(['curves', 'Use straight edges', 'Draw one segment per edge instead of several.']);
  if (s.visuals.motion === 'full' && !devicePerformance.fast(s.performance)) rows.push(['motion', 'Turn off motion', 'Camera and focus changes become instant instead of drawing repeated frames.']);
  if (s.declaration.display.reifiedAsNodes) rows.push(['relationships', 'Show relationship notes as lines', 'Remove extra dots and incidence edges. Connection notes remain inspectable.']);
  return rows;
}
export function performanceSettings(s: Settings, selected: ReadonlySet<PerformanceChoice>): Settings {
  const next = { ...s, visuals: { ...s.visuals }, declaration: { ...s.declaration, display: { ...s.declaration.display } } };
  if (selected.has('fast')) next.performance = 'fast';
  if (selected.has('labels')) next.visuals.labelStyle = 'anchored';
  if (selected.has('curves')) next.visuals.curvedEdges = false;
  if (selected.has('motion')) next.visuals.motion = 'off';
  if (selected.has('relationships')) next.declaration.display.reifiedAsNodes = false;
  return next;
}
export function performanceControls(host: HTMLElement, plugin: GraphPlugin, redraw?: () => void) {
  settingSelect(host, 'Performance', 'Auto adapts resolution and motion to measured drawing cost. Fast limits resolution to 1x and disables motion. Quality preserves full resolution and your motion setting. Layout accuracy is unchanged.', [['auto', 'Auto'], ['fast', 'Fast'], ['quality', 'Quality']], plugin.settings.performance, value => { plugin.settings.performance = value as PerformanceMode; void plugin.save(); plugin.refreshPerformance(); });
  const tier = settingRow(host, 'Device tier');
  panelHelp(tier, devicePerformance.tier === 'low' ? 'Lower' : 'Standard', 'A provisional estimate from CPU, memory and the existing graphics context. Measured drawing cost can revise it. Not a hardware benchmark.');
  panelButton(host, 'Speed up graph', () => showPerformanceSuggestions(plugin, redraw));
  const row = settingRow(host, 'Local performance log', 'graph-ng-toggle', 'Off by default. Stores at most 16 numeric timing, count and memory samples in plugin data. No note names, paths, content or hardware identifiers. Anyone with plugin-data access can read it.');
  const input = row.querySelector('input')!; input.checked = plugin.settings.performanceDiagnostics;
  input.onchange = () => { plugin.settings.performanceDiagnostics = input.checked; if (!input.checked) plugin.performanceLog = []; void plugin.save(); };
  panelButton(host.createDiv(), 'Clear log', () => { plugin.performanceLog = []; void plugin.save(); });
}
export function showPerformanceSuggestions(plugin: GraphPlugin, redraw?: () => void) {
  if (plugin.performanceModalOpen) return;
  plugin.performanceModalOpen = true;
  plugin.settings.performancePrompted = true;
  void plugin.save().catch(() => new Notice('Could not remember the performance offer.'));
  const choices = performanceChoices(plugin.settings), selected = new Set(choices.map(([key]) => key));
  const [title, reason] = plugin.performanceReason ?? devicePerformance.suggestion() ?? ['Speed up graph', 'Reduce drawing work with these settings.'];
  const modal = new Modal(plugin.app); modal.setTitle(title);
  modal.contentEl.addClass('graph-ng-performance');
  panelHelp(modal.contentEl.createEl('p'), reason, 'Suggested from device estimates, graph size or measured app cost. These are policy thresholds, not a hardware benchmark. App memory and long tasks include other app work, not just this graph. Changes reduce drawing work without changing layout accuracy.');
  let closed = false, busy = false;
  const inputs: HTMLInputElement[] = [], buttons: { setDisabled(value: boolean): unknown }[] = [];
  const lock = (value: boolean) => { busy = value; inputs.forEach(input => { input.disabled = value; }); buttons.forEach(button => button.setDisabled(value)); };
  modal.onClose = () => { closed = true; if (!busy) plugin.performanceModalOpen = false; };
  // Obsidian supplies the X icon and keyboard/focus lifecycle.
  if (choices.length) {
    const details = modal.contentEl.createEl('details');
    disclosure(details, 'Choose changes');
    const body = disclosureBody(details);
    for (const [key, label, help] of choices) {
      const row = settingRow(body, label, 'graph-ng-toggle', help), input = row.querySelector('input')!;
      inputs.push(input); input.checked = true; input.onchange = () => { if (input.checked) selected.add(key); else selected.delete(key); };
    }
  }
  if (!choices.length) modal.contentEl.createEl('p', { text: 'Drawing settings are already simplified.' });
  let never = false;
  const suppression = settingRow(modal.contentEl, "Don't ask again", 'graph-ng-toggle graph-ng-performance-suppress');
  const suppressInput = suppression.querySelector('input')!; inputs.push(suppressInput);
  suppressInput.onchange = () => { never = suppressInput.checked; };
  const error = modal.contentEl.createDiv({ attr: { role: 'status' } });
  const actions = new Setting(modal.contentEl);
  let initialFocus: HTMLButtonElement | undefined;
  actions.addButton(b => { initialFocus = b.buttonEl; buttons.push(b); b.setButtonText('Not now').onClick(async () => {
    if (busy) return;
    lock(true);
    try { if (never) await plugin.commitPerformance(new Set(), true, () => !closed); modal.close(); }
    catch { error.textContent = 'Could not save. Try again.'; }
    finally { lock(false); if (closed) plugin.performanceModalOpen = false; }
  }); });
  if (choices.length) actions.addButton(b => { initialFocus = b.buttonEl; buttons.push(b); b.setButtonText('Speed up').setCta().onClick(async () => {
    if (busy) return;
    lock(true);
    try { await plugin.commitPerformance(selected, never, () => !closed); redraw?.(); modal.close(); }
    catch { error.textContent = 'Could not apply. Try again.'; new Notice('Performance changes were not saved.'); }
    finally { lock(false); if (closed) plugin.performanceModalOpen = false; }
  }); });
  modal.open();
  // Keep the reason's help popover closed until requested, not opened by native initial focus.
  initialFocus?.focus();
}
