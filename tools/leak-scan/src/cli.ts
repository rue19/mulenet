// SPDX-License-Identifier: Apache-2.0
// npx tsx tools/leak-scan/src/cli.ts [network] [--out dir] — exit 1 on any finding.
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { loadRegistry } from './registry.js';
import { encodings, sarif, scan, walk, type AllowEntry } from './scan.js';

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

// Live self-test: plant a fresh canary secret, in every encoding, in a file among the targets.
// The run fails unless the scanner finds all of them, so "0 findings" can never mean "not looking".
mkdirSync(out, { recursive: true });
const canaryDir = join(out, 'canary');
mkdirSync(canaryDir, { recursive: true });
const canary = randomBytes(32);
const canaryFile = join(canaryDir, 'planted.log');
writeFileSync(
  canaryFile,
  [`raw:`, canary.toString('hex'), canary.toString('hex').toUpperCase(), canary.toString('base64'), canary.toString('base64url')].join('\n'),
);
writeFileSync(join(canaryDir, 'planted.bin'), Buffer.concat([Buffer.from('raw:'), canary]));

const all = scan([...secrets, { name: '__canary__', value: canary }], [...files, canaryFile, join(canaryDir, 'planted.bin')], allow);
rmSync(canaryDir, { recursive: true, force: true });
const canaryHits = new Set(all.findings.filter((f) => f.secret === '__canary__').map((f) => f.encoding));
// Every distinct needle generated for the canary must be found (identical encodings are merged).
const expected = encodings({ name: '__canary__', value: canary }).map((e) => e.encoding);
const selfTestOk = expected.every((e) => canaryHits.has(e));
const r = { ...all, findings: all.findings.filter((f) => f.secret !== '__canary__'), secrets: secrets.length };
if (!selfTestOk) {
  console.error(`leak-scan SELF-TEST FAILED: expected [${expected.join(', ')}], found [${[...canaryHits].join(', ')}]`);
  process.exit(3);
}
writeFileSync(join(out, 'leak-scan.sarif'), JSON.stringify(sarif(r.findings), null, 2));
const md = [
  `# Leak scan (${network})`,
  '',
  `${r.secrets} secrets × encodings, searched in ${r.files - 2} files (${(r.bytes / 1e6).toFixed(1)} MB).`,
  '',
  `Self-test: a freshly planted canary was found in every encoding (${expected.join(', ')}).`,
  '',
  r.findings.length === 0 ? '**0 findings.**' : `**${r.findings.length} findings:**\n\n| secret | encoding | file | offset |\n|---|---|---|---|\n` + r.findings.map((f) => `| ${f.secret} | ${f.encoding} | ${f.file.replace(root + '/', '')} | ${f.offset} |`).join('\n'),
].join('\n');
writeFileSync(join(out, 'leak-scan.md'), md + '\n');
console.log(md);
process.exit(r.findings.length === 0 ? 0 : 1);
