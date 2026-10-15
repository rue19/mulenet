// SPDX-License-Identifier: Apache-2.0
// Invariants I1–I7 (ARCHITECTURE §6.4), one describe block each. I8 (no secret in any
// public value) is covered by the leak scan in packages/sdk/scripts/spike-local.ts and,
// from Phase 8, by the leak scanner in CI.
import { describe, expect, it } from 'vitest';
import { pureCircuits as pc } from '../managed/mulenet/contract/index.js';
import { KIND, World, bytes, subject } from './world.js';

const S = subject('acct:v1:IN:ICIC0000104:000101');
const threeFlags = (w: World) => ['A', 'B', 'C'].map((b) => w.flag(b, S));
const slots3 = (w: World) => ['A', 'B', 'C'].map((b) => w.slotOf(b, S));

describe('I1: every flag leaf was inserted by a member at the current generation', () => {
  it('no failed submission adds a leaf', () => {
    const w = new World().register('A');
    w.banks.set('X', bytes());
    const before = w.state.flags.firstFree();
    const attempts = [
      () => w.asBank('X').call('submitFlag', S, 1n, bytes(), 0n, w.institutionPath('A')), // unregistered, replayed path
      () => w.as({ institutionSecret: bytes() }).call('submitFlag', S, 1n, bytes(), 0n, w.institutionPath('A')),
    ];
    for (const a of attempts) expect(a).toThrow('not bound');
    expect(w.state.flags.firstFree()).toBe(before);
    expect(w.state.flagCount).toBe(0n);
  });

  it('an institution evicted by rotation adds no leaf', () => {
    const w = new World().register('A');
    const stale = w.institutionPath('A');
    w.govern(KIND.Rotate, bytes());
    expect(() => w.asBank('A').call('submitFlag', S, 1n, bytes(), 0n, stale)).toThrow('not bound');
    expect(w.state.flags.firstFree()).toBe(0n);
  });
});

describe('I2: at most one leaf per (institution, subject, epoch)', () => {
  it('rejects a second flag even with a different typology, ctHash and quota slot', () => {
    const w = new World().register('A');
    w.flag('A', S, 1n);
    expect(() => w.flag('A', S, 2n, { quotaSlot: 7n })).toThrow('duplicate flag');
    expect(w.state.flags.firstFree()).toBe(1n);
  });

  it('the rule is per epoch: one leaf in each epoch', () => {
    const w = new World().register('A');
    w.flag('A', S);
    w.advanceEpochs(1);
    w.flag('A', S);
    expect(() => w.flag('A', S)).toThrow('duplicate flag');
    expect(w.state.flagCount).toBe(2n);
  });

  it('revoking does not reopen the slot within the same epoch', () => {
    const w = new World().register('A');
    w.flag('A', S);
    w.revoke('A', S);
    expect(() => w.flag('A', S)).toThrow('duplicate flag');
  });
});

describe('I3: an attestation with k = n implies n distinct, fresh, unrevoked, non-self flags', () => {
  it('records k = 3 only after all three conditions hold', () => {
    const w = new World().register('A', 'B', 'C', 'D');
    threeFlags(w);
    const key = w.attest('D', S, slots3(w));
    expect(w.state.attestations.lookup(key).k).toBe(3n);
  });

  it('the attestation key binds subject, epoch and typology', () => {
    const w = new World().register('A', 'B', 'C', 'D');
    threeFlags(w);
    const key = w.attest('D', S, slots3(w));
    expect(Buffer.from(key).equals(Buffer.from(pc.attestationKey(S, 0n, 1n)))).toBe(true);
    expect(Buffer.from(key).equals(Buffer.from(pc.attestationKey(S, 1n, 1n)))).toBe(false);
    expect(Buffer.from(key).equals(Buffer.from(pc.attestationKey(S, 0n, 2n)))).toBe(false);
  });

  it('fails if any one condition fails (distinct, fresh, unrevoked, non-self)', () => {
    const dup = new World().register('A', 'B', 'C', 'D');
    threeFlags(dup);
    expect(() => dup.attest('D', S, [dup.slotOf('A', S), dup.slotOf('A', S), dup.slotOf('B', S)])).toThrow('dup');

    const stale = new World({ ttl: 1n }).register('A', 'B', 'C', 'D');
    threeFlags(stale);
    stale.advanceEpochs(2);
    expect(() => stale.attest('D', S, slots3(stale))).toThrow('slot expired');

    const self = new World().register('A', 'B', 'C');
    threeFlags(self);
    expect(() => self.attest('A', S, slots3(self))).toThrow('self excluded');
  });
});

describe('I4: a revoked leaf can never be counted again', () => {
  it('fails with the pre-revocation path (old root is gone)', () => {
    const w = new World().register('A', 'B', 'C', 'D');
    const [a, b, c] = threeFlags(w);
    const stale = [w.slotFrom(a), w.slotFrom(b), w.slotFrom(c)];
    w.revoke('C', S);
    expect(() => w.attest('D', S, stale)).toThrow('slot not in tree');
  });

  it('fails with a path rebuilt against the current tree (leaf is gone)', () => {
    const w = new World().register('A', 'B', 'C', 'D');
    const [a, b, c] = threeFlags(w);
    w.revoke('C', S);
    const rebuilt = { ...w.slotFrom(c), path: { ...w.flagPath(a.index, a.leaf), leaf: c.leaf } };
    expect(() => w.attest('D', S, [w.slotFrom(a), w.slotFrom(b), rebuilt])).toThrow();
    expect(w.hasLeaf(c.leaf)).toBe(false);
  });

  it('fails after the revoked leaf is mixed with later flags', () => {
    const w = new World().register('A', 'B', 'C', 'D', 'E');
    const [a, b, c] = threeFlags(w);
    w.revoke('C', S);
    w.flag('E', subject('other'));
    expect(() => w.attest('D', S, [w.slotFrom(a), w.slotFrom(b), w.slotFrom(c, c.pathAtFlag)])).toThrow();
  });
});

describe('I5: flagCount counts submissions; revocation clears exactly one leaf', () => {
  it('flagCount equals successful submissions, failed ones excluded', () => {
    const w = new World().register('A', 'B');
    w.flag('A', S);
    w.outcome(() => w.flag('A', S));
    w.flag('B', S);
    w.flag('A', subject('s2'));
    expect(w.state.flagCount).toBe(3n);
  });

  it('revoking index i leaves every other leaf in place', () => {
    const w = new World().register('A', 'B', 'C');
    const recs = [w.flag('A', S), w.flag('B', S), w.flag('C', S), w.flag('A', subject('s2'))];
    w.revoke('B', S);
    expect(recs.map((r) => w.hasLeaf(r.leaf))).toEqual([true, false, true, true]);
    expect(w.state.flagCount).toBe(4n);
    expect(w.state.revocationCount).toBe(1n);
  });

  it('revocation cannot target another index than its own leaf', () => {
    const w = new World().register('A', 'B');
    const b = w.flag('B', S);
    w.flag('A', S);
    expect(() => w.revoke('A', S, { index: b.index })).toThrow('wrong index');
    expect(w.hasLeaf(b.leaf)).toBe(true);
  });
});

describe('I6: proposals execute at most once, with ≥ t distinct votes, within 7 epochs', () => {
  it('needs two distinct guardians', () => {
    const w = new World();
    const id = w.propose(0, KIND.Register, bytes());
    w.approve(0, id);
    expect(() => w.approve(0, id)).toThrow('already voted');
    expect(() => w.execute(id)).toThrow('quorum');
    w.approve(2, id);
    expect(() => w.execute(id)).not.toThrow();
  });

  it('executes exactly once', () => {
    const w = new World();
    const id = w.govern(KIND.Register, bytes());
    expect(() => w.execute(id)).toThrow('executed');
    expect(() => w.approve(2, id)).toThrow('executed');
  });

  it('expires after 7 epochs but not at 7', () => {
    const ok = new World();
    const id1 = ok.propose(0, KIND.Register, bytes());
    ok.approve(0, id1).approve(1, id1).advanceEpochs(7);
    expect(() => ok.execute(id1)).not.toThrow();

    const late = new World();
    const id2 = late.propose(0, KIND.Register, bytes());
    late.approve(0, id2).approve(1, id2).advanceEpochs(8);
    expect(() => late.execute(id2)).toThrow('proposal expired');
  });
});

describe('I7: rotation evicts every previous-generation institution', () => {
  it('evicts all members until re-registered under the new generation', () => {
    const w = new World().register('A', 'B');
    const oldPaths = { A: w.institutionPath('A'), B: w.institutionPath('B') };
    w.govern(KIND.Rotate, bytes());
    for (const n of ['A', 'B'] as const) {
      expect(() => w.asBank(n).call('submitFlag', S, 1n, bytes(), 0n, oldPaths[n])).toThrow('not bound');
    }
    w.register('A');
    expect(() => w.flag('A', S)).not.toThrow();
    expect(() => w.asBank('B').call('submitFlag', S, 1n, bytes(), 1n, oldPaths.B)).toThrow('not bound');
  });

  it("an old-generation leaf cannot be passed off as the new generation's", () => {
    const w = new World().register('A');
    const leafPath = w.institutionPath('A');
    w.govern(KIND.Rotate, bytes());
    // The binding assert recomputes H(sk, gen=1); the path's leaf is H(sk, gen=0).
    expect(() => w.asBank('A').call('submitFlag', S, 1n, bytes(), 0n, leafPath)).toThrow('not bound');
  });
});
