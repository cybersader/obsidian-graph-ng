import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { root, git } from './gate-lib.mjs';

process.chdir(root);
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--out')) throw new Error('Usage: bun run release:local [--out NEW_DIRECTORY]');
if (git(['status', '--porcelain']).trim()) throw new Error('Release requires a clean source/index; commit reviewed changes first');
const pkg = JSON.parse(fs.readFileSync('package.json'));
const bun = execFileSync('bun', ['--version'], { encoding: 'utf8' }).trim();
if (pkg.packageManager !== `bun@${bun}`) throw new Error('Release requires the exact packageManager Bun version');
const output = path.resolve(args[1] ?? `.workspace/releases/${pkg.version}`);
if (fs.existsSync(output)) throw new Error('Output already exists; choose a fresh directory (never overwrite release evidence)');
// Caller holds the aggregate build lock; do not acquire it recursively.
for (const command of ['build', 'gates', 'test']) execFileSync('bun', ['run', command], { stdio: 'inherit' });
if (git(['status', '--porcelain']).trim()) throw new Error('Build/gates modified tracked inputs; review generated notices before release');
fs.mkdirSync(output, { recursive: true });
const assets = ['LICENSE', 'NOTICE', 'THIRD_PARTY_NOTICES.txt', 'main.js', 'manifest.json', 'styles.css', 'versions.json'];
for (const file of assets) fs.copyFileSync(file, path.join(output, file));
const provenance = { schema: 'graph-ng.local-release.v1', version: pkg.version, commit: git(['rev-parse', 'HEAD']).trim(), bun, node: process.versions.node, esbuild: JSON.parse(fs.readFileSync('node_modules/esbuild/package.json')).version };
fs.writeFileSync(path.join(output, 'release.json'), JSON.stringify(provenance, null, 2) + '\n');
const sums = [...assets, 'release.json'].sort().map(file => `${createHash('sha256').update(fs.readFileSync(path.join(output, file))).digest('hex')}  ${file}\n`).join('');
fs.writeFileSync(path.join(output, 'SHA256SUMS'), sums);
console.log(`LOCAL ONLY: release ${pkg.version}; checksummed assets ready. No tag, remote, upload, or publication performed.`);
