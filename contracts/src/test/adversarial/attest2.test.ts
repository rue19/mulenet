// SPDX-License-Identifier: Apache-2.0
// attestCorroboration2 parity with attestCorroboration3 (closeout task 3.4): every rule the
// k=3 circuit enforces is checked again here under a k=2 policy.
import { describe, expect, it } from 'vitest';
import { pureCircuits as pc } from '../../managed/mulenet/contract/index.js';
import { KIND, World, subject } from '../world.js';

const S = subject('attest2');

const world = () => {
  const w = new World({ k: 2n }).register('A', 'B', 'C', 'D');
  w.flag('A', S);
  w.flag('B', S);
  return w;
};
const slots = (w: World, banks = ['A', 'B']) => banks.map((b) => w.slotOf(b, S));

describe('attestCorroboration2 parity', () => {
  it('records k = 2 for two distinct institutions', () => {
    const w = world();
    const key = w.attest('D', S, slots(w));
    expect(w.state.attestations.lookup(key).k).toBe(2n);
  });

  it('distinctness: the same flag twice is rejected', () => {
    const w = world();
    expect(() => w.attest('D', S, slots(w, ['A', 'A']))).toThrow('dup');
  });

  it('self-exclusion in either position', () => {
    for (const q of ['A', 'B']) {
      const w = world();
      expect(() => w.attest(q, S, slots(w))).toThrow('self excluded');
    }
  });

  it('expiry', () => {
    const w = new World({ k: 2n, ttl: 1n }).register('A', 'B', 'D');
    w.flag('A', S);
    w.flag('B', S);
    w.advanceEpochs(2);
    expect(() => w.attest('D', S, slots(w))).toThrow('slot expired');
  });

  it('a revoked slot with its pre-revocation path is rejected', () => {
    const w = world();
    const stale = slots(w);
    w.revoke('B', S);
    expect(() => w.attest('D', S, stale)).toThrow('slot not in tree');
  });

  it('slots must share one root', () => {
    const w = new World({ k: 2n }).register('A', 'B', 'D');
    const a = w.flag('A', S);
    w.flag('B', S);
    expect(() => w.attest('D', S, [w.slotFrom(a, a.pathAtFlag), w.slotOf('B', S)])).toThrow('mixed roots');
  });

  it('typology and subject are bound', () => {
    const w = world();
    expect(() => w.attest('D', S, slots(w), 2n)).toThrow('slot mismatch');
    expect(() => w.attest('D', subject('other'), slots(w))).toThrow('slot mismatch');
  });

  it('one attestation per (subject, epoch, typology)', () => {
    const w = world();
    w.attest('D', S, slots(w));
    expect(() => w.attest('C', S, slots(w))).toThrow('already attested');
  });

  it('policy: attest2 is refused once governance raises k to 3; attest3 is accepted under k = 2', () => {
    const w = world();
    w.flag('C', S);
    const three = slots(w, ['A', 'B', 'C']);
    expect(() => w.attest('D', S, three)).not.toThrow();

    const v = new World({ k: 2n }).register('A', 'B', 'D');
    v.flag('A', S);
    v.flag('B', S);
    v.govern(KIND.SetK, pc.valueCommitment(3n), 3n);
    expect(() => v.attest('D', S, slots(v))).toThrow('policy');
  });
});
