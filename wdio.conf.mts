import path from 'node:path';
export const config: WebdriverIO.Config = {
  runner: 'local', framework: 'mocha', specs: [process.env.GRAPH_EXPRESSIONS ? './tests/e2e/expressions.spec.ts' : process.env.GRAPH_EXPLORE ? './tests/e2e/explore.spec.ts' : process.env.GRAPH_PROFILE ? './tests/e2e/profile.spec.ts' : './tests/e2e/graph.spec.ts'], maxInstances: 1,
  capabilities: [{ browserName: 'obsidian', browserVersion: '1.13.7',
    'wdio:obsidianOptions': { installerVersion: '1.13.7', vault: path.resolve('test-vault', (process.env.GRAPH_LARGE ? 'large' : 'small') + (process.env.GRAPH_EXPRESSIONS ? '-expressions' : process.env.GRAPH_FIXTURE === 'clustered' ? '-clustered' : '')), plugins: ['.'] },
    'goog:chromeOptions': { args: ['--no-sandbox', '--use-gl=angle', process.env.GRAPH_SOFTWARE ? '--use-angle=swiftshader' : '--use-angle=gl', '--ignore-gpu-blocklist', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--window-size=1440,1000'] },
  }],
  services: ['obsidian'], reporters: ['obsidian'],
  cacheDir: process.env.OBSIDIAN_CACHE ?? path.resolve('.obsidian-cache'),
  mochaOpts: { ui: 'bdd', timeout: 240000 }, logLevel: 'warn',
};
