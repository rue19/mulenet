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
