// SPDX-License-Identifier: Apache-2.0
// @mulenet/crypto's hash mirrors must equal the contract's pureCircuits byte for byte;
// otherwise off-chain code computes leaves and keys the circuits will never accept.
import { hash } from '@mulenet/crypto';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { pureCircuits as pc } from '../managed/mulenet/contract/index.js';

const b32 = fc.uint8Array({ minLength: 32, maxLength: 32 });
const u8 = fc.bigInt({ min: 0n, max: 255n });
const u16 = fc.bigInt({ min: 0n, max: 65_535n });
const u32 = fc.bigInt({ min: 0n, max: 2n ** 32n - 1n });
const u64 = fc.bigInt({ min: 0n, max: 2n ** 64n - 1n });
const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');
const same = (a: Uint8Array, b: Uint8Array) => hex(a) === hex(b);
const runs = { numRuns: 50 };

describe('@mulenet/crypto hash parity with the compiled contract', () => {
  it('institutionLeaf', () => fc.assert(fc.property(b32, u32, (sk, g) => same(hash.institutionLeaf(sk, g), pc.institutionLeaf(sk, g))), runs));
  it('guardianLeaf', () => fc.assert(fc.property(b32, (g) => same(hash.guardianLeaf(g), pc.guardianLeaf(g))), runs));
  it('pseudonym', () => fc.assert(fc.property(b32, b32, (sk, t) => same(hash.pseudonym(sk, t), pc.pseudonym(sk, t))), runs));
  it('flagLeaf', () =>
    fc.assert(
      fc.property(b32, b32, u32, u8, b32, (t, p, e, ty, ct) => same(hash.flagLeaf(t, p, e, ty, ct), pc.flagLeaf(t, p, e, ty, ct))),
      runs,
    ));
  it('flagNullifier', () => fc.assert(fc.property(b32, b32, u32, (sk, t, e) => same(hash.flagNullifier(sk, t, e), pc.flagNullifier(sk, t, e))), runs));
  it('flagQuotaNullifier', () =>
    fc.assert(fc.property(b32, u32, u16, (sk, e, s) => same(hash.flagQuotaNullifier(sk, e, s), pc.flagQuotaNullifier(sk, e, s))), runs));
  it('revokeQuotaNullifier', () =>
    fc.assert(fc.property(b32, u32, u16, (sk, e, s) => same(hash.revokeQuotaNullifier(sk, e, s), pc.revokeQuotaNullifier(sk, e, s))), runs));
  it('attestationKey', () =>
    fc.assert(fc.property(b32, u32, u8, (t, e, ty) => same(hash.attestationKey(t, e, ty), pc.attestationKey(t, e, ty))), runs));
  it('querierTag', () => fc.assert(fc.property(b32, b32, (sk, k) => same(hash.querierTag(sk, k), pc.querierTag(sk, k))), runs));
  it('proposalId', () =>
    fc.assert(fc.property(u8, b32, u64, (k, p, n) => same(hash.proposalId(k, p, n), pc.proposalId(k, p, n))), runs));
  it('voteNullifier', () => fc.assert(fc.property(b32, b32, (g, id) => same(hash.voteNullifier(g, id), pc.voteNullifier(g, id))), runs));
  it('valueCommitment', () => fc.assert(fc.property(u32, (v) => same(hash.valueCommitment(v), pc.valueCommitment(v))), runs));

  it('every domain string fits in 32 bytes', () => {
    expect(() => hash.revokeQuotaNullifier(new Uint8Array(32), 0n, 0n)).not.toThrow();
  });
});
