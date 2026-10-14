// SPDX-License-Identifier: Apache-2.0
// Threshold ElGamal KEM + XChaCha20-Poly1305 for case details and escalations (§5.5).
// The guardian group key is 2-of-3 Shamir-shared (trusted dealer for now). Decryption shares
// D_i = x_i·C1 carry a DLEQ proof against the guardian's public share X_i = x_i·G.
//
//   ct     = C1 (32) ‖ nonce (24) ‖ AEAD(key, nonce, plaintext, aad = C1)
//   key    = HKDF-SHA256(ikm = e·X, salt = C1, info = "mulenet:kem:v1")
//   ctHash = SHA-256(ct)          — committed inside the flag leaf
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { ristretto255 } from '@noble/curves/ed25519.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { randomBytes } from '@noble/hashes/utils.js';
import { type Bytes, concat, utf8 } from './bytes.js';
import { decodeCbor, encodeCbor } from './cbor.js';
import { proveDleq, verifyDleq } from './dleq.js';
import { dealShares, lagrangeAtZero, randomScalar, scalarFromBytes, scalarToBytes } from './shamir.js';

const Point = ristretto255.Point;
const KEM_INFO = utf8('mulenet:kem:v1');
const HEADER = 32 + 24;

export type GuardianKeyShare = { index: number; secretKey: Bytes; publicKey: Bytes };
export type GuardianPublicShare = { index: number; publicKey: Bytes };
export type GuardianKeySet = { threshold: number; groupPublicKey: Bytes; shares: GuardianKeyShare[] };
export type DecryptionShare = { index: number; share: Bytes; proof: Bytes };

export class DecryptionError extends Error {}

export const dealGuardianKeys = (threshold = 2, n = 3, secret = randomScalar()): GuardianKeySet => ({
  threshold,
  groupPublicKey: Point.BASE.multiply(secret).toBytes(),
  shares: dealShares(secret, threshold, n).map((s) => ({
    index: s.index,
    secretKey: scalarToBytes(s.value),
    publicKey: Point.BASE.multiply(s.value).toBytes(),
  })),
});

const kemKey = (shared: Bytes, c1: Bytes) => hkdf(sha256, shared, c1, KEM_INFO, 32);

export const encrypt = (groupPublicKey: Bytes, plaintext: Bytes): Bytes => {
  const e = randomScalar();
  const c1 = Point.BASE.multiply(e).toBytes();
  const shared = Point.fromBytes(groupPublicKey).multiply(e).toBytes();
  const nonce = randomBytes(24);
  return concat(c1, nonce, xchacha20poly1305(kemKey(shared, c1), nonce, c1).encrypt(plaintext));
};

export const ctHash = (ct: Bytes): Bytes => sha256(ct);

const split = (ct: Bytes) => {
  if (ct.length < HEADER + 16) throw new DecryptionError('ciphertext too short');
  return { c1: ct.subarray(0, 32), nonce: ct.subarray(32, HEADER), body: ct.subarray(HEADER) };
};

// Guardian side. Policy (only for warrant-authorised ciphertexts, §7.6) is enforced by the daemon.
export const decryptionShare = (key: GuardianKeyShare, ct: Bytes): DecryptionShare => {
  const { c1 } = split(ct);
  const x = scalarFromBytes(key.secretKey);
  return { index: key.index, share: Point.fromBytes(c1).multiply(x).toBytes(), proof: proveDleq(x, c1) };
};

export const verifyDecryptionShare = (pub: GuardianPublicShare, ct: Bytes, ds: DecryptionShare): boolean => {
  if (pub.index !== ds.index) return false;
  try {
    return verifyDleq(pub.publicKey, split(ct).c1, ds.share, ds.proof);
  } catch {
    return false;
  }
};

export const combineAndDecrypt = (
  ct: Bytes,
  publicShares: GuardianPublicShare[],
  shares: DecryptionShare[],
  threshold: number,
): Bytes => {
  const valid: DecryptionShare[] = [];
  for (const ds of shares) {
    const pub = publicShares.find((p) => p.index === ds.index);
    if (!pub || valid.some((v) => v.index === ds.index) || !verifyDecryptionShare(pub, ct, ds)) continue;
    valid.push(ds);
    if (valid.length === threshold) break;
  }
  if (valid.length < threshold) throw new DecryptionError(`need ${threshold} valid decryption shares, got ${valid.length}`);

  const { c1, nonce, body } = split(ct);
  const idx = valid.map((v) => v.index);
  const shared = valid
    .reduce((acc, v) => acc.add(Point.fromBytes(v.share).multiply(lagrangeAtZero(v.index, idx))), Point.ZERO)
    .toBytes();
  try {
    return xchacha20poly1305(kemKey(shared, c1), nonce, c1).decrypt(body);
  } catch {
    throw new DecryptionError('authentication failed');
  }
};

// ── typed payloads ──

export type CaseDetails = {
  institutionId: string;
  caseRef: string;
  typology: number;
  evidenceSummary: string;
  contactRef: string;
};

export type EscalationDetails = {
  identifier: string; // canonical mulenet-id/v1
  tag: Bytes; // T
  leafIndices: number[];
  institutionId: string;
  caseRef: string;
};

export const encryptObject = <T>(groupPublicKey: Bytes, obj: T): { ct: Bytes; ctHash: Bytes } => {
  const ct = encrypt(groupPublicKey, encodeCbor(obj));
  return { ct, ctHash: ctHash(ct) };
};

export const decryptObject = <T>(ct: Bytes, pubs: GuardianPublicShare[], shares: DecryptionShare[], threshold: number): T =>
  decodeCbor<T>(combineAndDecrypt(ct, pubs, shares, threshold));
