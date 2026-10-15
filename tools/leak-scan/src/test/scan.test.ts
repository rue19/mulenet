import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { encodings, scan, walk } from '../scan.js';

const secret = { name: 'bank-a.institutionSecret', value: Buffer.from('7f'.repeat(32), 'hex') };
const fixture = (files: Record<string, string | Buffer>) => {
  const dir = mkdtempSync(join(tmpdir(), 'leak-'));
  for (const [n, c] of Object.entries(files)) writeFileSync(join(dir, n), c);
  return dir;
};

describe('leak scanner', () => {
  it('self-test: a planted secret is found in every encoding (no scanner that always says 0)', () => {
    const raw = Buffer.from(secret.value);
    const dir = fixture({
      'raw.bin': Buffer.concat([Buffer.alloc(10), raw]),
      'hex.log': `level=info secret=${raw.toString('hex')}`,
      'HEX.log': `X ${raw.toString('hex').toUpperCase()} X`,
      'b64.json': JSON.stringify({ v: raw.toString('base64') }),
      'b64url.txt': raw.toString('base64url'),
      'clean.log': 'nothing to see here',
    });
    const r = scan([secret], walk(dir));
    expect(r.findings.map((f) => f.file.split('/').pop()).sort()).toEqual(['HEX.log', 'b64.json', 'b64url.txt', 'hex.log', 'raw.bin']);
  });

  it('finds text secrets such as identifiers and tokens', () => {
    const dir = fixture({ 'app.log': 'GET /x?project_id=nightpreprodABC123xyz' });
    expect(scan([{ name: 'BLOCKFROST_PROJECT_ID', value: 'nightpreprodABC123xyz' }], walk(dir)).findings).toHaveLength(1);
  });

  it('honours the allow-list', () => {
    const dir = fixture({ 'public.json': Buffer.from(secret.value).toString('hex') });
    expect(scan([secret], walk(dir), [{ secret: secret.name, file: 'public.json', reason: 'test' }]).findings).toEqual([]);
  });

  it('skips needles too short to be meaningful', () => {
    expect(encodings({ name: 'short', value: 'abc' })).toEqual([]);
  });
});
