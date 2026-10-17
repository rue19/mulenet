// SPDX-License-Identifier: Apache-2.0
// Threat: integer edge cases (Compact aborts on underflow; casts are range-checked).
import { describe, expect, it } from 'vitest';
import { World, bytes, subject } from '../world.js';

describe('adversarial: arithmetic and bounds', () => {
  it('quota slot at the bound is rejected; just below is accepted', () => {
    const w = new World({ flagQuota: 10n }).register('A');
    expect(() => w.flag('A', subject('a'), 1n, { quotaSlot: 10n })).toThrow('quota');
    expect(() => w.flag('A', subject('b'), 1n, { quotaSlot: 9n })).not.toThrow();
  });

  it('quota slot beyond Uint<16> is rejected by the runtime', () => {
    const w = new World().register('A');
    expect(() => w.flag('A', subject('c'), 1n, { quotaSlot: 65_536n })).toThrow();
  });

  it('typology beyond Uint<8> is rejected by the runtime', () => {
    const w = new World().register('A');
    expect(() => w.asBank('A').call('submitFlag', subject('d'), 256n, bytes(), 0n, w.institutionPath('A'))).toThrow();
  });

  it('a revocation index beyond the tree is rejected', () => {
    const w = new World().register('A');
    w.flag('A', subject('e'));
    expect(() => w.revoke('A', subject('e'), { index: 1n << 20n })).toThrow();
  });

  it('epochs advance one at a time and never early', () => {
    const w = new World();
    w.advanceEpochs(1);
    expect(() => w.as({}).call('advanceEpoch')).toThrow('too early');
    expect(w.state.currentEpoch).toBe(1n);
  });

  it('constructor rejects out-of-range parameters', () => {
    expect(() => new World({ threshold: 0n })).toThrow('bad threshold');
    expect(() => new World({ threshold: 4n })).toThrow('bad threshold');
    expect(() => new World({ k: 1n })).toThrow('bad k');
    expect(() => new World({ ttl: 0n })).toThrow('bad ttl');
    expect(() => new World({ flagQuota: 0n })).toThrow('bad quota');
  });
});
