// Threat: Sybil institutions. An attacker tries to get unapproved leaves into the registry.
import { describe, expect, it } from 'vitest';
import { pureCircuits as pc } from '../../managed/mulenet/contract/index.js';
import { KIND, World, bytes } from '../world.js';

describe('adversarial: Sybil registration', () => {
  it('a single guardian cannot register an institution', () => {
    const w = new World();
    const id = w.propose(0, KIND.Register, pc.institutionLeaf(bytes(), 0n));
    w.approve(0, id);
    expect(() => w.execute(id)).toThrow('quorum');
    expect(w.state.institutions.firstFree()).toBe(0n);
  });

  it('a non-guardian cannot propose or approve', () => {
    const w = new World();
    const outsider = { guardianSecret: bytes() };
    expect(() => w.as(outsider).call('propose', KIND.Register, bytes(), w.guardianPath(0))).toThrow('not bound');
    const id = w.propose(0, KIND.Register, bytes());
    expect(() => w.as(outsider).call('approve', id, w.guardianPath(1))).toThrow('not bound');
  });

  it('a bank secret cannot act as a guardian', () => {
    const w = new World().register('A');
    expect(() => w.as({ guardianSecret: w.secretOf('A') }).call('propose', KIND.Register, bytes(), w.guardianPath(0))).toThrow(
      'not bound',
    );
  });

  it('rejects an unknown proposal kind', () => {
    const w = new World();
    expect(() => w.asGuardian(0).call('propose', 9n, bytes(), w.guardianPath(0))).toThrow('bad kind');
    expect(() => w.asGuardian(0).call('propose', 0n, bytes(), w.guardianPath(0))).toThrow('bad kind');
  });

  it('cannot approve a proposal that does not exist', () => {
    const w = new World();
    expect(() => w.approve(0, bytes())).toThrow('no proposal');
    expect(() => w.execute(bytes())).toThrow('no proposal');
  });
});
