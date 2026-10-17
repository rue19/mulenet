// SPDX-License-Identifier: Apache-2.0
import { createHash, randomBytes } from 'node:crypto';
import { dealGuardianKeys, hash, openBucket, openRecord, recordId, recordKeys, sealRecord, toHex, type FlagRecord } from '@mulenet/crypto';
import { describe, expect, it } from 'vitest';
import { World } from '../../../../contracts/src/test/world.js';
import { FlowError, canonicalise, check, flag, flushOutbox, type FlowDeps } from '../flows.js';
import { openStore } from '../store.js';
import { simChain } from './sim-chain.js';

const X = 'acct:v1:IN:HDFC0001234:50100123456789';
const Y = 'vpa:v1:someone.else@okaxis';
const guardians = dealGuardianKeys(2, 3);

// Deterministic stand-in for the threshold OPRF (tested on its own in services/oracle).
const oprf = { tag: async (c: string | object) => new Uint8Array(createHash('sha256').update('test-oprf:' + String(c)).digest()) };

const memoryRelay = () => {
  const records = new Map<string, FlagRecord>();
  let failPuts = 0;
  return {
    records,
    failNext: (n: number) => (failPuts = n),
    put: async (r: FlagRecord) => {
      if (failPuts > 0) {
        failPuts--;
        throw new Error('relay down');
      }
      records.set(toHex(recordId(r)), r);
      return toHex(recordId(r));
    },
    bucket: async (b: number) => ({ records: [...records.values()].filter((r) => r.bucket === b), reachable: 1 }),
  };
};

const consortium = (opts: { ttl?: bigint } = {}) => {
  const world = new World({ k: 2n, ttl: opts.ttl ?? 30n }).register('A', 'B', 'C', 'D');
  const relay = memoryRelay();
  const node = (bank: string): FlowDeps & { chain: ReturnType<typeof simChain> } => ({
    institutionId: `bank-${bank.toLowerCase()}`,
    institutionSecret: world.secretOf(bank),
    guardianGroupKey: guardians.groupPublicKey,
    store: openStore(),
    oprf,
    relay,
    chain: simChain(world, bank),
  });
  return { world, relay, A: node('A'), B: node('B'), C: node('C'), D: node('D') };
};

const flagX = (n: FlowDeps, id = X) => flag(n, { identifier: id, typology: 1, caseRef: 'FRM-1' });

describe('bank-node flows', () => {
  it('A and B flag X; C sees two distinct institutions', async () => {
    const { A, B, C } = consortium();
    const a = await flagX(A);
    const b = await flagX(B);
    expect([a.flagIndex, b.flagIndex]).toEqual([0, 1]);
    const r = await check(C, { identifier: X });
    expect(r.distinctInstitutions).toBe(2);
    expect(r.flags).toEqual([
      { epoch: 0, typology: 1, fresh: true },
      { epoch: 0, typology: 1, fresh: true },
    ]);
    expect(r.skipped).toEqual({ revoked: 0, expired: 0, notOnChain: 0 });
  });

  it('a second flag by A in the same epoch is refused before any proof', async () => {
    const { A } = consortium();
    await flagX(A);
    const before = A.chain.calls.length;
    await expect(flagX(A)).rejects.toMatchObject({ code: 'duplicate-flag' });
    expect(A.chain.calls.length).toBe(before);
  });

  it('an unregistered institution cannot flag and nothing reaches the relay', async () => {
    const { world, relay, A } = consortium();
    world.banks.set('Z', new Uint8Array(randomBytes(32)));
    const Z: FlowDeps = { ...A, institutionSecret: world.secretOf('Z'), store: openStore() };
    await expect(flagX(Z)).rejects.toBeInstanceOf(FlowError);
    expect(relay.records.size).toBe(0);
  });

  it('an unseen account checks as 0', async () => {
    const { A, C } = consortium();
    await flagX(A);
    expect((await check(C, { identifier: Y })).distinctInstitutions).toBe(0);
  });

  it('accepts loose identifier forms and canonicalises them identically', async () => {
    expect(canonicalise('hdfc0001234:5010 0123 4567 89')).toBe(X);
    expect(canonicalise(' Someone.Else@OkAxis ')).toBe(Y);
    expect(() => canonicalise('call me maybe')).toThrow(FlowError);
    const { A, C } = consortium();
    await flag(A, { identifier: 'HDFC0001234 50100123456789', typology: 1, caseRef: 'x' });
    expect((await check(C, { identifier: X })).distinctInstitutions).toBe(1);
  });

  it('ignores relay records whose leaf is not on chain (forged by the relay)', async () => {
    const { relay, A, C } = consortium();
    await flagX(A);
    const T = await oprf.tag(X);
    const ct = new Uint8Array(randomBytes(64));
    const forged = sealRecord(T, { p: new Uint8Array(randomBytes(32)), epoch: 0, typology: 1, ctHash: new Uint8Array(createHash('sha256').update(ct).digest()), ct, index: 50, flaggedAt: 1 });
    await relay.put(forged);
    const r = await check(C, { identifier: X });
    expect(r.distinctInstitutions).toBe(1);
    expect(r.skipped.notOnChain).toBe(1);
  });

  it('ignores a real record re-filed under a false index', async () => {
    const { relay, A, B, C } = consortium();
    await flagX(A);
    await flagX(B);
    const T = await oprf.tag(X);
    const [first] = [...relay.records.values()];
    const body = openRecord(T, first);
    relay.records.clear();
    await relay.put(sealRecord(T, { ...body, index: body.index === 0 ? 1 : 0 }));
    const r = await check(C, { identifier: X });
    expect(r.distinctInstitutions).toBe(0);
  });

  it('expired flags are reported but not counted', async () => {
    const { world, A, B, C } = consortium({ ttl: 1n });
    await flagX(A);
    world.advanceEpochs(2);
    await flagX(B);
    const r = await check(C, { identifier: X });
    expect(r.distinctInstitutions).toBe(1);
    expect(r.skipped.expired).toBe(1);
  });

  it('filters by typology', async () => {
    const { A, B, C } = consortium();
    await flagX(A);
    await flag(B, { identifier: X, typology: 2, caseRef: 'y' });
    expect((await check(C, { identifier: X, typology: 2 })).distinctInstitutions).toBe(1);
    expect((await check(C, { identifier: X })).distinctInstitutions).toBe(2);
  });

  it('keeps the relay record in the outbox until the relay accepts it', async () => {
    const { relay, A, C } = consortium();
    relay.failNext(1);
    await flagX(A);
    expect(A.store.outboxPending().length).toBe(1);
    expect((await check(C, { identifier: X })).distinctInstitutions).toBe(0);
    await flushOutbox(A);
    expect(A.store.outboxPending().length).toBe(0);
    expect((await check(C, { identifier: X })).distinctInstitutions).toBe(1);
  });

  it('reports an existing attestation', async () => {
    const { world, relay, A, B, C } = consortium();
    await flagX(A);
    await flagX(B);
    const T = await oprf.tag(X);
    // D attests directly on the simulated chain from the two published records.
    const slots = openBucket(T, (await relay.bucket(recordKeys(T).bucket)).records).map((b) => ({
      pseudonym: b.p,
      epoch: BigInt(b.epoch),
      ctHash: b.ctHash,
      path: world.state.flags.findPathForLeaf(hash.flagLeaf(T, b.p, BigInt(b.epoch), BigInt(b.typology), b.ctHash))!,
    }));
    world.asBank('D').call('attestCorroboration2', T, 1n, slots, world.institutionPath('D'), new Uint8Array(32));
    expect((await check(C, { identifier: X })).attestation).toEqual({ k: 2, epoch: 0, typology: 1 });
  });

  it('never stores the identifier or T in the bank database', async () => {
    const { A } = consortium();
    const { id } = A.store.createJob('flag', 'idem-0001', { identifier: X, typology: 1, caseRef: 'FRM-1' });
    const out = await flagX(A);
    A.store.finish(id, 'confirmed', out);
    const T = toHex(await oprf.tag(X));
    const dump = JSON.stringify(['jobs', 'flags', 'quota_slots', 'outbox'].map((t) => A.store.db.prepare(`select * from ${t}`).all()));
    expect(dump).not.toContain('50100123456789');
    expect(dump).not.toContain(T);
  });
});

describe('quota slots', () => {
  it('a bank node with a fresh database skips slots already used on-chain this epoch', async () => {
    const { A } = consortium();
    await flagX(A, 'vpa:v1:first@okaxis');
    await flagX(A, 'vpa:v1:second@okaxis');
    await flagX(A, 'vpa:v1:third@okaxis');
    // Same institution, brand-new local database (e.g. data directory recreated).
    const fresh = { ...A, store: openStore() };
    await expect(flagX(fresh, 'vpa:v1:fourth@okaxis')).resolves.toMatchObject({ flagIndex: 3 });
  });
});
