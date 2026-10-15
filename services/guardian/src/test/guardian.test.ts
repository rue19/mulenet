import { randomBytes } from 'node:crypto';
import { MuleNet } from '@mulenet/contract';
import {
  combineAndDecrypt,
  dealGuardianKeys,
  decodeCbor,
  encodeRecord,
  encryptObject,
  fromHex,
  openRecord,
  sealRecord,
  toHex,
  type CaseDetails,
  type EscalationDetails,
  type FlagRecord,
} from '@mulenet/crypto';
import { generateSigningKey, signRequest } from '@mulenet/service-kit';
import { describe, expect, it } from 'vitest';
import { KIND, World } from '../../../../contracts/src/test/world.js';
import { buildGuardian, type Governance } from '../server.js';

const pc = MuleNet.pureCircuits;
const guardianKeys = dealGuardianKeys(2, 3);
const pubs = guardianKeys.shares.map(({ index, publicKey }) => ({ index, publicKey }));
const regulator = generateSigningKey('regulator');
const operators = [1, 2, 3].map((i) => generateSigningKey(`guardian-${i}`));
const ACCOUNT = 'acct:v1:IN:HDFC0001234:50100123456789';

const details = (bank: string): CaseDetails => ({ institutionId: bank, caseRef: `CASE-${bank}`, typology: 1, evidenceSummary: '', contactRef: '' });

// Banks A and B flag T with guardian-encrypted case details; D attests k = 2 with an escalation.
const scenario = (opts: { warrant: boolean }) => {
  const w = new World({ k: 2n }).register('A', 'B', 'D');
  const T = new Uint8Array(randomBytes(32));
  const records: FlagRecord[] = [];
  const slots = [];
  for (const b of ['A', 'B']) {
    const { ct, ctHash } = encryptObject(guardianKeys.groupPublicKey, details(`bank-${b.toLowerCase()}`));
    const index = w.state.flags.firstFree();
    w.asBank(b).call('submitFlag', T, 1n, ctHash, 0n, w.institutionPath(b));
    const p = pc.pseudonym(w.secretOf(b), T);
    records.push(sealRecord(T, { p, epoch: 0, typology: 1, ctHash, ct, index: Number(index), flaggedAt: 1 }));
    slots.push({ pseudonym: p, epoch: 0n, ctHash, leaf: pc.flagLeaf(T, p, 0n, 1n, ctHash), index });
  }
  const escalation = encryptObject<EscalationDetails>(guardianKeys.groupPublicKey, {
    identifier: ACCOUNT,
    tag: T,
    leafIndices: slots.map((s) => Number(s.index)),
    institutionId: 'bank-d',
    caseRef: 'STR-1',
  });
  w.asBank('D').call(
    'attestCorroboration2',
    T,
    1n,
    slots.map((s) => ({ pseudonym: s.pseudonym, epoch: s.epoch, ctHash: s.ctHash, path: w.flagPath(s.index, s.leaf) })),
    w.institutionPath('D'),
    escalation.ctHash,
  );
  const attKey = toHex(pc.attestationKey(T, 0n, 1n));
  if (opts.warrant) w.govern(KIND.Disclose, fromHex(attKey));

  const governance: Governance & { calls: string[] } = {
    calls: [],
    async propose() {
      this.calls.push('propose');
      return { txId: 't', proposalId: '00'.repeat(32) };
    },
    async approve() {
      this.calls.push('approve');
      return { txId: 't' };
    },
    async execute() {
      this.calls.push('execute');
      return { txId: 't' };
    },
  };
  const daemons = guardianKeys.shares.map((key, i) =>
    buildGuardian({
      key,
      ledger: async () => w.state,
      pathIndex: (p) => pc.pathIndex(p),
      governance,
      regulator: { id: regulator.id, publicKey: regulator.publicKey },
      operator: { id: operators[i].id, publicKey: operators[i].publicKey },
      logger: false,
    }),
  );
  return { w, T, records, escalation, attKey, daemons, governance };
};

const post = (d: ReturnType<typeof scenario>['daemons'][number], key: typeof regulator, url: string, payload: object) => {
  const body = Buffer.from(JSON.stringify(payload));
  return d.app.inject({ method: 'POST', url, headers: { 'content-type': 'application/json', ...signRequest(key, 'POST', url, body) }, payload: body });
};
const b64 = (r: FlagRecord) => Buffer.from(encodeRecord(r)).toString('base64');
const share = (j: { guardianIndex: number; share: string; proof: string }) => ({ index: j.guardianIndex, share: fromHex(j.share), proof: fromHex(j.proof) });

describe('guardian release policy, end to end under a warrant', () => {
  it('round 1 opens the escalation; round 2 opens every flagger’s case details', async () => {
    const s = scenario({ warrant: true });
    // Round 1: two guardians release shares for the escalation ciphertext.
    const r1 = await Promise.all(
      [0, 2].map((i) => post(s.daemons[i], regulator, '/v1/shares/escalation', { attKey: s.attKey, escalationCt: toHex(s.escalation.ct) })),
    );
    expect(r1.map((r) => r.statusCode)).toEqual([200, 200]);
    const esc = decodeCbor<EscalationDetails>(combineAndDecrypt(s.escalation.ct, pubs, r1.map((r) => share(r.json())), 2));
    expect(esc.identifier).toBe(ACCOUNT);
    expect(toHex(new Uint8Array(esc.tag))).toBe(toHex(s.T));

    // Round 2: with T from round 1, the regulator asks for the flaggers' details.
    const req = { attKey: s.attKey, tag: toHex(s.T), records: s.records.map(b64) };
    const r2 = await Promise.all([0, 1].map((i) => post(s.daemons[i], regulator, '/v1/shares/details', req)));
    expect(r2.map((r) => r.statusCode)).toEqual([200, 200]);
    const perGuardian = r2.map((r) => r.json() as { guardianIndex: number; shares: { index: number; share: string; proof: string }[] });
    const flaggers = s.records.map((rec) => {
      const body = openRecord(s.T, rec);
      const shares = perGuardian.map((g) => {
        const sh = g.shares.find((x) => x.index === body.index)!;
        return { index: g.guardianIndex, share: fromHex(sh.share), proof: fromHex(sh.proof) };
      });
      return decodeCbor<CaseDetails>(combineAndDecrypt(body.ct, pubs, shares, 2)).institutionId;
    });
    expect(flaggers.sort()).toEqual(['bank-a', 'bank-b']);

    // Every release is in the guardian's public log.
    const log = (await s.daemons[0].app.inject({ method: 'GET', url: '/v1/log' })).json();
    expect(log.map((e: { kind: string }) => e.kind)).toEqual(['escalation', 'details']);
  });
});

describe('guardian release policy refusals', () => {
  it('no warrant on chain → refused', async () => {
    const s = scenario({ warrant: false });
    const r = await post(s.daemons[0], regulator, '/v1/shares/escalation', { attKey: s.attKey, escalationCt: toHex(s.escalation.ct) });
    expect(r.statusCode).toBe(403);
    expect(r.json().reason).toBe('no warrant for this attestation');
  });

  it('a ciphertext other than the committed escalation → refused', async () => {
    const s = scenario({ warrant: true });
    const other = encryptObject(guardianKeys.groupPublicKey, { anything: 1 });
    const r = await post(s.daemons[0], regulator, '/v1/shares/escalation', { attKey: s.attKey, escalationCt: toHex(other.ct) });
    expect(r.json().reason).toBe('ciphertext is not the one committed in the attestation');
  });

  it('a tag that is not the warranted subject → refused', async () => {
    const s = scenario({ warrant: true });
    const r = await post(s.daemons[0], regulator, '/v1/shares/details', { attKey: s.attKey, tag: toHex(randomBytes(32)), records: s.records.map(b64) });
    expect(r.json().reason).toBe('tag does not match the warranted attestation');
  });

  it('a record of another subject smuggled into the request → refused', async () => {
    const s = scenario({ warrant: true });
    const foreign = sealRecord(new Uint8Array(randomBytes(32)), openRecord(s.T, s.records[0]));
    const r = await post(s.daemons[0], regulator, '/v1/shares/details', { attKey: s.attKey, tag: toHex(s.T), records: [b64(s.records[0]), b64(foreign)] });
    expect(r.json().reason).toBe('a record does not belong to this subject');
  });

  it('a well-formed record whose flag is not on chain → refused', async () => {
    const s = scenario({ warrant: true });
    const { ct, ctHash } = encryptObject(guardianKeys.groupPublicKey, details('bank-x'));
    const forged = sealRecord(s.T, { p: new Uint8Array(randomBytes(32)), epoch: 0, typology: 1, ctHash, ct, index: 7, flaggedAt: 1 });
    const r = await post(s.daemons[0], regulator, '/v1/shares/details', { attKey: s.attKey, tag: toHex(s.T), records: [b64(forged)] });
    expect(r.json().reason).toBe('record for index 7 is not an on-chain flag');
  });

  it('only the regulator can request shares; nothing refused is logged', async () => {
    const s = scenario({ warrant: true });
    const r = await post(s.daemons[0], operators[0], '/v1/shares/escalation', { attKey: s.attKey, escalationCt: toHex(s.escalation.ct) });
    expect(r.statusCode).toBe(403);
    expect((await s.daemons[0].app.inject({ method: 'GET', url: '/v1/log' })).json()).toEqual([]);
  });
});

describe('guardian governance API', () => {
  it('only the guardian’s own operator can vote', async () => {
    const s = scenario({ warrant: false });
    expect((await post(s.daemons[0], regulator, '/v1/gov/approve', { id: '00'.repeat(32) })).statusCode).toBe(403);
    expect((await post(s.daemons[0], operators[1], '/v1/gov/approve', { id: '00'.repeat(32) })).statusCode).toBe(401);
    expect((await post(s.daemons[0], operators[0], '/v1/gov/approve', { id: '00'.repeat(32) })).statusCode).toBe(200);
    expect(s.governance.calls).toEqual(['approve']);
  });
});
