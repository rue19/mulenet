// Phase 5 integration test: the 3-minute demo script as code (§5.5), on a fresh short-epoch
// `demo` deployment (60 s epochs, TTL 1) with every service running as its own process.
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { combineAndDecrypt, decodeCbor, fromHex, openRecord, recordKeys, toHex, decodeRecord, type CaseDetails, type EscalationDetails } from '@mulenet/crypto';
import { repoRoot } from '@mulenet/sdk/config';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bankClient, guardianOperator, regulatorClient } from './client.js';
import { startStack, type Stack } from './stack.js';

const NET = 'undeployed';
process.env.MULENET_DEPLOYMENT = 'demo';
const X = `acct:v1:IN:ICIC0000104:${(BigInt('0x' + randomBytes(7).toString('hex')) % 10n ** 12n).toString().padStart(12, '3')}`;

let stack: Stack;
beforeAll(async () => {
  // Fresh demo deployment: banks A–D registered, bank E deliberately not.
  execFileSync('npx', ['tsx', 'scripts/bootstrap.ts', NET, '--epoch', '60', '--ttl', '1', '--k', '2', '--skip', 'bank-e'], {
    cwd: resolve(repoRoot(), 'packages/sdk'),
    env: { ...process.env, MN_PROOF_SERVER: process.env.MN_PROOF_SERVER ?? 'http://127.0.0.1:6301' },
    stdio: 'ignore',
  });
  stack = await startStack(NET, { guardians: true, keeper: 'manual', demoHooks: true });
});
afterAll(async () => {
  await stack?.stop();
});

describe('demo script', () => {
  const [A, B, C, D, E] = ['bank-a', 'bank-b', 'bank-c', 'bank-d', 'bank-e'].map((b) => bankClient(NET, b));
  const regulator = regulatorClient(NET);
  const g1 = guardianOperator(NET, 1);
  const g3 = guardianOperator(NET, 3);
  const state: { attKey?: string } = {};

  it('1. A, B and C flag X', async () => {
    for (const bank of [A, B, C]) expect((await bank.flag(X)).state).toBe('confirmed');
  });

  it('2. A flags X again → refused (duplicate flag)', async () => {
    const r = await A.flag(X);
    expect(r.error?.code).toBe('duplicate-flag');
  });

  it('3. unregistered bank E flags → refused (not a member), no transaction', async () => {
    const r = await E.flag(X);
    expect(r.error?.code).toBe('not-a-member');
    expect(r.txId).toBeUndefined();
  });

  it('4. D attests k=3 with a duplicated slot → refused on-chain (dup)', async () => {
    const r = await D.attest(X, 3, 'duplicate-slot');
    expect(r.error?.code).toBe('duplicate-pseudonym');
  });

  it('5. C attests including its own flag → refused on-chain (self excluded)', async () => {
    const r = await C.attest(X, 3, 'include-self');
    expect(r.error?.code).toBe('self-excluded');
  });

  it('6. D attests k=3 → recorded', async () => {
    const r = await D.attest(X, 3);
    expect(r.state).toBe('confirmed');
    state.attKey = r.attKey;
  });

  it('7. E checks X → sees the attestation (checks are free and need no membership tx)', async () => {
    expect((await E.check(X)).attestation).toMatchObject({ k: 3 });
  });

  it('8. B revokes → count drops to 2; a new k=3 attestation is refused before any proof', async () => {
    const revoked = await B.revokeLatest(X);
    expect(revoked.state).toBe('confirmed');
    expect((await E.check(X)).distinctInstitutions).toBe(2);
    const again = await D.attest(X, 3);
    expect(again.error?.code).toBe('insufficient');
    expect(again.txId).toBeUndefined();
  });

  it('9. warrant: one approval → quorum refusal; second approval → executed', async () => {
    const { body: p } = await g1.propose(4, state.attKey!);
    expect((await g1.approve(p.proposalId)).status).toBe(200);
    const early = await g1.execute(p.proposalId);
    expect(early.status).toBe(409);
    expect(early.body.reason).toBe('quorum');
    expect((await g3.approve(p.proposalId)).status).toBe(200);
    expect((await g1.execute(p.proposalId)).status).toBe(200);
  });

  it('10. guardians release shares under the warrant → regulator learns who flagged', async () => {
    const pubs = regulator.guardianPublicShares();
    const { body: esc } = await regulator.escalation('bank-d', state.attKey!);
    const r1 = await Promise.all([1, 2].map((g) => regulator.escalationShare(g, state.attKey!, esc.escalationCt)));
    const ct = fromHex(esc.escalationCt);
    const details = decodeCbor<EscalationDetails>(
      combineAndDecrypt(ct, pubs, r1.map((r) => ({ index: r.body.guardianIndex, share: fromHex(r.body.share), proof: fromHex(r.body.proof) })), 2),
    );
    expect(details.identifier).toBe(X);
    const T = new Uint8Array(details.tag);

    const { body: bucket } = await regulator.bucket(recordKeys(T).bucket);
    const mine = bucket.records.filter((b64) => {
      try {
        openRecord(T, decodeRecord(new Uint8Array(Buffer.from(b64, 'base64'))));
        return true;
      } catch {
        return false;
      }
    });
    const flaggers: string[] = [];
    for (const rec of mine) {
      // One record per request: guardians refuse the whole request if any record is not an
      // on-chain flag, and B's flag was revoked in step 8.
      const r2 = await Promise.all([1, 3].map((g) => regulator.detailShares(g, state.attKey!, toHex(T), [rec])));
      if (r2.some((r) => r.status !== 200)) continue;
      const body = openRecord(T, decodeRecord(new Uint8Array(Buffer.from(rec, 'base64'))));
      const shares = r2.map((r) => ({ index: r.body.guardianIndex, share: fromHex(r.body.shares[0].share), proof: fromHex(r.body.shares[0].proof) }));
      flaggers.push(decodeCbor<CaseDetails>(combineAndDecrypt(body.ct, pubs, shares, 2)).institutionId);
    }
    expect(flaggers.sort()).toEqual(['bank-a', 'bank-c']);
  });

  it('11. after two epoch rolls the flags expire: E sees 0 fresh', async () => {
    const deadline = Date.now() + 240_000;
    let r = await E.check(X);
    while (r.distinctInstitutions > 0 && Date.now() < deadline) {
      await g1.advanceEpoch();
      await new Promise((res) => setTimeout(res, 10_000));
      r = await E.check(X);
    }
    expect(r.distinctInstitutions).toBe(0);
    expect(r.skipped.expired).toBe(2);
  });
});
