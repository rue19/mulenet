// SPDX-License-Identifier: Apache-2.0
// Found by the nightly leak scan: raw identifiers survived in bank.db-wal after a job finished.
// These tests read the database files as raw bytes, the way the leak scanner does.
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openStore } from '../store.js';

const X = 'acct:v1:IN:HDFC0001234:50100123456789';
const rawFiles = (path: string) => [path, `${path}-wal`, `${path}-shm`].filter(existsSync).map((p) => readFileSync(p));
const contains = (bufs: Buffer[], s: string) =>
  bufs.some((b) => [Buffer.from(s), Buffer.from(Buffer.from(s).toString('hex')), Buffer.from(Buffer.from(s).toString('base64').replace(/=+$/, ''))].some((n) => b.includes(n)));

describe('bank-node store at rest', () => {
  it('a queued and finished job never leaves the identifier in the database or WAL files', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'bank-')), 'bank.db');
    const store = openStore(path);
    const { id } = store.createJob('flag', 'idem-00001', { identifier: X, typology: 1, caseRef: 'FRM-1' });
    expect(contains(rawFiles(path), X)).toBe(false); // while queued
    expect(store.jobRequest(store.job(id)!).identifier).toBe(X); // the worker can still read it
    store.finish(id, 'confirmed', { flagIndex: 0 });
    expect(contains(rawFiles(path), X)).toBe(false); // after it finished
  });

  it('a different key cannot read a queued identifier', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'bank-')), 'bank.db');
    const a = openStore(path, new Uint8Array(32).fill(1));
    const { id } = a.createJob('flag', 'idem-00002', { identifier: X, typology: 1, caseRef: 'FRM-1' });
    const b = openStore(path, new Uint8Array(32).fill(2));
    expect(() => b.jobRequest(b.job(id)!)).toThrow();
  });
});
