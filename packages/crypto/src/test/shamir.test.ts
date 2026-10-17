// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { ORDER, dealShares, invert, lagrangeAtZero, mod, randomScalar, reconstruct, scalarFromBytes, scalarToBytes } from '../shamir.js';

describe('Shamir over the ristretto255 scalar field', () => {
  it('reconstructs from any t of n shares', () => {
    const s = randomScalar();
    const shares = dealShares(s, 3, 5);
    for (const pick of [[0, 1, 2], [0, 2, 4], [4, 3, 1]]) {
      expect(reconstruct(pick.map((i) => shares[i]))).toBe(s);
    }
  });

  it('fewer than t shares do not reconstruct', () => {
    const s = randomScalar();
    const shares = dealShares(s, 3, 5);
    expect(reconstruct(shares.slice(0, 2))).not.toBe(s);
  });

  it('Lagrange coefficients at zero sum to 1', () => {
    const idx = [1, 3, 4];
    expect(mod(idx.reduce((a, i) => a + lagrangeAtZero(i, idx), 0n))).toBe(1n);
  });

  it('rejects duplicate indices', () => {
    expect(() => lagrangeAtZero(1, [1, 1, 2])).toThrow('duplicate');
  });

  it('rejects bad threshold parameters', () => {
    expect(() => dealShares(1n, 0, 3)).toThrow();
    expect(() => dealShares(1n, 4, 3)).toThrow();
  });

  it('inverts and round-trips scalar encodings', () => {
    const a = randomScalar();
    expect(mod(a * invert(a))).toBe(1n);
    expect(scalarFromBytes(scalarToBytes(a))).toBe(a);
    expect(() => scalarFromBytes(scalarToBytes(0n).fill(0xff))).toThrow('non-canonical');
    expect(() => invert(ORDER)).toThrow();
  });
});
