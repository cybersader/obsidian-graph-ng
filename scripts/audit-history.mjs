import { execFileSync } from 'node:child_process';
import { root } from './gate-lib.mjs';
for (const mode of ['secrets', 'attribution', 'privacy']) execFileSync(process.execPath, ['scripts/check-content.mjs', mode, '--history'], { cwd: root, stdio: 'inherit' });
console.log('PASS reachable-history audit. Ref names, unreachable objects, external assets and screenshot pixels still require separate owner review.');
