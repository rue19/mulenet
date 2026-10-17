// SPDX-License-Identifier: Apache-2.0
import { createHash } from 'node:crypto';
import { dealGuardianKeys, decryptObject, decryptionShare, fromHex, recordId, toHex, type EscalationDetails, type FlagRecord } from '@mulenet/crypto';
import { generateSigningKey, signRequest } from '@mulenet/service-kit';
import { describe, expect, it } from 'vitest';
import { World } from '../../../../contracts/src/test/world.js';
import { attest, check, flag, revoke, type FlowDeps } from '../flows.js';
import { buildBankNode } from '../server.js';
import { openStore } from '../store.js';
import { simChain } from './sim-chain.js';

const X = 'acct:v1:IN:HDFC0001234:50100123456789';
const guardians = dealGuardianKeys(2, 3);
const oprf = { tag: async (c: string | object) => new Uint8Array(createHash('sha256').update('test-oprf:' + String(c)).digest()) };

const consortium = (k: bigint = 2n) => {
  const world = new World({ k }).register('A', 'B', 'C', 'D');
  const records = new Map<string, FlagRecord>();
  const relay = {
    put: async (r: FlagRecord) => (records.set(toHex(recordId(r)), r), toHex(recordId(r))),
    bucket: async (b: number) => ({ records: [...records.values()].filter((r) => r.bucket === b), reachable: 1 }),
  };
  const node = (bank: string): FlowDeps => ({
    institutionId: `bank-${bank.toLowerCase()}`,
    institutionSecret: world.secretOf(bank),
    guardianGroupKey: guardians.groupPublicKey,
    store: openStore(),
    oprf,
    relay,
    chain: simChain(world, bank),
  });
  return { world, A: node('A'), B: node('B'), C: node('C'), D: node('D') };
};
const flagX = (n: FlowDeps) => flag(n, { identifier: X, typology: 1, caseRef: 'FRM-1' });

describe('attest flow', () => {
  it('attests k=2 from two other banks and stores an escalation the guardians can open', async () => {
    const { A, B, D } = consortium();
    await flagX(A);
    await flagX(B);
    const out = await attest(D, { identifier: X, typology: 1, caseRef: 'STR-9', k: 2 });
    expect((await check(D, { identifier: X })).attestation).toEqual({ k: 2, epoch: 0, typology: 1 });

    const esc = D.store.escalation(out.attKey)!;
    const ct = fromHex(esc.ct);
    const pubs = guardians.shares.map(({ index, publicKey }) => ({ index, publicKey }));
    const shares = [0, 1].map((i) => decryptionShare(guardians.shares[i], ct));
    const details = decryptObject<EscalationDetails>(ct, pubs, shares, 2);
    expect(details.identifier).toBe(X);
    expect(details.institutionId).toBe('bank-d');
    expect(details.leafIndices.sort()).toEqual([0, 1]);
  });

  it('excludes its own flag automatically and refuses without proving when fewer than k remain', async () => {
    const { A, D } = consortium();
    await flagX(A);
    await flagX(D);
    const before = (D.chain as ReturnType<typeof simChain>).calls.length;
    await expect(attest(D, { identifier: X, typology: 1, caseRef: 'x', k: 2 })).rejects.toMatchObject({ code: 'insufficient' });
    expect((D.chain as ReturnType<typeof simChain>).calls.length).toBe(before);
  });

  it('demo hooks reach the on-chain refusals: duplicate slot → dup, own flag → self excluded', async () => {
    const { A, B, C, D } = consortium(3n);
    await flagX(A);
    await flagX(B);
    await flagX(C);
    await expect(attest(D, { identifier: X, typology: 1, caseRef: 'x', k: 3, demoHook: 'duplicate-slot' })).rejects.toMatchObject({
      code: 'duplicate-pseudonym',
    });
    await expect(attest(C, { identifier: X, typology: 1, caseRef: 'x', k: 3, demoHook: 'include-self' })).rejects.toMatchObject({
      code: 'self-excluded',
    });
  });

  it('a second attestation for the same subject, epoch and typology is refused', async () => {
    const { A, B, C, D } = consortium();
    await flagX(A);
    await flagX(B);
    await attest(D, { identifier: X, typology: 1, caseRef: 'x', k: 2 });
    await expect(attest(C, { identifier: X, typology: 1, caseRef: 'y', k: 2 })).rejects.toMatchObject({ code: 'already-attested' });
  });
});

describe('revoke flow', () => {
  it('revokes its own flag; checks drop and a k=2 attestation becomes impossible', async () => {
    const { A, B, D } = consortium();
    const a = await flagX(A);
    await flagX(B);
    expect((await check(D, { identifier: X })).distinctInstitutions).toBe(2);
    await revoke(A, { flagIndex: a.flagIndex, identifier: X });
    const r = await check(D, { identifier: X });
    expect(r.distinctInstitutions).toBe(1);
    expect(r.skipped.revoked).toBe(1);
    await expect(attest(D, { identifier: X, typology: 1, caseRef: 'x', k: 2 })).rejects.toMatchObject({ code: 'insufficient' });
  });

  it('refuses an identifier that does not reproduce the flag, and a second revocation', async () => {
    const { A } = consortium();
    const a = await flagX(A);
    await expect(revoke(A, { flagIndex: a.flagIndex, identifier: 'vpa:v1:other@okaxis' })).rejects.toMatchObject({ code: 'identifier-mismatch' });
    await revoke(A, { flagIndex: a.flagIndex, identifier: X });
    await expect(revoke(A, { flagIndex: a.flagIndex, identifier: X })).rejects.toMatchObject({ code: 'already-revoked' });
  });

  it('cannot revoke another bank’s flag (not in its own flag ledger)', async () => {
    const { A, B } = consortium();
    const a = await flagX(A);
    await expect(revoke(B, { flagIndex: a.flagIndex, identifier: X })).rejects.toMatchObject({ code: 'not-found' });
  });
});

describe('bank-node API access', () => {
  it('the regulator key can fetch escalations but cannot flag, check or attest', async () => {
    const { A, B, D } = consortium();
    await flagX(A);
    await flagX(B);
    const out = await attest(D, { identifier: X, typology: 1, caseRef: 'STR-9', k: 2 });
    const bank = generateSigningKey('bank-d');
    const regulator = generateSigningKey('regulator');
    const { app } = buildBankNode({ deps: D, clients: new Map([[bank.id, bank.publicKey]]), regulator: { id: regulator.id, publicKey: regulator.publicKey }, logger: false });
    const req = (key: typeof bank, method: 'GET' | 'POST', url: string, payload?: object) => {
      const body = payload ? Buffer.from(JSON.stringify(payload)) : undefined;
      return app.inject({ method, url, headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...signRequest(key, method, url, body) }, payload: body });
    };
    expect((await req(regulator, 'GET', `/v1/escalations/${out.attKey}`)).statusCode).toBe(200);
    expect((await req(regulator, 'POST', '/v1/check', { identifier: X })).statusCode).toBe(403);
    expect((await req(regulator, 'POST', '/v1/flags', { identifier: X, typology: 1, caseRef: 'r', idempotencyKey: 'abcdefgh1' })).statusCode).toBe(403);
    expect((await req(bank, 'POST', '/v1/check', { identifier: X })).statusCode).toBe(200);
    await app.close();
  });
});
