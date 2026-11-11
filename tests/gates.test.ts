import { test, expect } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
// JavaScript gates are also exercised through their actual CLI in isolated synthetic repos.
import { privateTerms, containsPrivate, containsSecret, containsAttribution, lifecycleHooks } from '../scripts/gate-lib.mjs';

test('fixed-string terms preserve literal whitespace, ignore comments/CRLF and fold case', () => {
  expect(privateTerms('# comment\r\n  # indented\n\nSecret.*\r\n spaced \n')).toEqual(['Secret.*', ' spaced ']);
  expect(containsPrivate('a SECRET.* b', ['secret.*'])).toBe(true);
  expect(containsPrivate('secretZZ', ['secret.*'])).toBe(false);
  expect(containsPrivate('a spaced b', [' spaced '])).toBe(true);
});
test('secret/attribution detectors reject synthetic credentials and metadata, not policy prose', () => {
  expect(containsSecret('AK' + 'IA' + 'Z'.repeat(16))).toBe(true);
  expect(containsSecret('gh' + 'p_' + 'x'.repeat(36))).toBe(true);
  expect(containsSecret('-----BEGIN ' + 'PRIVATE KEY-----')).toBe(true);
  expect(containsSecret('const password = "' + 'a'.repeat(30) + '"')).toBe(true);
  expect(containsSecret('No credentials in this synthetic document.')).toBe(false);
  expect(containsAttribution('Co-Authored-' + 'By: Cl' + 'aude <bot@example.invalid>')).toBe(true);
  expect(containsAttribution(JSON.stringify({ author: 'Cl' + 'aude' }))).toBe(true);
  expect(containsAttribution('Do not add AI co-authors. Human authors only.')).toBe(false);
  expect(lifecycleHooks({ scripts: { test: 'ok', prepare: 'source-build', postinstall: 'blocked' } })).toEqual({ postinstall: 'blocked' });
});

function fixture(run: (dir: string, git: (...args: string[]) => string, scan: (...args: string[]) => ReturnType<typeof spawnSync>) => void) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'graph-ng-gate-test-'));
  try {
    fs.mkdirSync(path.join(dir, 'scripts'));
    for (const name of ['gate-lib.mjs', 'check-content.mjs', 'check-supply-chain.mjs', 'inert-dev-hooks.json']) fs.copyFileSync(path.resolve(import.meta.dirname, '../scripts', name), path.join(dir, 'scripts', name));
    const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    git('init', '-q'); git('config', 'user.name', 'Test Maintainer'); git('config', 'user.email', 'maintainer@example.invalid');
    fs.writeFileSync(path.join(dir, '.gitignore'), 'test-screenshots/\n');
    fs.writeFileSync(path.join(dir, '.git/info/private-terms'), '# synthetic terms only\nprivate-sample\r\n');
    git('add', '.'); git('commit', '-qm', 'Initial synthetic gate fixture');
    const scan = (...args: string[]) => spawnSync('node', ['scripts/check-content.mjs', ...args], { cwd: dir, encoding: 'utf8', env: { ...process.env, CI: '', PRIVATE_TERMS_FILE: path.join(dir, '.git/info/private-terms'), GATE_COMMIT_RANGE: '' } });
    run(dir, git, scan);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
test('real privacy CLI covers README, staged bytes, ignored screenshot names and missing terms', () => fixture((dir, git, scan) => {
  expect(scan('privacy').status).toBe(0);
  fs.writeFileSync(path.join(dir, 'README.md'), 'PRIVATE-SAMPLE');
  const blocked = scan('privacy'); expect(blocked.status).not.toBe(0);
  expect(String(blocked.stderr)).not.toContain('PRIVATE-SAMPLE');
  git('add', 'README.md'); fs.writeFileSync(path.join(dir, 'README.md'), 'clean');
  expect(scan('privacy').status).not.toBe(0); // Unsafe staged bytes remain blocked.
  git('reset', '-q'); fs.rmSync(path.join(dir, 'README.md'));
  fs.mkdirSync(path.join(dir, 'test-screenshots'));
  fs.writeFileSync(path.join(dir, 'test-screenshots/PRIVATE-SAMPLE.png'), 'synthetic image bytes');
  expect(scan('privacy').status).not.toBe(0);
  fs.rmSync(path.join(dir, 'test-screenshots'), { recursive: true });
  fs.rmSync(path.join(dir, '.git/info/private-terms'));
  expect(scan('privacy').status).not.toBe(0);
}));
test('history scans catch removed private content and commit message attribution', () => fixture((dir, git, scan) => {
  fs.writeFileSync(path.join(dir, 'removed.txt'), 'private-sample'); git('add', '.'); git('commit', '-qm', 'Add synthetic historical fixture');
  fs.rmSync(path.join(dir, 'removed.txt')); git('add', '-u'); git('commit', '-qm', 'Remove synthetic fixture');
  expect(scan('privacy').status).toBe(0);
  expect(scan('privacy', '--history').status).not.toBe(0);
  git('commit', '--allow-empty', '-qm', 'Synthetic attribution test\n\nCo-Authored-' + 'By: Cl' + 'aude <bot@example.invalid>');
  expect(scan('attribution').status).not.toBe(0);
}));
test('secrets CLI scans current and historical content without exposing matched values', () => fixture((dir, git, scan) => {
  const secret = 'gh' + 'p_' + 'x'.repeat(36);
  fs.writeFileSync(path.join(dir, 'synthetic.txt'), secret);
  const result = scan('secrets'); expect(result.status).not.toBe(0); expect(String(result.stderr)).not.toContain(secret);
  git('add', '.'); git('commit', '-qm', 'Add synthetic scanner fixture');
  fs.rmSync(path.join(dir, 'synthetic.txt')); git('add', '-u'); git('commit', '-qm', 'Remove synthetic scanner fixture');
  expect(scan('secrets').status).toBe(0); expect(scan('secrets', '--history').status).not.toBe(0);
}));
test('supply chain CLI refuses runtime hooks, unlisted dev hooks, trust and version drift', () => fixture((dir) => {
  const write = (name: string, value: unknown) => fs.writeFileSync(path.join(dir, name), JSON.stringify(value));
  const pkg = { name: 'synthetic-gate-fixture', version: '0.1.0', trustedDependencies: [] as string[], dependencies: { runtime: '1.0.0' } };
  write('package.json', pkg); write('manifest.json', { version: '0.1.0', minAppVersion: '1.0.0' }); write('versions.json', { '0.1.0': '1.0.0' });
  fs.mkdirSync(path.join(dir, 'node_modules/runtime'), { recursive: true });
  write('node_modules/runtime/package.json', { name: 'runtime', version: '1.0.0', scripts: { postinstall: 'never execute' } });
  const check = () => spawnSync('node', ['scripts/check-supply-chain.mjs'], { cwd: dir, encoding: 'utf8' });
  expect(String(check().stderr)).toContain('Runtime install lifecycle declaration forbidden');
  write('node_modules/runtime/package.json', { name: 'runtime', version: '1.0.0' });
  fs.mkdirSync(path.join(dir, 'node_modules/new-dev'));
  write('node_modules/new-dev/package.json', { name: 'new-dev', version: '1.0.0', scripts: { install: 'never execute' } });
  expect(String(check().stderr)).toContain('Unlisted or changed inert development install hook');
  pkg.trustedDependencies.push('runtime'); write('package.json', pkg);
  expect(String(check().stderr)).toContain('Root install hooks or trusted dependencies forbidden');
  write('manifest.json', { version: '0.2.0', minAppVersion: '1.0.0' });
  expect(String(check().stderr)).toContain('VERSION_DRIFT');
}));
test('opt-in installer refuses overwrites/custom paths and installs an executable hook idempotently', () => fixture((dir) => {
  for (const name of ['install-hooks.sh', 'pre-commit.sh']) fs.copyFileSync(path.resolve(import.meta.dirname, '../scripts', name), path.join(dir, 'scripts', name));
  const install = () => spawnSync('bash', ['scripts/install-hooks.sh'], { cwd: dir, encoding: 'utf8' });
  expect(install().status).toBe(0); expect(install().status).toBe(0);
  const hook = path.join(dir, '.git/hooks/pre-commit');
  expect(fs.statSync(hook).mode & 0o111).not.toBe(0);
  fs.writeFileSync(hook, '# existing custom hook\n'); expect(install().status).not.toBe(0);
  expect(fs.readFileSync(hook, 'utf8')).toBe('# existing custom hook\n');
  execFileSync('git', ['config', 'core.hooksPath', 'custom-hooks'], { cwd: dir });
  expect(install().status).not.toBe(0);
}));
test('mangled bundle properties are private to the main bundle', async () => {
  const { MANGLED_PROPS } = await import('../scripts/mangle-props.mjs');
  const read = (p: string) => fs.readFileSync(p, 'utf8'), ids = (text: string) => new Set(text.match(/[A-Za-z_$][\w$]*/g));
  const lib = path.join(import.meta.dir, '../node_modules/typescript/lib'), reserved = new Set<string>();
  for (const file of [...fs.readdirSync(lib).filter(f => /^lib\..*\.d\.ts$/.test(f)).map(f => path.join(lib, f)), path.join(import.meta.dir, '../node_modules/obsidian/obsidian.d.ts')]) for (const id of ids(read(file))) reserved.add(id);
  const src = path.join(import.meta.dir, '../src'), dir = (d: string) => fs.readdirSync(d).filter(f => /\.m?ts$/.test(f)).map(f => path.join(d, f));
  // Worker-bundle sources and harness/e2e code may cross the bundle boundary by property name.
  const crossing = [...dir(path.join(src, 'core')), ...['layout-worker.ts', 'pipeline.ts', 'render-projection.ts', 'gpu-probe.ts'].map(f => path.join(src, f)), ...dir(path.join(import.meta.dir, 'e2e')), ...dir(path.join(import.meta.dir, '../scripts'))];
  for (const file of crossing) for (const id of ids(read(file))) reserved.add(id);
  const literals = new Set<string>();
  for (const file of [...dir(src), ...dir(path.join(src, 'adapter'))]) for (const m of read(file).matchAll(/['"`]([A-Za-z_]\w*)['"`]/g)) literals.add(m[1]!);
  expect(MANGLED_PROPS.length).toBeGreaterThan(0);
  expect(MANGLED_PROPS.filter((n: string) => reserved.has(n) || literals.has(n))).toEqual([]);
});
