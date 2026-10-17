// SPDX-License-Identifier: Apache-2.0
// Threat: stale-member abuse. An evicted institution keeps flagging, revoking or attesting.
import { describe, expect, it } from 'vitest';
import { KIND, World, bytes, subject } from '../world.js';

const S = subject('evict');

describe('adversarial: evicted institution', () => {
  const evicted = () => {
    const w = new World().register('A', 'B', 'C', 'D');
    for (const b of ['A', 'B', 'C']) w.flag(b, S);
    const paths = { C: w.institutionPath('C'), D: w.institutionPath('D') };
    const slots = [w.slotOf('A', S), w.slotOf('B', S), w.slotOf('C', S)];
    w.govern(KIND.Rotate, bytes());
    w.register('A', 'B'); // C and D are not re-registered
    return { w, paths, slots };
  };

  it('cannot flag', () => {
    const { w, paths } = evicted();
    expect(() => w.asBank('D').call('submitFlag', subject('new'), 1n, bytes(), 0n, paths.D)).toThrow('not bound');
  });

  it('cannot attest', () => {
    const { w, paths, slots } = evicted();
    expect(() => w.asBank('D').call('attestCorroboration3', S, 1n, slots, paths.D, bytes())).toThrow('not bound');
  });

  it('cannot revoke its old flags', () => {
    const { w, paths } = evicted();
    const r = w.lastFlag('C', S);
    expect(() =>
      w.asBank('C').call('revokeFlag', S, r.epoch, r.typology, r.ctHash, r.index, 0n, w.flagPath(r.index, r.leaf), paths.C),
    ).toThrow('not bound');
  });

  it("flags it made before eviction still count for others (they were valid when made)", () => {
    const { w } = evicted();
    w.register('E');
    expect(() => w.attest('E', S, [w.slotOf('A', S), w.slotOf('B', S), w.slotOf('C', S)])).not.toThrow();
  });
});
