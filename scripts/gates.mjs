import { execFileSync } from 'node:child_process';
import { root } from './gate-lib.mjs';
const fast = process.argv.includes('--fast');
const commands = [
  ['scripts/check-content.mjs', 'secrets'],
  ['scripts/check-content.mjs', 'attribution'],
  ['scripts/check-content.mjs', 'privacy'],
  ['scripts/check-supply-chain.mjs'],
  ['scripts/check-licenses.mjs'],
  ...(!fast ? [['scripts/bundle-size.mjs']] : []),
];
for (const args of commands) execFileSync(process.execPath, args, { cwd: root, stdio: 'inherit' });
console.log(`PASS ${fast ? 'fast' : 'full'} gates (${commands.length} lanes). No tests or build implied.`);
