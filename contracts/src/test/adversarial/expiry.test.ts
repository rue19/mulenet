// SPDX-License-Identifier: Apache-2.0
// Threat: using expired flags; boundary arithmetic of the freshness window.
import { describe, expect, it } from 'vitest';
import { pureCircuits as pc } from '../../managed/mulenet/contract/index.js';
import { KIND, World, subject } from '../world.js';

const S = subject('expiry');

const flaggedAt0 = (ttl: bigint) => {
  const w = new World({ ttl }).register('A', 'B', 'C', 'D');
  for (const b of ['A', 'B', 'C']) w.flag(b, S);
  return w;
};
const slots = (w: World) => ['A', 'B', 'C'].map((b) => w.slotOf(b, S));

describe('adversarial: expiry window', () => {
  it('a flag from epoch e still counts at epoch e + ttl', () => {
    const w = flaggedAt0(3n).advanceEpochs(3);
    expect(() => w.attest('D', S, slots(w))).not.toThrow();
  });

  it('and expires at epoch e + ttl + 1', () => {
    const w = flaggedAt0(3n).advanceEpochs(4);
    expect(() => w.attest('D', S, slots(w))).toThrow('slot expired');
  });

  it('one expired slot is enough to fail', () => {
    const w = new World({ ttl: 2n }).register('A', 'B', 'C', 'D');
    w.flag('A', S);
    w.advanceEpochs(3);
    w.flag('B', S);
    w.flag('C', S);
    expect(() => w.attest('D', S, slots(w))).toThrow('slot expired');
  });

  it('a slot cannot claim a newer epoch than its leaf', () => {
    const w = flaggedAt0(1n).advanceEpochs(5);
    const forged = slots(w).map((s) => ({ ...s, epoch: 5n }));
    expect(() => w.attest('D', S, forged)).toThrow('slot mismatch');
  });

  it('no underflow while currentEpoch < ttl', () => {
    const w = flaggedAt0(90n);
    expect(w.state.currentEpoch).toBe(0n);
    expect(() => w.attest('D', S, slots(w))).not.toThrow();
  });

  it('a lowered TTL takes effect for existing flags', () => {
    const w = flaggedAt0(30n).advanceEpochs(2);
    w.govern(KIND.SetTtl, pc.valueCommitment(1n), 1n);
    expect(() => w.attest('D', S, slots(w))).toThrow('slot expired');
  });
});
