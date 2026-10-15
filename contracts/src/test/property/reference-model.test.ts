// SPDX-License-Identifier: Apache-2.0
// Reference-model property test (ARCHITECTURE §14.3).
//
// A plain TypeScript model tracks which (institution, subject, epoch, typology, revoked) flags
// exist, plus nullifiers, quotas and attestations. For random operation sequences the
// contract must accept exactly the operations the model accepts. In particular an
// attestation succeeds iff the model has ≥ k distinct, fresh, unrevoked, non-self flags of
// that typology for the subject, and no attestation exists yet for (subject, epoch, typology).
//
// PROPERTY_RUNS=1000 npx vitest run src/test/property   (default 25 runs for CI)
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { World, bytes, subject, type FlagRecord } from '../world.js';

const BANKS = ['A', 'B', 'C', 'D', 'E'] as const;
type Bank = (typeof BANKS)[number];
const SUBJECTS = [subject('subject-0'), subject('subject-1')];
const TTL = 2;
const FLAG_QUOTA = 3;
const REVOKE_QUOTA = 2;
const RUNS = Number(process.env.PROPERTY_RUNS ?? 25);

type Op =
  | { t: 'flag'; bank: Bank; subj: number; typology: bigint }
  | { t: 'revoke'; bank: Bank; subj: number }
  | { t: 'advance' }
  | { t: 'attest'; querier: Bank; subj: number; typology: bigint; slots: [Bank, Bank, Bank] }
  // Slots chosen at run time: the three most recent other banks that flagged the subject
  // (whatever their state). Uniform random slots almost never hit the success path.
  | { t: 'attestLikely'; querier: Bank; subj: number; typology: bigint };

const bank = fc.constantFrom(...BANKS);
// Mostly one subject and one typology, so corroboration actually builds up.
const subj = fc.constantFrom(0, 0, 0, 0, 1);
const typology = fc.constantFrom(1n, 1n, 1n, 1n, 1n, 2n);
const op: fc.Arbitrary<Op> = fc.oneof(
  { weight: 6, arbitrary: fc.record({ t: fc.constant('flag' as const), bank, subj, typology }) },
  { weight: 1, arbitrary: fc.record({ t: fc.constant('revoke' as const), bank, subj }) },
  { weight: 1, arbitrary: fc.record({ t: fc.constant('advance' as const) }) },
  {
    weight: 1,
    arbitrary: fc.record({ t: fc.constant('attest' as const), querier: bank, subj, typology, slots: fc.tuple(bank, bank, bank) }),
  },
  { weight: 5, arbitrary: fc.record({ t: fc.constant('attestLikely' as const), querier: bank, subj, typology }) },
);

type ModelFlag = { bank: Bank; subj: number; typology: bigint; epoch: number; revoked: boolean; rec: FlagRecord };

class Model {
  epoch = 0;
  flags: ModelFlag[] = [];
  nullifiers = new Set<string>();
  quota = new Map<string, number>();
  revokes = new Map<string, number>();
  attested = new Set<string>();

  latest(b: Bank, s: number): ModelFlag | undefined {
    return this.flags.filter((f) => f.bank === b && f.subj === s).at(-1);
  }

  canFlag(o: Extract<Op, { t: 'flag' }>): boolean {
    return !this.nullifiers.has(`${o.bank}|${o.subj}|${this.epoch}`) && (this.quota.get(`${o.bank}|${this.epoch}`) ?? 0) < FLAG_QUOTA;
  }

  canRevoke(o: Extract<Op, { t: 'revoke' }>): boolean {
    const f = this.latest(o.bank, o.subj);
    return !!f && !f.revoked && (this.revokes.get(`${o.bank}|${this.epoch}`) ?? 0) < REVOKE_QUOTA;
  }

  likelySlots(querier: Bank, s: number): Bank[] {
    const seen: Bank[] = [];
    for (const f of [...this.flags].reverse()) {
      if (f.subj === s && f.bank !== querier && !seen.includes(f.bank)) seen.push(f.bank);
    }
    return seen.slice(0, 3);
  }

  canAttest(o: { querier: Bank; subj: number; typology: bigint; slots: Bank[] }): boolean {
    if (this.attested.has(`${o.subj}|${this.epoch}|${o.typology}`)) return false;
    if (new Set(o.slots).size !== 3 || o.slots.includes(o.querier)) return false;
    const minEpoch = Math.max(0, this.epoch - TTL);
    return o.slots.every((b) => {
      const f = this.latest(b, o.subj);
      return !!f && !f.revoked && f.typology === o.typology && f.epoch >= minEpoch;
    });
  }
}

const run = (ops: Op[], stats: { attestOk: number; attestFail: number }) => {
  const w = new World({ k: 3n, ttl: BigInt(TTL), flagQuota: BigInt(FLAG_QUOTA), revokeQuota: BigInt(REVOKE_QUOTA) }).register(...BANKS);
  const m = new Model();

  for (const [i, o] of ops.entries()) {
    let expected: boolean;
    let actual: string | null;

    switch (o.t) {
      case 'flag': {
        expected = m.canFlag(o);
        let rec: FlagRecord | undefined;
        actual = w.outcome(() => (rec = w.flag(o.bank, SUBJECTS[o.subj], o.typology)));
        if (actual === null && rec) {
          m.nullifiers.add(`${o.bank}|${o.subj}|${m.epoch}`);
          m.quota.set(`${o.bank}|${m.epoch}`, (m.quota.get(`${o.bank}|${m.epoch}`) ?? 0) + 1);
          m.flags.push({ bank: o.bank, subj: o.subj, typology: o.typology, epoch: m.epoch, revoked: false, rec });
        }
        break;
      }
      case 'revoke': {
        const f = m.latest(o.bank, o.subj);
        if (!f) continue; // nothing to revoke: not a meaningful operation
        expected = m.canRevoke(o);
        actual = w.outcome(() => w.revoke(o.bank, SUBJECTS[o.subj]));
        if (actual === null) {
          f.revoked = true;
          m.revokes.set(`${o.bank}|${m.epoch}`, (m.revokes.get(`${o.bank}|${m.epoch}`) ?? 0) + 1);
        }
        break;
      }
      case 'advance': {
        expected = true;
        actual = w.outcome(() => w.advanceEpochs(1));
        if (actual === null) m.epoch += 1;
        break;
      }
      case 'attest':
      case 'attestLikely': {
        const live = m.flags.find((f) => !f.revoked);
        if (!live) continue; // no leaf in the tree to build any path from
        const slotBanks = o.t === 'attest' ? o.slots : m.likelySlots(o.querier, o.subj);
        if (slotBanks.length < 3) continue;
        expected = m.canAttest({ ...o, slots: slotBanks });
        actual = w.outcome(() => {
          const slots = slotBanks.map((b) => {
            const f = m.latest(b, o.subj);
            // A bank with no usable flag offers a forged slot: its pseudonym on a real path.
            if (!f || f.revoked) {
              return { ...w.slotFrom(live.rec), pseudonym: f?.rec.pseudonym ?? bytes(), epoch: BigInt(m.epoch) };
            }
            return w.slotFrom(f.rec);
          });
          w.attest(o.querier, SUBJECTS[o.subj], slots, o.typology);
        });
        if (actual === null) {
          m.attested.add(`${o.subj}|${m.epoch}|${o.typology}`);
          stats.attestOk++;
        } else stats.attestFail++;
        break;
      }
    }

    if ((actual === null) !== expected) {
      throw new Error(
        `divergence at op ${i} ${JSON.stringify(o, (_, v) => (typeof v === 'bigint' ? Number(v) : v))}: ` +
          `model ${expected ? 'accepts' : 'rejects'}, contract ${actual === null ? 'accepts' : `rejects (${actual})`}`,
      );
    }
  }
};

describe('reference model', () => {
  it(`contract accepts exactly what the model accepts (${RUNS} runs)`, () => {
    const stats = { attestOk: 0, attestFail: 0 };
    fc.assert(
      fc.property(fc.array(op, { minLength: 12, maxLength: 40 }), (ops) => {
        run(ops, stats);
      }),
      { numRuns: RUNS },
    );
    // Guard against a vacuous pass: both outcomes must actually have been exercised.
    expect(stats.attestOk).toBeGreaterThan(0);
    expect(stats.attestFail).toBeGreaterThan(0);
    console.log(`reference model: ${RUNS} runs, ${stats.attestOk} attestations accepted, ${stats.attestFail} rejected`);
  }, Math.max(600_000, RUNS * 5_000));
});
