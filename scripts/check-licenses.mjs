import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const root = process.cwd(), seen = new Set(), receipts = [], notice = [];
const allowed = /^(MIT|ISC|BSD-2-Clause|BSD-3-Clause|0BSD|Apache-2\.0|Unlicense|CC0-1\.0|BlueOak-1\.0\.0|Python-2\.0|Zlib)$/;
function packageRoot(name, from) {
  const req = createRequire(path.join(from, 'package.json'));
  let entry; try { entry = req.resolve(`${name}/package.json`); } catch { entry = req.resolve(name); }
  let dir = path.dirname(entry);
  while (dir !== path.dirname(dir)) { if (fs.existsSync(path.join(dir, 'package.json')) && JSON.parse(fs.readFileSync(path.join(dir, 'package.json'))).name === name) return dir; dir = path.dirname(dir); }
  throw new Error(`Package not found: ${name}`);
}
function visit(name, from) {
  if (/cosmograph|cosmos/i.test(name)) throw new Error(`Excluded nonpermissive renderer: ${name}`);
  const dir = packageRoot(name, from); if (seen.has(dir)) return; seen.add(dir);
  const p = JSON.parse(fs.readFileSync(path.join(dir, 'package.json')));
  const expression = typeof p.license === 'string' ? p.license : '';
  // Runtime tree has simple permissive expressions. Refuse every unrecognized expression rather than infer.
  if (!allowed.test(expression)) throw new Error(`Unreviewed runtime license ${p.name}: ${expression}`);
  const files = fs.readdirSync(dir).filter(f => /^(licen[sc]e|copying)(\.|$)/i.test(f));
  if (!files.length) throw new Error(`Missing LICENSE file: ${p.name}`);
  const text = files.map(f => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n');
  const permissiveText = /permission is hereby granted|redistribution and use in source and binary|permission to use, copy, modify|apache license/i.test(text);
  if (!permissiveText || /CC-BY-NC|noncommercial|non-commercial|GNU GENERAL PUBLIC LICENSE|GNU LESSER GENERAL/i.test(text)) throw new Error(`Review actual license text: ${p.name}`);
  receipts.push({ name: p.name, version: p.version, license: expression, files });
  notice.push(`===== ${p.name}@${p.version} (${expression}) =====\n${text}`);
  for (const dep of Object.keys({ ...p.dependencies, ...p.peerDependencies })) visit(dep, dir);
}
const p = JSON.parse(fs.readFileSync('package.json'));
for (const name of Object.keys(p.dependencies)) visit(name, root);
fs.writeFileSync('THIRD_PARTY_NOTICES.txt', notice.join('\n\n'));
fs.mkdirSync('.workspace/evidence', { recursive: true });
fs.writeFileSync('.workspace/evidence/runtime-licenses.json', JSON.stringify(receipts, null, 2));
console.log(`PASS: ${receipts.length} runtime packages; each installed LICENSE inspected; no nonpermissive runtime dependencies.`);
