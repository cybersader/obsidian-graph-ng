import { mock } from 'bun:test';

export class FixtureFile {
  extension = 'md';
  stat = { size: 2 };
  constructor(public path: string) {}
}

mock.module('obsidian', () => ({
  Modal: class {}, ItemView: class {}, Plugin: class {}, PluginSettingTab: class {}, Setting: class {}, Notice: class {}, Menu: class {},
  TFile: FixtureFile, apiVersion: 'test',
  setIcon: (element: any, icon: string) => { element.empty(); element.createEl('svg', { attr: { 'data-icon': icon, 'aria-hidden': 'true' } }); },
}));
