// SPDX-License-Identifier: Apache-2.0
// Threats: double vote, proposal replay, parameter tampering.
import { describe, expect, it } from 'vitest';
import { pureCircuits as pc } from '../../managed/mulenet/contract/index.js';
import { KIND, World, bytes, subject } from '../world.js';

describe('adversarial: governance', () => {
  it('double vote by the same guardian is rejected (vote nullifier)', () => {
    const w = new World();
    const id = w.propose(0, KIND.Register, bytes());
    w.approve(1, id);
    expect(() => w.approve(1, id)).toThrow('already voted');
    expect(w.state.proposals.lookup(id).approvals).toBe(1n);
  });

  it('a vote for one proposal does not count for another', () => {
    const w = new World();
    const a = w.propose(0, KIND.Register, bytes());
    const b = w.propose(0, KIND.Register, bytes());
    w.approve(0, a).approve(1, a);
    expect(() => w.execute(b)).toThrow('quorum');
  });

  it('the same payload proposed twice gets distinct ids (nonce) and executes independently', () => {
    const w = new World();
    const leaf = pc.institutionLeaf(bytes(), 0n);
    const a = w.govern(KIND.Register, leaf);
    const b = w.govern(KIND.Register, leaf);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false);
  });

  it('replaying an executed proposal fails', () => {
    const w = new World();
    const id = w.govern(KIND.Rotate, bytes());
    expect(() => w.execute(id)).toThrow('executed');
    expect(w.state.membershipGen).toBe(1n);
  });

  it('execute cannot apply a value other than the one committed in the proposal', () => {
    const w = new World();
    const id = w.propose(0, KIND.SetTtl, pc.valueCommitment(30n));
    w.approve(0, id).approve(1, id);
    expect(() => w.execute(id, 90n)).toThrow('value');
    w.execute(id, 30n);
    expect(w.state.epochTtl).toBe(30n);
  });

  it('a warrant needs an existing attestation', () => {
    const w = new World();
    expect(() => w.govern(KIND.Disclose, pc.attestationKey(subject('nobody'), 0n, 1n))).toThrow('no attestation');
  });

  it('no proposal kind can change the guardian threshold or guardian set', () => {
    const w = new World().register('A', 'B', 'C', 'D');
    const S = subject('sealed');
    for (const b of ['A', 'B', 'C']) w.flag(b, S);
    const key = w.attest('D', S, ['A', 'B', 'C'].map((b) => w.slotOf(b, S)));
    const guardianRoot = w.state.guardians.root();
    w.govern(KIND.Register, bytes());
    w.govern(KIND.SetK, pc.valueCommitment(2n), 2n);
    w.govern(KIND.Disclose, key);
    w.govern(KIND.SetTtl, pc.valueCommitment(10n), 10n);
    w.govern(KIND.Rotate, bytes());
    expect(w.state.guardianThreshold).toBe(2n);
    expect(w.state.guardians.root()).toEqual(guardianRoot);
  });
});
