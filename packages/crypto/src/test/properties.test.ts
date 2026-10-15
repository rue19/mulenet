import { sha256 } from '@noble/hashes/sha2.js';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { equal, le32 } from '../bytes.js';
import { combineAndDecrypt, dealGuardianKeys, decryptionShare, encrypt } from '../elgamal.js';
import { normalise } from '../normalise.js';
import { openRecord, sealRecord } from '../records.js';
import { ORDER, dealShares, reconstruct } from '../shamir.js';

const bytes32 = fc.uint8Array({ minLength: 32, maxLength: 32 });

describe('properties', () => {
  it('Shamir: any t-subset of shares reconstructs the secret', () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 0n, max: ORDER - 1n }), fc.integer({ min: 1, max: 5 }), fc.integer({ min: 0, max: 4 }), (s, t, extra) => {
        const n = t + extra;
        const shares = dealShares(s, t, n);
        const pick = fc.sample(fc.shuffledSubarray(shares, { minLength: t, maxLength: t }), 1)[0];
        return reconstruct(pick) === s;
      }),
      { numRuns: 100 },
    );
  });

  it('records: open(seal(x)) = x for arbitrary bodies', () => {
    fc.assert(
      fc.property(bytes32, bytes32, fc.uint8Array({ minLength: 1, maxLength: 300 }), fc.nat(2 ** 32 - 1), fc.nat(255), fc.nat(2 ** 20 - 1), (t, p, ct, epoch, typology, index) => {
        const body = { p, epoch, typology, ctHash: sha256(ct), ct, index, flaggedAt: 1_800_000_000 };
        return JSON.stringify(openRecord(t, sealRecord(t, body))) === JSON.stringify(body);
      }),
      { numRuns: 200 },
    );
  });

  it('threshold ElGamal: decrypt(encrypt(m)) = m', () => {
    const keys = dealGuardianKeys(2, 3);
    const pubs = keys.shares.map(({ index, publicKey }) => ({ index, publicKey }));
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 512 }), fc.constantFrom([0, 1], [0, 2], [1, 2]), (m, pair) => {
        const ct = encrypt(keys.groupPublicKey, m);
        return equal(combineAndDecrypt(ct, pubs, pair.map((i) => decryptionShare(keys.shares[i], ct)), 2), m);
      }),
      { numRuns: 30 },
    );
  });

  it('normalisation is insensitive to whitespace and case where the spec says so', () => {
    fc.assert(
      fc.property(fc.stringMatching(/^[0-9]{9,18}$/), fc.constantFrom('', ' ', '  '), (acct, sp) => {
        const spaced = acct.split('').join(sp);
        return (
          normalise({ kind: 'IN', ifsc: 'icic0000104', account: spaced }) ===
          normalise({ kind: 'IN', ifsc: 'ICIC0000104', account: acct })
        );
      }),
    );
  });

  it('le32 is injective and little-endian', () => {
    fc.assert(fc.property(fc.bigInt({ min: 0n, max: (1n << 64n) - 1n }), (x) => le32(x)[0] === Number(x & 0xffn)));
    expect(() => le32(-1n)).toThrow();
  });
});
