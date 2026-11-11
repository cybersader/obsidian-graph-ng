import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chooseFixture, fixtureShape, exampleDeclaration, expressionFixture } from './fixture';
import { defaults } from '../src/settings';
const small = process.argv.includes('--small');
// --clustered (or GRAPH_FIXTURE=clustered) writes community-structured data to its own synthetic vault.
const shape = process.argv.includes('--clustered') ? 'clustered' : fixtureShape();
const root = path.resolve('test-vault', (small ? 'small' : 'large') + (process.argv.includes('--expressions') ? '-expressions' : shape === 'clustered' ? '-clustered' : ''));
const neutral = process.argv.includes('--expressions') ? expressionFixture(small ? 600 : 16000, small ? 1400 : 44600) : undefined;
const start = performance.now(), rows = neutral?.rows ?? chooseFixture(shape)(small ? 600 : 16000, small ? 1400 : 44600);
// Synthetic-only destination: do not delete or overwrite any other vault.
await mkdir(root, { recursive: true });
for (const row of rows) {
  const file = path.join(root, row.path); await mkdir(path.dirname(file), { recursive: true });
  const frontmatter = Object.entries(row.properties).map(([key, value]) => `${key}: ${JSON.stringify(value)}`).join('\n');
  await writeFile(file, `---\n${frontmatter}\n---\n# ${path.basename(row.path, '.md')}\n\nSynthetic graph fixture, seed 17, ${shape}.\n`);
}
const settings = defaults('obsidian-links@1.12.7'); settings.declaration = neutral?.declaration ?? exampleDeclaration;
if (process.argv.includes('--literal')) settings.declaration = { ...settings.declaration, display: { reifiedAsNodes: true } };
const config = path.join(root, '.obsidian'); await mkdir(path.join(config, 'plugins/graph-ng'), { recursive: true });
await writeFile(path.join(config, 'plugins/graph-ng/data.json'), JSON.stringify({ settings, generations: {} }));
await writeFile(path.join(config, 'community-plugins.json'), JSON.stringify(['graph-ng']));
await writeFile(path.join(config, 'app.json'), JSON.stringify({ settingsPopoutWindow: false }));
console.log(JSON.stringify({ root, seed: 17, shape, concepts: small ? 600 : 16000, mappings: small ? 1400 : 44600, notes: rows.length, milliseconds: performance.now() - start }));
