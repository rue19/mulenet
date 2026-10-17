// SPDX-License-Identifier: Apache-2.0
// Threat: count stuffing. One bank tries to contribute more than 1 to a subject's count.
import { describe, expect, it } from 'vitest';
import { World, subject } from '../world.js';

const S = subject('stuffing');

describe('adversarial: count stuffing', () => {
  it('the same flag in two slots is rejected', () => {
    const w = new World().register('A', 'B', 'D');
    w.flag('A', S);
    w.flag('B', S);
    expect(() => w.attest('D', S, [w.slotOf('A', S), w.slotOf('A', S), w.slotOf('B', S)])).toThrow('dup');
  });

  it("two of one bank's flags from different epochs share a pseudonym and are rejected", () => {
    const w = new World().register('A', 'B', 'D');
    const a0 = w.flag('A', S);
    w.advanceEpochs(1);
    const a1 = w.flag('A', S);
    w.flag('B', S);
    expect(() => w.attest('D', S, [w.slotFrom(a0), w.slotFrom(a1), w.slotOf('B', S)])).toThrow('dup');
  });

  it('a bank cannot mint a second pseudonym for the same subject', () => {
    // A slot claiming a fresh pseudonym must still hash to a leaf that exists in the tree.
    const w = new World().register('A', 'B', 'D');
    const a = w.flag('A', S);
    w.flag('B', S);
    const fake = { ...w.slotFrom(a), pseudonym: new Uint8Array(32).fill(9) };
    expect(() => w.attest('D', S, [w.slotFrom(a), fake, w.slotOf('B', S)])).toThrow('slot mismatch');
  });

  it('spamming within an epoch hits the nullifier, then the quota', () => {
    const w = new World({ flagQuota: 3n }).register('A');
    w.flag('A', S);
    expect(() => w.flag('A', S)).toThrow('duplicate flag');
    w.flag('A', subject('x1'));
    w.flag('A', subject('x2'));
    expect(() => w.flag('A', subject('x3'))).toThrow('quota');
  });
});
