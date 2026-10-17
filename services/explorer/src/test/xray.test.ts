// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { expandQuery, search } from '../xray.js';

const doc = (source: string, s: string | Buffer) => ({ source, bytes: Buffer.isBuffer(s) ? s : Buffer.from(s) });

describe('privacy x-ray engine', () => {
  it('expands a query into its utf-8, hex-text, base64-text and sha256 forms, plus the canonical id', () => {
    const labels = expandQuery('HDFC0001234:50100123456789', 'acct:v1:IN:HDFC0001234:50100123456789').map((n) => n.label);
    expect(labels).toEqual(expect.arrayContaining(['input (utf-8)', 'input (hex text)', 'input (base64 text)', 'input (sha256)', 'mulenet-id/v1 (utf-8)', 'mulenet-id/v1 (sha256)']));
  });

  it('treats a hex query as raw bytes too', () => {
    expect(expandQuery('deadbeefcafe').map((n) => n.label)).toContain('input (raw bytes)');
  });

  it('finds a planted value in every encoding (no vacuous zeros)', () => {
    const id = 'vpa:v1:rahul.k@okaxis';
    const corpus = [
      doc('plain', `xx${id}yy`),
      doc('hex', `..${Buffer.from(id).toString('hex')}..`),
      doc('b64', `..${Buffer.from(id).toString('base64')}..`),
      doc('raw', Buffer.concat([Buffer.alloc(3), Buffer.from('deadbeefcafe', 'hex')])),
    ];
    expect(search(expandQuery(id), corpus).hits.map((h) => h.source).sort()).toEqual(['b64', 'hex', 'plain']);
    expect(search(expandQuery('deadbeefcafe'), corpus).hits.map((h) => h.source)).toEqual(['raw']);
  });

  it('reports 0 hits and the size of what it searched when nothing matches', () => {
    const r = search(expandQuery('acct:v1:IN:HDFC0001234:50100123456789'), [doc('tx', Buffer.alloc(1000, 7))]);
    expect(r.hits).toEqual([]);
    expect(r.searchedBytes).toBe(1000);
  });
});
