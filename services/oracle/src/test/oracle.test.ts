import { dealOracleKeys, evaluateWithKey, oprfInput, reconstruct, scalarFromBytes, scalarToBytes, subjectTag, toHex } from '@mulenet/crypto';
import { createOprfClient } from '@mulenet/sdk/oprf-client';
import { generateSigningKey, signRequest } from '@mulenet/service-kit';
import { afterEach, describe, expect, it } from 'vitest';
import { buildOracle } from '../server.js';

const ACCOUNT = 'acct:v1:IN:HDFC0001234:50100123456789';
const bank = generateSigningKey('bank-a');
const keys = dealOracleKeys(2, 3);
const running: { close(): Promise<unknown> }[] = [];

const start = async (opts: { dailyQuota?: number; badShare?: number; skip?: number[] } = {}) => {
  const members = [];
  const apps = [];
  for (const share of keys.shares) {
    const key = opts.badShare === share.index ? { ...dealOracleKeys(2, 3).shares[share.index - 1], index: share.index } : share;
    const { app, db } = buildOracle({
      key,
      groupPublicKey: keys.groupPublicKey,
      threshold: 2,
      institutions: new Map([[bank.id, bank.publicKey]]),
      dailyQuota: opts.dailyQuota,
      logger: false,
    });
    const url = opts.skip?.includes(share.index) ? 'http://127.0.0.1:9' : await app.listen({ host: '127.0.0.1', port: 0 });
    running.push(app);
    apps.push({ app, db, url });
    members.push({ index: share.index, url, publicShare: toHex(share.publicKey), signingPublicKey: '00'.repeat(32) });
  }
  const client = createOprfClient({ oracles: { threshold: 2, groupPublicKey: toHex(keys.groupPublicKey), members }, signingKey: bank });
  return { client, apps };
};

const expectedTag = () => {
  const k = reconstruct(keys.shares.map((s) => ({ index: s.index, value: scalarFromBytes(s.secretKey) })).slice(0, 2));
  return toHex(subjectTag(evaluateWithKey(scalarToBytes(k), oprfInput(ACCOUNT))));
};

afterEach(async () => {
  await Promise.all(running.splice(0).map((a) => a.close()));
});

describe('oracle service + client', () => {
  it('derives T from 2 of 3 oracles, equal to single-key evaluation, in under 150 ms', async () => {
    const { client } = await start();
    await client.tag(ACCOUNT); // warm-up
    const t0 = performance.now();
    const t = await client.tag(ACCOUNT);
    const ms = performance.now() - t0;
    expect(toHex(t)).toBe(expectedTag());
    expect(ms).toBeLessThan(150);
  });

  it('still works with one oracle down', async () => {
    const { client } = await start({ skip: [2] });
    expect(toHex(await client.tag(ACCOUNT))).toBe(expectedTag());
  });

  it('detects an oracle answering with the wrong share and uses the other two', async () => {
    const { client } = await start({ badShare: 3 });
    expect(toHex(await client.tag(ACCOUNT))).toBe(expectedTag());
  });

  it('fails when two oracles are unavailable', async () => {
    const { client } = await start({ skip: [1, 3] });
    await expect(client.tag(ACCOUNT)).rejects.toThrow('only 1 of 3');
  });

  it('evaluates batches of 1 and 64 with one batched proof', async () => {
    const { client } = await start();
    const ids = Array.from({ length: 64 }, (_, i) => `vpa:v1:user${i}@okaxis`);
    const tags = await client.tags(ids);
    expect(new Set(tags.map(toHex)).size).toBe(64);
    expect(toHex((await client.tags([ids[5]]))[0])).toBe(toHex(tags[5]));
  });

  it('enforces the daily quota with 429', async () => {
    const { client } = await start({ dailyQuota: 3 });
    await client.tags(['vpa:v1:a1@okaxis', 'vpa:v1:a2@okaxis']);
    await expect(client.tags(['vpa:v1:a3@okaxis', 'vpa:v1:a4@okaxis'])).rejects.toThrow('only 0 of 3');
  });

  it('rejects unsigned and replayed requests', async () => {
    const { apps } = await start();
    const body = JSON.stringify({ blinded: ['00'.repeat(32)] });
    const unsigned = await fetch(`${apps[0].url}/v1/evaluate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
    expect(unsigned.status).toBe(401);
    const h = signRequest(bank, 'POST', '/v1/evaluate', new TextEncoder().encode(body));
    const first = await fetch(`${apps[0].url}/v1/evaluate`, { method: 'POST', headers: { 'content-type': 'application/json', ...h }, body });
    expect(first.status).not.toBe(401);
    const replay = await fetch(`${apps[0].url}/v1/evaluate`, { method: 'POST', headers: { 'content-type': 'application/json', ...h }, body });
    expect(replay.status).toBe(401);
  });

  it('rejects a point that is not a valid ristretto255 encoding', async () => {
    const { apps } = await start();
    const body = JSON.stringify({ blinded: ['ff'.repeat(32)] });
    const h = signRequest(bank, 'POST', '/v1/evaluate', new TextEncoder().encode(body));
    const r = await fetch(`${apps[0].url}/v1/evaluate`, { method: 'POST', headers: { 'content-type': 'application/json', ...h }, body });
    expect(r.status).toBe(400);
  });

  it('stores counts only: no blinded point or tag in the database', async () => {
    const { client, apps } = await start();
    const t = await client.tag(ACCOUNT);
    for (const { db } of apps) {
      const dump = JSON.stringify([db.prepare('select * from quota').all(), db.prepare('select * from audit').all()]);
      expect(dump).not.toContain(toHex(t));
      expect(dump).not.toMatch(/[0-9a-f]{64}/);
      expect(dump).toContain('bank-a');
    }
  });

  it('publishes its public share and suite', async () => {
    const { apps } = await start();
    const r = await (await fetch(`${apps[1].url}/v1/public`)).json();
    expect(r).toMatchObject({ index: 2, publicShare: toHex(keys.shares[1].publicKey), suite: 'ristretto255-SHA512' });
  });
});
