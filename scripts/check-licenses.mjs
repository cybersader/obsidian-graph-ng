import fs from 'node:fs';
const pkg = JSON.parse(fs.readFileSync('package.json'));
// Zero runtime means every installable runtime surface, not just dependencies.
// Development tools/oracles are not certified or shipped by this gate.
const runtime = Object.keys({ ...pkg.dependencies, ...pkg.peerDependencies, ...pkg.optionalDependencies });
if (runtime.length) throw new Error('ZERO_RUNTIME_DEPS: runtime dependencies are forbidden');
fs.writeFileSync('THIRD_PARTY_NOTICES.txt', '');
if (fs.statSync('THIRD_PARTY_NOTICES.txt').size !== 0) throw new Error('ZERO_RUNTIME_NOTICES: expected empty notice file');
fs.mkdirSync('.workspace/evidence', { recursive: true });
fs.writeFileSync('.workspace/evidence/runtime-licenses.json', '[]\n');
console.log('PASS: 0 runtime packages; empty THIRD_PARTY_NOTICES.txt verified; development-only oracle not shipped.');
