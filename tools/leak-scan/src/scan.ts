// SPDX-License-Identifier: Apache-2.0
// Leak scanner (§8.1): every registered secret, in every encoding it could leak in, searched
// across every file the system writes. Any hit fails CI. The Privacy X-ray in the explorer is the
// public-surface subset of the same idea.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

export type Secret = { name: string; value: Uint8Array | string };
export type Encoded = { secret: string; encoding: string; bytes: Buffer };
export type Finding = { secret: string; encoding: string; file: string; offset: number };

const MIN_LEN = 8; // shorter needles would match by coincidence

export const encodings = (s: Secret): Encoded[] => {
  const raw = typeof s.value === 'string' ? Buffer.from(s.value, 'utf8') : Buffer.from(s.value);
  const out: Encoded[] = [];
  const add = (encoding: string, bytes: Buffer) => {
    if (bytes.length >= MIN_LEN && !out.some((e) => e.bytes.equals(bytes))) out.push({ secret: s.name, encoding, bytes });
  };
  add(typeof s.value === 'string' ? 'utf-8' : 'raw', raw);
  if (typeof s.value !== 'string') {
    add('hex', Buffer.from(raw.toString('hex')));
    add('HEX', Buffer.from(raw.toString('hex').toUpperCase()));
  }
  add('base64', Buffer.from(raw.toString('base64').replace(/=+$/, '')));
  add('base64url', Buffer.from(raw.toString('base64url')));
  return out;
};

export const walk = (root: string, skip: (rel: string) => boolean = () => false): string[] => {
  const out: string[] = [];
  const rec = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (skip(relative(root, p))) continue;
      const st = statSync(p);
      if (st.isDirectory()) rec(p);
      else if (st.isFile() && st.size < 256 * 1024 * 1024) out.push(p);
    }
  };
  rec(root);
  return out;
};

export type AllowEntry = { secret: string; file: string; reason: string };

export const scan = (secrets: Secret[], files: string[], allow: AllowEntry[] = []) => {
  const needles = secrets.flatMap(encodings);
  const findings: Finding[] = [];
  let bytes = 0;
  for (const file of files) {
    const data = readFileSync(file);
    bytes += data.length;
    for (const n of needles) {
      const at = data.indexOf(n.bytes);
      if (at < 0) continue;
      if (allow.some((a) => a.secret === n.secret && file.includes(a.file))) continue;
      findings.push({ secret: n.secret, encoding: n.encoding, file, offset: at });
    }
  }
  return { findings, files: files.length, bytes, needles: needles.length, secrets: secrets.length };
};

export const sarif = (findings: Finding[]) => ({
  version: '2.1.0',
  $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
  runs: [
    {
      tool: { driver: { name: 'mulenet-leak-scan', rules: [{ id: 'secret-leak', shortDescription: { text: 'A registered secret appears in an output' } }] } },
      results: findings.map((f) => ({
        ruleId: 'secret-leak',
        level: 'error',
        message: { text: `${f.secret} (${f.encoding}) found at byte ${f.offset}` },
        locations: [{ physicalLocation: { artifactLocation: { uri: f.file } } }],
      })),
    },
  ],
});
