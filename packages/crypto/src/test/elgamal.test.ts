import { ristretto255 } from '@noble/curves/ed25519.js';
import { describe, expect, it } from 'vitest';
import { equal, toHex, utf8 } from '../bytes.js';
import { proveDleq, verifyDleq } from '../dleq.js';
import {
  DecryptionError,
  combineAndDecrypt,
  ctHash,
  dealGuardianKeys,
  decryptObject,
  decryptionShare,
  encrypt,
  encryptObject,
  verifyDecryptionShare,
  type CaseDetails,
} from '../elgamal.js';
import { randomScalar } from '../shamir.js';

const G = ristretto255.Point.BASE;
const keys = dealGuardianKeys(2, 3);
const pubs = keys.shares.map(({ index, publicKey }) => ({ index, publicKey }));
const msg = utf8('flagged by Bank A, case FRM-2026-0042');

describe('DLEQ proofs', () => {
  it('verifies an honest proof', () => {
    const x = randomScalar();
    const C = G.multiply(randomScalar());
    expect(verifyDleq(G.multiply(x).toBytes(), C.toBytes(), C.multiply(x).toBytes(), proveDleq(x, C.toBytes()))).toBe(true);
  });

  it('rejects unequal logs', () => {
    const x = randomScalar();
    const C = G.multiply(randomScalar());
    expect(verifyDleq(G.multiply(x).toBytes(), C.toBytes(), C.multiply(randomScalar()).toBytes(), proveDleq(x, C.toBytes()))).toBe(false);
  });

  it('rejects malformed proofs', () => {
    const x = randomScalar();
    const C = G.multiply(randomScalar());
    const args = [G.multiply(x).toBytes(), C.toBytes(), C.multiply(x).toBytes()] as const;
    expect(verifyDleq(...args, new Uint8Array(63))).toBe(false);
    expect(verifyDleq(...args, new Uint8Array(64).fill(0xff))).toBe(false);
  });
});

describe('threshold ElGamal', () => {
  it('decrypts with any 2 of 3 guardians', () => {
    const ct = encrypt(keys.groupPublicKey, msg);
    for (const pair of [[0, 1], [0, 2], [1, 2]]) {
      const shares = pair.map((i) => decryptionShare(keys.shares[i], ct));
      expect(equal(combineAndDecrypt(ct, pubs, shares, 2), msg)).toBe(true);
    }
  });

  it('one guardian alone cannot decrypt', () => {
    const ct = encrypt(keys.groupPublicKey, msg);
    expect(() => combineAndDecrypt(ct, pubs, [decryptionShare(keys.shares[0], ct)], 2)).toThrow(DecryptionError);
  });

  it('rejects a share with a forged proof and still decrypts from honest ones', () => {
    const ct = encrypt(keys.groupPublicKey, msg);
    const bad = { ...decryptionShare(keys.shares[0], ct), share: G.toBytes() };
    expect(verifyDecryptionShare(pubs[0], ct, bad)).toBe(false);
    expect(() => combineAndDecrypt(ct, pubs, [bad, decryptionShare(keys.shares[1], ct)], 2)).toThrow(DecryptionError);
    const ok = [bad, decryptionShare(keys.shares[1], ct), decryptionShare(keys.shares[2], ct)];
    expect(equal(combineAndDecrypt(ct, pubs, ok, 2), msg)).toBe(true);
  });

  it('rejects a share presented under another guardian index', () => {
    const ct = encrypt(keys.groupPublicKey, msg);
    const swapped = { ...decryptionShare(keys.shares[0], ct), index: 2 };
    expect(verifyDecryptionShare(pubs[1], ct, swapped)).toBe(false);
  });

  it('a share for one ciphertext does not verify for another', () => {
    const ct1 = encrypt(keys.groupPublicKey, msg);
    const ct2 = encrypt(keys.groupPublicKey, msg);
    expect(verifyDecryptionShare(pubs[0], ct2, decryptionShare(keys.shares[0], ct1))).toBe(false);
  });

  it('detects ciphertext tampering', () => {
    const ct = encrypt(keys.groupPublicKey, msg);
    const t = ct.slice();
    t[t.length - 1] ^= 1;
    const shares = [0, 1].map((i) => decryptionShare(keys.shares[i], t));
    expect(() => combineAndDecrypt(t, pubs, shares, 2)).toThrow(DecryptionError);
  });

  it('ciphertexts are randomised and ctHash binds the exact bytes', () => {
    const a = encrypt(keys.groupPublicKey, msg);
    const b = encrypt(keys.groupPublicKey, msg);
    expect(equal(a, b)).toBe(false);
    expect(toHex(ctHash(a))).not.toBe(toHex(ctHash(b)));
    expect(ctHash(a).length).toBe(32);
  });

  it('round-trips typed case details', () => {
    const details: CaseDetails = {
      institutionId: 'bank-a',
      caseRef: 'FRM-2026-0042',
      typology: 1,
      evidenceSummary: 'rapid inbound/outbound',
      contactRef: 'fraud-ops@bank-a',
    };
    const { ct, ctHash: h } = encryptObject(keys.groupPublicKey, details);
    expect(equal(h, ctHash(ct))).toBe(true);
    const shares = [1, 2].map((i) => decryptionShare(keys.shares[i], ct));
    expect(decryptObject<CaseDetails>(ct, pubs, shares, 2)).toEqual(details);
  });

  it('rejects a truncated ciphertext', () => {
    expect(() => decryptionShare(keys.shares[0], new Uint8Array(40))).toThrow(DecryptionError);
  });
});
