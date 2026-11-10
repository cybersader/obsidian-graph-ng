import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fixture, exampleDeclaration } from './fixture';
import { defaults } from '../src/settings';
const small = process.argv.includes('--small');
const root = path.resolve('test-vault', small ? 'small' : 'large');
const start = performance.now(), rows = fixture(small ? 600 : 16000, small ? 1400 : 44600);
// Synthetic-only destination: do not delete or overwrite any other vault.
await mkdir(root, { recursive: true });
for (const row of rows) {
  const file = path.join(root, row.path); await mkdir(path.dirname(file), { recursive: true });
  const frontmatter = Object.entries(row.properties).map(([key, value]) => `${key}: ${JSON.stringify(value)}`).join('\n');
  await writeFile(file, `---\n${frontmatter}\n---\n# ${path.basename(row.path, '.md')}\n\nSynthetic graph fixture, seed 17.\n`);
}
const settings = defaults('obsidian-links@1.12.7'); settings.declaration = exampleDeclaration;
if (process.argv.includes('--literal')) settings.declaration = { ...exampleDeclaration, display: { reifiedAsNodes: true } };
const config = path.join(root, '.obsidian'); await mkdir(path.join(config, 'plugins/graph-ng'), { recursive: true });
await writeFile(path.join(config, 'plugins/graph-ng/data.json'), JSON.stringify({ settings, generations: {} }));
await writeFile(path.join(config, 'community-plugins.json'), JSON.stringify(['graph-ng']));
await writeFile(path.join(config, 'app.json'), JSON.stringify({ settingsPopoutWindow: false }));
console.log(JSON.stringify({ root, seed: 17, concepts: small ? 600 : 16000, mappings: small ? 1400 : 44600, notes: rows.length, milliseconds: performance.now() - start }));
