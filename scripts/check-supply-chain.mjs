import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { root, lifecycleHooks } from './gate-lib.mjs';

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json')));
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json')));
const versions = JSON.parse(fs.readFileSync(path.join(root, 'versions.json')));
if (!/^\d+\.\d+\.\d+$/.test(pkg.version) || pkg.version !== manifest.version || versions[pkg.version] !== manifest.minAppVersion) throw new Error('VERSION_DRIFT: package/manifest/versions must agree');
if (!Array.isArray(pkg.trustedDependencies) || pkg.trustedDependencies.length || Object.keys(lifecycleHooks(pkg)).length) throw new Error('Root install hooks or trusted dependencies forbidden');
for (const [name, version] of Object.entries({ ...pkg.dependencies, ...pkg.devDependencies })) if (!/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(version)) throw new Error(`Exact dependency version required: ${name}`);

function packageDir(name, from) {
  const req = createRequire(path.join(from, 'package.json'));
  let file;
  try { file = req.resolve(`${name}/package.json`); } catch { file = req.resolve(name); }
  let dir = path.dirname(file);
  while (dir !== path.dirname(dir)) {
    const p = path.join(dir, 'package.json');
    if (fs.existsSync(p) && JSON.parse(fs.readFileSync(p)).name === name) return fs.realpathSync(dir);
    dir = path.dirname(dir);
  }
  throw new Error(`Cannot resolve package ${name}`);
}
const runtime = new Set();
function visitRuntime(name, from) {
  const dir = packageDir(name, from);
  if (runtime.has(dir)) return;
  runtime.add(dir);
  const p = JSON.parse(fs.readFileSync(path.join(dir, 'package.json')));
  if (Object.keys(lifecycleHooks(p)).length) throw new Error(`Runtime install lifecycle declaration forbidden: ${p.name}`);
  for (const dep of Object.keys({ ...p.dependencies, ...p.peerDependencies })) visitRuntime(dep, dir);
  for (const dep of Object.keys(p.optionalDependencies ?? {})) {
    try { packageDir(dep, dir); } catch { continue; }
    visitRuntime(dep, dir);
  }
}
for (const dep of Object.keys(pkg.dependencies ?? {})) visitRuntime(dep, root);
const exceptions = JSON.parse(fs.readFileSync(path.join(root, 'scripts/inert-dev-hooks.json')));
const seen = new Set();
let packages = 0, inert = 0;
function visitInstalled(modules) {
  if (!fs.existsSync(modules)) return;
  for (const entry of fs.readdirSync(modules)) {
    if (entry.startsWith('.')) continue;
    const file = path.join(modules, entry);
    if (entry.startsWith('@')) { visitInstalled(file); continue; }
    const dir = fs.realpathSync(file);
    if (seen.has(dir) || !fs.existsSync(path.join(dir, 'package.json'))) continue;
    seen.add(dir); packages++;
    const p = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'))), hooks = lifecycleHooks(p);
    if (Object.keys(hooks).length && !runtime.has(dir)) {
      const key = `${p.name}@${p.version}`, exception = exceptions[key];
      const hash = createHash('sha256').update(JSON.stringify(hooks)).digest('hex');
      if (!exception || exception.hooksSha256 !== hash || !exception.reason) throw new Error(`Unlisted or changed inert development install hook: ${key}`);
      inert++; console.log(`INERT dev exception: ${key} (${Object.keys(hooks).join(',')}); never executed`);
    }
    visitInstalled(path.join(dir, 'node_modules'));
  }
}
visitInstalled(path.join(root, 'node_modules'));
if (!packages) throw new Error('Dependencies must be installed before this gate');
console.log(`PASS install policy: ${runtime.size} runtime / ${packages} installed packages; ${inert} exact inert dev exceptions; trustedDependencies empty.`);

// Isolated manifest/lock validation: never edit the developer's install or lockfile.
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'graph-ng-lock-'));
try {
  for (const name of ['package.json', 'bun.lock']) fs.copyFileSync(path.join(root, name), path.join(temp, name));
  const before = fs.readFileSync(path.join(temp, 'bun.lock'));
  execFileSync('bun', ['install', '--lockfile-only', '--frozen-lockfile', '--ignore-scripts'], { cwd: temp, stdio: 'pipe' });
  if (!before.equals(fs.readFileSync(path.join(temp, 'bun.lock')))) throw new Error('Frozen lockfile changed');
} catch {
  throw new Error('FROZEN_LOCKFILE_FAILED: regenerate/review lockfile with scripts disabled; see CONTRIBUTING.md');
} finally { fs.rmSync(temp, { recursive: true, force: true }); }
console.log('PASS frozen-lockfile: isolated bun install --lockfile-only --frozen-lockfile --ignore-scripts; lock bytes unchanged.');
