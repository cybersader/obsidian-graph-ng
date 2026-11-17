import { disclosure, disclosureBody, iconButton, panelButton, panelHelp } from './panel-help';

/** Names describe existing layers. They are not persisted or a second state machine. */
export const VIEW_STATES = ['Notes', 'Selected note', 'Only connections', 'Connection rings', 'Path between notes', 'Groups'] as const;
export type ViewState = typeof VIEW_STATES[number];
export function namedViewState(groups: boolean, path: boolean, rings: boolean, isolated: boolean, selected: boolean): ViewState {
  return VIEW_STATES[groups ? 5 : rings ? 3 : path ? 4 : isolated ? 2 : selected ? 1 : 0]!;
}
export const STATE_HELP = [
  'Your note graph, with filters kept.',
  'Click a note to select it. Its X clears selection, not filters.',
  'Only the chosen note and its nearby connections. Its X restores surrounding notes and keeps filters.',
  'Temporary rings around a note. Its X or L restores positions, keeping any Only connections scope.',
  'Select a note, then Shift-click another to find a path. Its X dismisses the path, keeping filters.',
  'Groups replace individual notes. Open Notes or a group to leave.',
];
/** Native disclosure menu keeps Tab/Enter/Space behavior, with no document listeners. */
export function stateChip(host: HTMLElement, state: ViewState, subject: string, leave: () => void, tune: (state: ViewState) => void, switchTo?: (state: ViewState) => void, available = false) {
  const chip = host.createDiv({ cls: 'graph-ng-state-chip' });
  panelButton(chip, state, () => tune(state), false, 'graph-ng-state-name', { 'aria-label': `${state} appearance` });
  if (subject) chip.createSpan({ cls: 'graph-ng-state-subject', text: subject });
  if (switchTo) {
    const menu = chip.createEl('details', { cls: 'graph-ng-state-menu' });
    const trigger = disclosure(menu, '', { 'aria-label': 'View state menu' });
    const body = disclosureBody(menu);
    const action = (label: string, run: () => void, disabled = false) => panelButton(body, label, () => { menu.open = false; run(); }, disabled);
    action('Tune this view', () => tune(state));
    action('Change note click action', () => tune('Selected note'));
    panelHelp(body, 'Switch state', STATE_HELP[VIEW_STATES.indexOf(state)]);
    for (const next of VIEW_STATES) {
      if (next === 'Path between notes') { panelHelp(body, next, STATE_HELP[4]); continue; }
      action(next, () => switchTo(next), next === state || next !== 'Notes' && next !== 'Groups' && !available);
    }
    menu.onkeydown = e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); menu.open = false; trigger.focus(); } };
    menu.addEventListener?.('focusout', e => { if (!menu.contains(e.relatedTarget as Node | null)) menu.open = false; });
  }
  if (state !== 'Notes' && state !== 'Groups') iconButton(chip, `Leave ${state}`, 'x').onclick = leave;
  return chip;
}
