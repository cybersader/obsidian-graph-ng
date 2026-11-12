import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

export const root = path.resolve(import.meta.dirname, '..');
export function git(args, cwd = root) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}
export function sourceFiles(cwd = root) {
  return [...new Set(git(['ls-files', '-z', '--cached', '--others', '--exclude-standard'], cwd).split('\0').filter(Boolean))]
    .filter(p => fs.existsSync(path.join(cwd, p))).sort();
}
export function screenshotFiles(cwd = root) {
  const files = [];
  function walk(dir) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (entry.isFile()) files.push(path.relative(cwd, file));
      else throw new Error('Privacy scan refuses screenshot symlinks');
    }
  }
  walk(path.join(cwd, 'test-screenshots'));
  return files.sort();
}
export function readSource(file, cwd = root) {
  const full = path.join(cwd, file);
  if (!fs.lstatSync(full).isFile()) throw new Error('Scan refuses non-regular source files');
  return fs.readFileSync(full).toString('utf8');
}
export function privateTerms(text) {
  return text.split('\n').map(s => s.replace(/\r$/, '')).filter(s => s.length && !/^\s*#/.test(s));
}
export function containsPrivate(text, terms) {
  const folded = text.toLowerCase();
  return terms.some(term => folded.includes(term.toLowerCase()));
}
export function containsSecret(text) {
  return /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/.test(text)
    || /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/.test(text)
    || /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b/.test(text)
    || /\b(?:sk_live|rk_live)_[A-Za-z0-9]{20,}\b/.test(text)
    || /\b(?:api[_-]?key|access[_-]?token|client[_-]?secret|password)\s*[=:]\s*["'][A-Za-z0-9_+\/=.-]{24,}["']/i.test(text);
}
export function containsAttribution(text) {
  const provider = '(?:Claude|Anthropic|OpenAI|ChatGPT|GPT[- ]?\\d[^\\s,]*|Copilot|Gemini|\\bAI\\b)';
  return new RegExp('^\\s*(?:Co-Authored-By|Authored-By|Generated-By):[^\\n]*' + provider, 'im').test(text)
    || new RegExp('"(?:author|authors|contributors)"\\s*:\\s*(?:"[^"\\n]*' + provider + '|[\\[{][^\\]}]*' + provider + ')', 'i').test(text)
    || /^(?:copyright|author|contributor)[^\n]*(?:Anthropic|OpenAI|ChatGPT|Claude)/im.test(text);
}
export const installHooks = ['preinstall', 'install', 'postinstall'];
export function lifecycleHooks(pkg) {
  return Object.fromEntries(installHooks.filter(k => Object.hasOwn(pkg.scripts ?? {}, k)).map(k => [k, pkg.scripts[k]]));
}
