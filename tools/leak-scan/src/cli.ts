// SPDX-License-Identifier: Apache-2.0
// npx tsx tools/leak-scan/src/cli.ts [network] [--out dir] — exit 1 on any finding.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { loadRegistry } from './registry.js';
import { sarif, scan, walk, type AllowEntry } from './scan.js';

const root = process.env.MULENET_ROOT ?? resolve(import.meta.dirname, '../../..');
const network = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'undeployed';
const outIdx = process.argv.indexOf('--out');
const out = resolve(outIdx > 0 ? process.argv[outIdx + 1] : join(root, 'test-artifacts/leak-scan'));

const secrets = loadRegistry(root, network);
if (secrets.length === 0) {
  console.error('no secrets registered: run keygen first');
  process.exit(2);
}
// Targets: everything services write (.data: databases and logs) and the built console bundle.
const targets = [join(root, '.data'), join(root, 'apps/console/.next/static')].filter(existsSync);
const files = targets.flatMap((t) => walk(t));
const allowPath = join(root, 'tools/leak-scan/allowlist.json');
const allow: AllowEntry[] = existsSync(allowPath) ? JSON.parse(readFileSync(allowPath, 'utf8')) : [];

const r = scan(secrets, files, allow);
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'leak-scan.sarif'), JSON.stringify(sarif(r.findings), null, 2));
const md = [
  `# Leak scan (${network})`,
  '',
  `${r.secrets} secrets × encodings = ${r.needles} needles, searched in ${r.files} files (${(r.bytes / 1e6).toFixed(1)} MB).`,
  '',
  r.findings.length === 0 ? '**0 findings.**' : `**${r.findings.length} findings:**\n\n| secret | encoding | file | offset |\n|---|---|---|---|\n` + r.findings.map((f) => `| ${f.secret} | ${f.encoding} | ${f.file.replace(root + '/', '')} | ${f.offset} |`).join('\n'),
].join('\n');
writeFileSync(join(out, 'leak-scan.md'), md + '\n');
console.log(md);
process.exit(r.findings.length === 0 ? 0 : 1);
