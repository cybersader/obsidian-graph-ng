import { mock } from 'bun:test';

export class FixtureFile {
  extension = 'md';
  stat = { size: 2 };
  constructor(public path: string) {}
}

mock.module('obsidian', () => ({
  ItemView: class {}, Plugin: class {}, PluginSettingTab: class {}, Setting: class {}, Notice: class {},
  TFile: FixtureFile, apiVersion: 'test',
}));
