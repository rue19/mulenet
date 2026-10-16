// P0-3: the scanner must find every planted secret, of every shape, in every encoding, in every
// kind of output the system writes (logs, SQLite databases, JS bundles), and the CLI must exit
// non-zero on a hit. A scanner that always reports 0 fails this suite.
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { encodings, scan, walk, type Secret } from '../scan.js';

const SECRETS: Secret[] = [
  { name: 'identifier', value: 'acct:v1:IN:HDFC0001234:50100123456789' },
  { name: 'T', value: randomBytes(32) },
  { name: 'instSecret', value: randomBytes(32) },
  { name: 'walletSeed', value: randomBytes(32) },
  { name: 'BLOCKFROST_PROJECT_ID', value: `nightpreprod${randomBytes(12).toString('hex')}` },
];

const forms = (s: Secret): { encoding: string; text: string | Buffer }[] => {
  const raw = typeof s.value === 'string' ? Buffer.from(s.value) : Buffer.from(s.value);
  return [
    { encoding: typeof s.value === 'string' ? 'utf-8' : 'raw', text: raw },
    ...(typeof s.value === 'string' ? [] : [{ encoding: 'hex', text: raw.toString('hex') }, { encoding: 'HEX', text: raw.toString('hex').toUpperCase() }]),
    { encoding: 'base64', text: raw.toString('base64') },
    { encoding: 'base64url', text: raw.toString('base64url') },
  ];
};

// Plants each (secret, encoding) in its own log line, DB row and bundle string.
const plant = (dir: string, s: Secret, f: { encoding: string; text: string | Buffer }, i: number) => {
  const tag = `${s.name}-${f.encoding}-${i}`;
  writeFileSync(join(dir, `logs/${tag}.log`), Buffer.concat([Buffer.from(`{"level":30,"msg":"x","v":"`), Buffer.from(f.text), Buffer.from('"}\n')]));
  const db = new DatabaseSync(join(dir, `db/${tag}.db`));
  db.exec('create table t (id integer primary key, payload blob, note text)');
  db.prepare('insert into t (payload, note) values (?, ?)').run(Buffer.isBuffer(f.text) ? f.text : Buffer.from(f.text), 'row');
  db.close();
  writeFileSync(join(dir, `bundle/${tag}.js`), Buffer.concat([Buffer.from('(()=>{const k="'), Buffer.from(f.text), Buffer.from('";console.log(k)})();')]));
};

describe('leak-scanner self-test (planted secrets)', () => {
  it('finds every secret shape, in every encoding, in logs, SQLite databases and JS bundles', () => {
    const dir = mkdtempSync(join(tmpdir(), 'leak-self-'));
    for (const d of ['logs', 'db', 'bundle']) mkdirSync(join(dir, d));
    const planted: { secret: string; encoding: string; kind: string }[] = [];
    let i = 0;
    for (const s of SECRETS) {
      for (const f of forms(s)) {
        plant(dir, s, f, i++);
        for (const kind of ['logs', 'db', 'bundle']) planted.push({ secret: s.name, encoding: f.encoding, kind });
      }
    }
    const r = scan(SECRETS, walk(dir));
    for (const p of planted) {
      // Identical encodings are merged by the scanner (e.g. base64 == base64url when no +/ occur),
      // so a planted form counts as found if any needle of that secret matched in that file kind.
      const hit = r.findings.some((f) => f.secret === p.secret && f.file.includes(`/${p.kind}/`) && f.file.includes(`${p.secret}-${p.encoding}-`));
      expect(hit, `${p.secret} as ${p.encoding} in ${p.kind}`).toBe(true);
    }
  });

  it('every secret produces needles for each applicable encoding', () => {
    for (const s of SECRETS) expect(encodings(s).length).toBeGreaterThanOrEqual(typeof s.value === 'string' ? 2 : 4);
  });

  it('the CLI exits non-zero when a registered secret leaks into service output', () => {
    const root = mkdtempSync(join(tmpdir(), 'leak-cli-'));
    const secret = randomBytes(32).toString('hex');
    mkdirSync(join(root, 'infra/secrets/undeployed'), { recursive: true });
    writeFileSync(join(root, 'infra/secrets/undeployed/bank-a.json'), JSON.stringify({ id: 'bank-a', institutionSecret: secret }));
    mkdirSync(join(root, '.data/undeployed/logs'), { recursive: true });
    writeFileSync(join(root, '.data/undeployed/logs/bank-a.log'), `{"msg":"oops","secret":"${secret}"}\n`);
    let code = 0;
    try {
      execFileSync('npx', ['tsx', resolve(import.meta.dirname, '../cli.ts'), 'undeployed', '--out', join(root, 'out')], { env: { ...process.env, MULENET_ROOT: root }, stdio: 'pipe' });
    } catch (e) {
      code = (e as { status: number }).status;
    }
    expect(code).toBe(1);
  }, 60_000);

  it('the CLI exits 0 on clean output (and its live canary passes)', () => {
    const root = mkdtempSync(join(tmpdir(), 'leak-cli-clean-'));
    mkdirSync(join(root, 'infra/secrets/undeployed'), { recursive: true });
    writeFileSync(join(root, 'infra/secrets/undeployed/bank-a.json'), JSON.stringify({ id: 'bank-a', institutionSecret: randomBytes(32).toString('hex') }));
    mkdirSync(join(root, '.data/undeployed/logs'), { recursive: true });
    writeFileSync(join(root, '.data/undeployed/logs/bank-a.log'), '{"msg":"all good"}\n');
    expect(() =>
      execFileSync('npx', ['tsx', resolve(import.meta.dirname, '../cli.ts'), 'undeployed', '--out', join(root, 'out')], { env: { ...process.env, MULENET_ROOT: root }, stdio: 'pipe' }),
    ).not.toThrow();
  }, 60_000);
});
