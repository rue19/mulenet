// SPDX-License-Identifier: Apache-2.0
import { encodeRecord, openBucket, recordKeys, sealRecord, toHex, type FlagRecordBody } from '@mulenet/crypto';
import { createRelayClient } from '@mulenet/sdk/relay-client';
import { generateSigningKey, signRequest } from '@mulenet/service-kit';
import { createHash, randomBytes } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { buildRelay, merkleRoot } from '../server.js';

const bank = generateSigningKey('bank-a');
const members = new Map([[bank.id, bank.publicKey]]);
const T = new Uint8Array(randomBytes(32));
const body = (index: number): FlagRecordBody => {
  const ct = new Uint8Array(randomBytes(200));
  return { p: new Uint8Array(randomBytes(32)), epoch: 3, typology: 1, ctHash: new Uint8Array(createHash('sha256').update(ct).digest()), ct, index, flaggedAt: 1_800_000_000 };
};
const running: { close(): Promise<unknown> }[] = [];
afterEach(async () => {
  await Promise.all(running.splice(0).map((a) => a.close()));
});

const startRelay = async () => {
  const r = buildRelay({ members, logger: false });
  const url = await r.app.listen({ host: '127.0.0.1', port: 0 });
  running.push(r.app);
  return { ...r, url };
};

// A tag whose bucket differs from T's, for the same-bucket and cross-bucket tests.
const tagInOtherBucket = () => {
  for (;;) {
    const t = new Uint8Array(randomBytes(32));
    if (recordKeys(t).bucket !== recordKeys(T).bucket) return t;
  }
};

describe('relay', () => {
  it('stores a record once and serves it from its bucket', async () => {
    const { url } = await startRelay();
    const c = createRelayClient({ urls: [url], signingKey: bank });
    const rec = sealRecord(T, body(7));
    const id = await c.put(rec);
    expect(await c.put(rec)).toBe(id); // 409 is treated as stored
    const { records } = await c.bucket(rec.bucket);
    expect(openBucket(T, records).map((b) => b.index)).toEqual([7]);
  });

  it('returns every record in the bucket, not just the requester’s (k-anonymous fetch)', async () => {
    const { url, db } = await startRelay();
    const c = createRelayClient({ urls: [url], signingKey: bank });
    const mine = sealRecord(T, body(1));
    await c.put(mine);
    // Another subject's record forced into the same bucket row, as a real collision would be.
    const other = sealRecord(tagInOtherBucket(), body(2));
    db.prepare('insert into records(id, bucket, data, at) values (?, ?, ?, ?)').run('ff'.repeat(32), mine.bucket, Buffer.from(encodeRecord(other)), 'x');
    const { records } = await c.bucket(mine.bucket);
    expect(records.length).toBe(2);
    expect(openBucket(T, records).length).toBe(1);
  });

  it('a forged record that decrypts nowhere is ignored by clients', async () => {
    const { url } = await startRelay();
    const c = createRelayClient({ urls: [url], signingKey: bank });
    const forged = { ...sealRecord(T, body(9)), body: new Uint8Array(randomBytes(80)) };
    await c.put(forged);
    expect(openBucket(T, (await c.bucket(forged.bucket)).records)).toEqual([]);
  });

  it('withholding: a record missing from the primary is still served via a mirror', async () => {
    const primary = await startRelay();
    const mirror = await startRelay();
    const rec = sealRecord(T, body(4));
    await createRelayClient({ urls: [mirror.url], signingKey: bank }).put(rec);
    const c = createRelayClient({ urls: [primary.url, mirror.url], signingKey: bank });
    const { records, reachable } = await c.bucket(rec.bucket);
    expect(reachable).toBe(2);
    expect(openBucket(T, records).map((b) => b.index)).toEqual([4]);
  });

  it('rejects malformed, oversized and bucket-mismatched records', async () => {
    const { url } = await startRelay();
    const put = (payload: object) => {
      const b = new TextEncoder().encode(JSON.stringify(payload));
      return fetch(`${url}/v1/records`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json', ...signRequest(bank, 'PUT', '/v1/records', b) },
        body: b,
      });
    };
    expect((await put({ record: Buffer.from('not cbor').toString('base64') })).status).toBe(400);
    expect((await put({ record: Buffer.alloc(1500).toString('base64') })).status).toBe(400);
    const bad = { ...sealRecord(T, body(1)), bucket: (recordKeys(T).bucket + 1) % 65_536 };
    expect((await put({ record: Buffer.from(encodeRecord(bad)).toString('base64') })).status).toBe(400);
  });

  it('requires a member signature to write and to read', async () => {
    const { url } = await startRelay();
    expect((await fetch(`${url}/v1/buckets/1`)).status).toBe(401);
    const outsider = createRelayClient({ urls: [url], signingKey: generateSigningKey('bank-x') });
    await expect(outsider.put(sealRecord(T, body(1)))).rejects.toThrow('401');
  });

  it('has no delete route (append-only)', async () => {
    const { url } = await startRelay();
    expect((await fetch(`${url}/v1/records`, { method: 'DELETE' })).status).toBe(404);
  });

  it('publishes a snapshot root over record ids that changes with every append', async () => {
    const { url } = await startRelay();
    const c = createRelayClient({ urls: [url], signingKey: bank });
    const s0 = (await (await fetch(`${url}/v1/snapshot`)).json()) as { count: number; root: string };
    await c.put(sealRecord(T, body(1)));
    const s1 = (await (await fetch(`${url}/v1/snapshot`)).json()) as { count: number; root: string };
    expect(s0.count).toBe(0);
    expect(s1.count).toBe(1);
    expect(s1.root).not.toBe(s0.root);
    expect(merkleRoot([]).toString('hex')).toBe('00'.repeat(32));
  });

  it('stores no plaintext: the DB holds no tag, pseudonym or recKey', async () => {
    const { url, db } = await startRelay();
    const b = body(5);
    await createRelayClient({ urls: [url], signingKey: bank }).put(sealRecord(T, b));
    const dump = Buffer.concat((db.prepare('select id, data from records').all() as { id: string; data: Uint8Array }[]).flatMap((r) => [Buffer.from(r.id), Buffer.from(r.data)]));
    for (const secret of [T, b.p, b.ctHash, b.ct, recordKeys(T).recKey]) {
      expect(dump.includes(Buffer.from(secret))).toBe(false);
      expect(dump.toString('latin1').includes(toHex(secret))).toBe(false);
    }
  });
});
