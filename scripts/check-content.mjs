import fs from 'node:fs';
import path from 'node:path';
import { root, git, sourceFiles, screenshotFiles, readSource, privateTerms, containsPrivate, containsSecret, containsAttribution } from './gate-lib.mjs';

const modes = process.argv.slice(2).filter(a => !a.startsWith('--'));
if (modes.length !== 1 || !['secrets', 'attribution', 'privacy'].includes(modes[0])) throw new Error('Choose secrets, attribution or privacy; optional --history scans all reachable history');
const mode = modes[0], history = process.argv.includes('--history');
let terms = [];
if (mode === 'privacy') {
  const file = process.env.PRIVATE_TERMS_FILE ?? path.resolve(root, git(['rev-parse', '--git-common-dir']).trim(), 'info/private-terms');
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) throw new Error('PRIVATE_TERMS_REQUIRED: create the local git info/private-terms file; see CONTRIBUTING.md');
  terms = privateTerms(fs.readFileSync(file, 'utf8'));
  if (!terms.length && process.env.CI !== 'true') throw new Error('PRIVATE_TERMS_EMPTY: configure at least one real local private term');
  if (!terms.length) console.log('NOTICE: CI has no private terms. This is NOT owner privacy clearance.');
}
const predicate = mode === 'secrets' ? containsSecret : mode === 'attribution' ? containsAttribution : text => containsPrivate(text, terms);
let checks = 0;
function scan(text, label) {
  checks++;
  if (predicate(text)) throw new Error(`${mode.toUpperCase()}_BLOCKED: ${label}; inspect locally (matched text is never printed)`);
}
for (const file of sourceFiles()) {
  scan(file, 'source filename');
  scan(readSource(file), file);
}
// Ignored screenshots are scanned as bytes AND filenames; semantic visual inspection is still required.
if (mode === 'privacy' || mode === 'secrets') for (const file of screenshotFiles()) {
  scan(file, 'screenshot filename');
  scan(readSource(file), 'screenshot bytes');
}
// Inspect staged bytes too, so an unstaged cleanup cannot hide an unsafe staged version.
for (const file of git(['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z']).split('\0').filter(Boolean)) {
  scan(file, 'staged filename');
  scan(git(['show', `:${file}`]), 'staged content');
}
const range = process.env.GATE_COMMIT_RANGE;
if (range) git(['rev-list', range]); // Invalid/shallow ranges fail closed.
const commits = git(['rev-list', ...(history || !range ? ['--all'] : [range])]).trim().split('\n').filter(Boolean);
const seen = new Set();
for (const commit of commits) {
  if (mode === 'attribution' || history) scan(git(['show', '-s', '--format=%B%nAuthor: %an <%ae>%nCommitter: %cn <%ce>', commit]), 'commit metadata');
  if (mode === 'attribution') {
    const identity = git(['show', '-s', '--format=%an%n%ae%n%cn%n%ce', commit]);
    if (/\b(?:claude|anthropic|openai|chatgpt|copilot|gemini)\b/i.test(identity)) throw new Error('ATTRIBUTION_BLOCKED: commit identity');
  }
  if (!history) continue;
  for (const row of git(['ls-tree', '-rz', '--full-tree', commit]).split('\0').filter(Boolean)) {
    const tab = row.indexOf('\t'), name = row.slice(tab + 1), [, type, oid] = row.slice(0, tab).split(' ');
    scan(name, 'historical filename');
    if (type === 'blob' && !seen.has(oid)) { seen.add(oid); scan(git(['cat-file', 'blob', oid]), 'historical blob'); }
  }
}
console.log(`PASS ${mode}: ${checks} checks; ${commits.length} commits${history ? '; all reachable history and blob contents' : mode === 'attribution' ? '; commit messages and identities' : '; current/index files'}${range && !history ? '; explicit commit range' : ''}.`);
