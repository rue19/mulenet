// SPDX-License-Identifier: Apache-2.0
// Phase-1 spike coverage: every circuit's happy path plus the PLAN.md §1 design decisions.
// The full invariant (I1–I8) and adversarial suites come in Phase 3.
import { describe, expect, it } from 'vitest';
import { pureCircuits as pc } from '../managed/mulenet/contract/index.js';
import { KIND, World, bytes, eq, subject } from './world.js';

const S = subject('acct:v1:IN:HDFC0001234:5010012');

const flagged = (...banks: string[]) => {
  const w = new World().register('A', 'B', 'C', 'D', ...banks);
  return w;
};

describe('deployment and governance', () => {
  it('seeds guardians and parameters', () => {
    const w = new World();
    expect(w.state.guardianThreshold).toBe(2n);
    expect(w.state.corroborationK).toBe(3n);
    expect(w.state.flagQuota).toBe(500n);
    expect(w.state.currentEpoch).toBe(0n);
  });

  it('registers an institution through 2-of-3 governance', () => {
    const w = new World().register('A');
    expect(w.state.institutions.firstFree()).toBe(1n);
  });

  it('refuses execution below quorum', () => {
    const w = new World();
    const id = w.propose(0, KIND.Register, pc.institutionLeaf(w.secretOf('A'), 0n));
    w.approve(0, id);
    expect(() => w.execute(id)).toThrow('quorum');
  });

  it('refuses a double vote', () => {
    const w = new World();
    const id = w.propose(0, KIND.Register, bytes());
    w.approve(0, id);
    expect(() => w.approve(0, id)).toThrow('already voted');
  });

  it('refuses a non-guardian', () => {
    const w = new World();
    expect(() =>
      w.as({ guardianSecret: bytes() }).call('propose', KIND.Register, bytes(), w.guardianPath(0)),
    ).toThrow('not bound');
  });

  it('refuses to re-execute', () => {
    const w = new World();
    const id = w.govern(KIND.Register, bytes());
    expect(() => w.execute(id)).toThrow('executed');
  });

  it('expires proposals after 7 epochs, for approve as well as execute', () => {
    const w = new World();
    const id = w.propose(0, KIND.Register, bytes());
    w.approve(0, id).advanceEpochs(8);
    expect(() => w.approve(1, id)).toThrow('proposal expired');
    expect(() => w.execute(id)).toThrow('proposal expired');
  });

  it('range-checks k', () => {
    for (const [v, ok] of [[1n, false], [2n, true], [3n, true], [4n, false]] as const) {
      const w = new World();
      const run = () => w.govern(KIND.SetK, pc.valueCommitment(v), v);
      if (ok) {
        run();
        expect(w.state.corroborationK).toBe(v);
      } else expect(run).toThrow('bad k');
    }
  });

  it('range-checks ttl', () => {
    for (const [v, ok] of [[0n, false], [1n, true], [90n, true], [91n, false]] as const) {
      const w = new World();
      const run = () => w.govern(KIND.SetTtl, pc.valueCommitment(v), v);
      if (ok) {
        run();
        expect(w.state.epochTtl).toBe(v);
      } else expect(run).toThrow('bad ttl');
    }
  });

  it('rejects a value that does not match the committed payload', () => {
    const w = new World();
    expect(() => w.govern(KIND.SetK, pc.valueCommitment(2n), 3n)).toThrow('value');
  });
});

describe('epochs', () => {
  it('refuses to roll early', () => {
    const w = new World();
    expect(() => w.as({}).call('advanceEpoch')).toThrow('too early');
  });

  it('rolls once block time reaches nextEpochAt', () => {
    const w = new World().advanceEpochs(2);
    expect(w.state.currentEpoch).toBe(2n);
  });
});

describe('flags', () => {
  it('submits a hidden flag at the next free index', () => {
    const w = flagged();
    const a = w.flag('A', S);
    const b = w.flag('B', S);
    expect([a.index, b.index]).toEqual([0n, 1n]);
    expect(w.state.flagCount).toBe(2n);
    expect(w.state.flags.findPathForLeaf(b.leaf)).toBeDefined();
  });

  it('refuses an unregistered institution', () => {
    const w = flagged();
    w.banks.set('X', bytes());
    expect(() =>
      w.asBank('X').call('submitFlag', S, 1n, bytes(), 0n, w.institutionPath('A')),
    ).toThrow('not bound');
  });

  it('refuses a second flag on the same subject in the same epoch', () => {
    const w = flagged();
    w.flag('A', S);
    expect(() => w.flag('A', S)).toThrow('duplicate flag');
  });

  it('allows re-flagging the same subject in a later epoch', () => {
    const w = flagged();
    w.flag('A', S);
    w.advanceEpochs(1);
    expect(() => w.flag('A', S)).not.toThrow();
  });

  it('enforces the per-epoch flag quota', () => {
    const w = new World({ flagQuota: 2n }).register('A');
    w.flag('A', subject('s1'));
    w.flag('A', subject('s2'));
    expect(() => w.flag('A', subject('s3'))).toThrow('quota');
  });

  it('refuses a reused quota slot', () => {
    const w = flagged();
    w.flag('A', subject('s1'), 1n, { quotaSlot: 0n });
    expect(() => w.flag('A', subject('s2'), 1n, { quotaSlot: 0n })).toThrow('quota slot used');
  });

  it('resets the quota in a new epoch', () => {
    const w = new World({ flagQuota: 1n }).register('A');
    w.flag('A', subject('s1'));
    w.advanceEpochs(1);
    expect(() => w.flag('A', subject('s2'))).not.toThrow();
  });
});

describe('pathIndex', () => {
  it('matches the leaf position for every index in a small tree', () => {
    const w = flagged();
    const recs = Array.from({ length: 9 }, (_, i) => w.flag('A', subject(`s${i}`)));
    for (const r of recs) {
      expect(pc.pathIndex(w.flagPath(r.index, r.leaf))).toBe(r.index);
    }
  });
});

describe('revocation', () => {
  it('lets the flagger revoke and clears the leaf', () => {
    const w = flagged();
    const r = w.flag('A', S);
    w.revoke('A', S);
    expect(w.state.revocationCount).toBe(1n);
    expect(w.state.flags.findPathForLeaf(r.leaf)).toBeUndefined();
  });

  it('refuses revocation by another institution', () => {
    const w = flagged();
    const r = w.flag('A', S);
    expect(() =>
      w
        .asBank('B')
        .call('revokeFlag', S, r.epoch, r.typology, r.ctHash, r.index, 0n, w.flagPath(r.index, r.leaf), w.institutionPath('B')),
    ).toThrow('not yours');
  });

  it('refuses an index that does not match the path', () => {
    const w = flagged();
    w.flag('B', subject('other'));
    w.flag('A', S);
    expect(() => w.revoke('A', S, { index: 0n })).toThrow('wrong index');
  });

  it('enforces the per-epoch revocation cap', () => {
    const w = new World({ revokeQuota: 1n }).register('A');
    w.flag('A', subject('s1'));
    w.flag('A', subject('s2'));
    w.revoke('A', subject('s1'));
    expect(() => w.revoke('A', subject('s2'))).toThrow('quota');
  });
});

describe('attestation', () => {
  it('attests k=3 with three distinct institutions and records it under attKey', () => {
    const w = flagged();
    for (const b of ['A', 'B', 'C']) w.flag(b, S);
    const key = w.attest('D', S, [w.slotOf('A', S), w.slotOf('B', S), w.slotOf('C', S)]);
    const att = w.state.attestations.lookup(key);
    expect(att.k).toBe(3n);
    expect(att.epoch).toBe(0n);
    expect(eq(att.querierTag, pc.querierTag(w.secretOf('D'), key))).toBe(true);
  });

  it('attests k=2 when policy allows it', () => {
    const w = new World({ k: 2n }).register('A', 'B', 'D');
    w.flag('A', S);
    w.flag('B', S);
    w.attest('D', S, [w.slotOf('A', S), w.slotOf('B', S)]);
    expect(w.state.attestationCount).toBe(1n);
  });

  it('refuses attest2 under a k=3 policy', () => {
    const w = flagged();
    w.flag('A', S);
    w.flag('B', S);
    expect(() => w.attest('D', S, [w.slotOf('A', S), w.slotOf('B', S)])).toThrow('policy');
  });

  it('refuses counting one institution twice', () => {
    const w = flagged();
    w.flag('A', S);
    w.flag('B', S);
    expect(() => w.attest('D', S, [w.slotOf('A', S), w.slotOf('A', S), w.slotOf('B', S)])).toThrow('dup');
  });

  it("refuses the querier's own flag", () => {
    const w = flagged();
    for (const b of ['A', 'B', 'C']) w.flag(b, S);
    expect(() => w.attest('C', S, [w.slotOf('A', S), w.slotOf('B', S), w.slotOf('C', S)])).toThrow('self excluded');
  });

  it('refuses slots proven against different roots', () => {
    const w = flagged();
    w.flag('A', S);
    const early = w.slotOf('A', S);
    w.flag('B', S);
    w.flag('C', S);
    expect(() => w.attest('D', S, [early, w.slotOf('B', S), w.slotOf('C', S)])).toThrow('mixed roots');
  });

  it('refuses a revoked flag even with a pre-revocation path', () => {
    const w = flagged();
    for (const b of ['A', 'B', 'C']) w.flag(b, S);
    const stale = [w.slotOf('A', S), w.slotOf('B', S), w.slotOf('C', S)];
    w.revoke('C', S);
    expect(() => w.attest('D', S, stale)).toThrow('slot not in tree');
  });

  it('refuses expired flags', () => {
    const w = new World({ ttl: 2n }).register('A', 'B', 'C', 'D');
    for (const b of ['A', 'B', 'C']) w.flag(b, S);
    w.advanceEpochs(3);
    const slots = [w.slotOf('A', S), w.slotOf('B', S), w.slotOf('C', S)];
    expect(() => w.attest('D', S, slots)).toThrow('slot expired');
  });

  it('refuses a second attestation for the same subject, epoch and typology', () => {
    const w = flagged('E');
    for (const b of ['A', 'B', 'C']) w.flag(b, S);
    const slots = [w.slotOf('A', S), w.slotOf('B', S), w.slotOf('C', S)];
    w.attest('D', S, slots);
    expect(() => w.attest('E', S, slots)).toThrow('already attested');
  });
});

describe('membership rotation', () => {
  it('evicts institutions not re-registered under the new generation', () => {
    const w = flagged();
    const oldPath = w.institutionPath('A');
    w.govern(KIND.Rotate, bytes());
    expect(w.state.membershipGen).toBe(1n);
    expect(() => w.asBank('A').call('submitFlag', S, 1n, bytes(), 0n, oldPath)).toThrow('not bound');
  });
});

describe('warrants', () => {
  it('logs an authorised disclosure for an existing attestation', () => {
    const w = flagged();
    for (const b of ['A', 'B', 'C']) w.flag(b, S);
    const key = w.attest('D', S, [w.slotOf('A', S), w.slotOf('B', S), w.slotOf('C', S)]);
    w.govern(KIND.Disclose, key);
    expect(w.state.disclosures.lookup(key)).toBe(0n);
  });

  it('refuses a warrant for an unknown attestation', () => {
    const w = new World();
    expect(() => w.govern(KIND.Disclose, bytes())).toThrow('no attestation');
  });
});
