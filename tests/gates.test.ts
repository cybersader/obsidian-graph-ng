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
  const crossing = [...dir(path.join(src, 'core')), ...['layout-worker.ts', 'pipeline.ts', 'render-projection.ts', 'gpu-probe.ts', 'layout-engine.ts', 'layout-engine-policy.ts', 'webgpu-layout.ts', 'webgpu-layout-shaders.ts'].map(f => path.join(src, f)), ...dir(path.join(import.meta.dir, 'e2e')), ...dir(path.join(import.meta.dir, '../scripts'))];
  for (const file of crossing) for (const id of ids(read(file))) reserved.add(id);
  const literals = new Set<string>();
  for (const file of [...dir(src), ...dir(path.join(src, 'adapter'))]) for (const m of read(file).matchAll(/['"`]([A-Za-z_]\w*)['"`]/g)) literals.add(m[1]!);
  expect(MANGLED_PROPS.length).toBeGreaterThan(0);
  expect(MANGLED_PROPS.filter((n: string) => reserved.has(n) || literals.has(n))).toEqual([]);
});

test('property mangling excludes every declared settings and node-sizing schema key', async () => {
  const { MANGLED_PROPS } = await import('../scripts/mangle-props.mjs');
  const { default: ts } = await import('typescript');
  const keys = new Set<string>();
  // Unlike a string-literal scan, this covers unquoted and optional persistence keys,
  // including fields absent from defaults. Core/message keys are covered above.
  for (const file of ['settings.ts', 'node-sizing.ts']) {
    const source = ts.createSourceFile(file, fs.readFileSync(path.join(import.meta.dir, '../src', file), 'utf8'), ts.ScriptTarget.Latest, true);
    const visit = (node: import('typescript').Node) => {
      if (ts.isPropertySignature(node) && (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name))) keys.add(node.name.text);
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  expect(keys.has('settingsVersion')).toBe(true);
  expect(keys.has('labelTierScale')).toBe(true);
  expect(keys.has('floor')).toBe(true);
  expect(MANGLED_PROPS.filter(name => keys.has(name))).toEqual([]);
  expect(new Set(MANGLED_PROPS).size).toBe(MANGLED_PROPS.length);
});

test('UI pass download ceilings remain exactly bounded and active documentation agrees', () => {
  const root = path.resolve(import.meta.dirname, '..');
  const gate = fs.readFileSync(path.join(root, 'scripts/bundle-size.mjs'), 'utf8');
  expect(gate).toContain('zeroDependencyTargetBytes: 450000, zeroDependencyTargetGzipBytes: 165000');
  for (const name of ['README.md', 'CONTRIBUTING.md', 'docs/publish-checklist.md', 'CHANGELOG.md']) {
    const doc = fs.readFileSync(path.join(root, name), 'utf8');
    expect(doc).toContain('450,000'); expect(doc).toContain('165,000');
  }
});

test('close controls are X icons: no visible "Close" button text in src (owner rule)', () => {
  const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(dir, e.name)) : /\.ts$/.test(e.name) ? [path.join(dir, e.name)] : []);
  // Visible text is a `text:` option, a textContent/innerText assignment, or the first argument of a button helper. aria-label/title may say "Close".
  const visible = /(?:\btext\s*:|\.(?:textContent|innerText)\s*=|\bbutton\s*\()\s*(['"`])\s*Close\b/;
  const offenders = walk(path.join(import.meta.dir, '..', 'src')).flatMap(file => fs.readFileSync(file, 'utf8').split('\n').map((line, i) => visible.test(line) ? `${path.basename(file)}:${i + 1}` : '').filter(Boolean));
  expect(offenders).toEqual([]);
  expect(visible.test(`createEl('button', { text: 'Close' })`)).toBe(true); expect(visible.test(`button('Close', 'Close', run)`)).toBe(true);
  expect(visible.test(`b.textContent = "Close card"`)).toBe(true); expect(visible.test(`button('×', 'Close', run)`)).toBe(false); expect(visible.test(`attr: { 'aria-label': 'Close graph tools' }`)).toBe(false);
});
test('UI strings never use middle dots or em dashes (owner rule)', () => {
  const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(dir, e.name)) : /\.ts$/.test(e.name) ? [path.join(dir, e.name)] : []);
  const offenders = walk(path.join(import.meta.dir, '..', 'src')).filter(file => /[·—]/.test(fs.readFileSync(file, 'utf8')));
  expect(offenders).toEqual([]);
});
test('src stays domain-neutral: no use-case vocabulary in code or UI copy (owner rule)', () => {
  // Graph NG is ontology-neutral; any one domain lives only in a declaration (settings), never in code.
  const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(dir, e.name)) : /\.ts$/.test(e.name) ? [path.join(dir, e.name)] : []);
  const domain = /\b(?:crosswalks?|crosswalker|frameworks?|curie|sssom|subject_id|object_id|predicate_id|parent_curie|NIST|MITRE)\b/i;
  const offenders = walk(path.join(import.meta.dir, '..', 'src')).flatMap(file => fs.readFileSync(file, 'utf8').split('\n').map((line, i) => domain.test(line) ? `${path.basename(file)}:${i + 1}` : '').filter(Boolean));
  expect(offenders).toEqual([]);
});
test('UI copy keeps the README Terminology glossary: no retired synonyms in src string literals (owner rule)', () => {
  // Narrow on purpose: only quoted literals on non-comment lines, and only phrases the glossary retired.
  // Edge notes are relationship notes; 2-hop is neighbours of neighbours; disconnected parts, not islands; Notes and Groups, not node graph/group view.
  const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(dir, e.name)) : /\.ts$/.test(e.name) ? [path.join(dir, e.name)] : []);
  const retired = /\b(?:neighbors?|edge[- ]notes?|2-hop|group overview|node graph|group view|group graph|group fallback|carrier notes|contributing mappings|islands?|unlinked|loose notes|(?:heavily|well)[- ]linked)\b/i;
  const literals = (line: string) => /^\s*(?:\/\/|\*|\/\*)/.test(line) ? [] : [...line.matchAll(/(['"`])((?:\\.|(?!\1).)*?)\1/g)].map(m => m[2]!);
  const offenders = walk(path.join(import.meta.dir, '..', 'src')).flatMap(file => fs.readFileSync(file, 'utf8').split('\n').flatMap((line, i) => literals(line).filter(s => retired.test(s) && !(path.basename(file) === 'panel-help.ts' && line.startsWith('export const RELATIONSHIP_HELP = '))).map(s => `${path.basename(file)}:${i + 1}: ${s}`)));
  expect(offenders).toEqual([]);
  expect(literals(`text: 'Group overview'`).some(s => retired.test(s))).toBe(true);
  expect(literals(`note(host, 'Then 2-hop.')`).some(s => retired.test(s))).toBe(true); expect(literals(`text: 'Edge-note size'`).some(s => retired.test(s))).toBe(true);
  expect(literals(`// neighbors in a comment`)).toEqual([]); expect(literals(`const neighbours = edges.get(focus);`).some(s => retired.test(s))).toBe(false);
});
test('no count reads "x of y": user-visible strings and templates never put a number over an unnamed denominator (owner rule)', () => {
  // Each count says what it counts ("1,200 notes shown"); each difference is its own named row. Path joins and "Part 1 of key" stay legal.
  const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(dir, e.name)) : /\.ts$/.test(e.name) ? [path.join(dir, e.name)] : []);
  const count = String.raw`\$\{[^{}]*\b(?:num|n|plural|toLocaleString|length|count|total|indexed|listed|matched|rows|visible\w*)\b[^{}]*\}`;
  // Templates: a counted expression next to "of" or "/" and another expression. Literal text: digits either side.
  const template = new RegExp(`${count}\\s*(?:of|/)\\s*\\$\\{|(?:\\bof|/)\\s*${count}`), digits = /\d\s*(?:\bof|\/)\s*\d/;
  const literals = (line: string) => [...line.matchAll(/(['"`])((?:\\.|(?!\1).)*?)\1/g)].map(m => m[2]!);
  const bad = (line: string) => !/^\s*(?:\/\/|\*|\/\*)/.test(line) && (template.test(line) || literals(line).some(s => digits.test(s)));
  const offenders = walk(path.join(import.meta.dir, '..', 'src')).flatMap(file => fs.readFileSync(file, 'utf8').split('\n').flatMap((line, i) => bad(line) ? [`${path.basename(file)}:${i + 1}`] : []));
  expect(offenders).toEqual([]);
  for (const line of ['text: `${num(shown)} of ${num(total)}`', 'text: `${a.visible} / ${a.total}`', 'text: `of ${n(a.total)} in vault`', "text: '1,200 of 1,500'", 'x = `${found.length.toLocaleString()} of ${total.toLocaleString()} connections`']) expect(bad(line)).toBe(true);
  for (const line of ['p = `${directory}/${name}.bin`', 'l = `${part} of ${g.key}`', 't = `${plural(shown, "note")} shown`', 't = `${n(hidden)} hidden`', 'const y = 3 / 2;', "// '16 of 20' in a comment"]) expect(bad(line)).toBe(false);
});
