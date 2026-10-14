// SPDX-License-Identifier: Apache-2.0
// t-of-n Shamir sharing over the ristretto255 scalar field. Used for the OPRF key (§5.2)
// and the guardian decryption key (§5.5). Trusted-dealer keygen for the hackathon (§8.2);
// production replaces dealShares with a Pedersen DKG.
import { ristretto255 } from '@noble/curves/ed25519.js';
import { randomBytes } from '@noble/hashes/utils.js';

export const ORDER = ristretto255.Point.Fn.ORDER;
export const mod = (a: bigint): bigint => ((a % ORDER) + ORDER) % ORDER;

// Uniform non-zero scalar: 64 random bytes reduced mod ORDER (bias < 2^-250).
export const randomScalar = (): bigint => {
  for (;;) {
    const s = mod(bytesToBigLE(randomBytes(64)));
    if (s !== 0n) return s;
  }
};

export const invert = (a: bigint): bigint => {
  if (mod(a) === 0n) throw new Error('cannot invert zero');
  return modPow(mod(a), ORDER - 2n);
};

const modPow = (b: bigint, e: bigint): bigint => {
  let r = 1n;
  let x = mod(b);
  while (e > 0n) {
    if (e & 1n) r = (r * x) % ORDER;
    x = (x * x) % ORDER;
    e >>= 1n;
  }
  return r;
};

export const bytesToBigLE = (b: Uint8Array): bigint => {
  let v = 0n;
  for (let i = b.length - 1; i >= 0; i--) v = (v << 8n) | BigInt(b[i]);
  return v;
};

export const scalarToBytes = (s: bigint): Uint8Array => {
  const out = new Uint8Array(32);
  let v = mod(s);
  for (let i = 0; i < 32; i++) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
};

export const scalarFromBytes = (b: Uint8Array): bigint => {
  if (b.length !== 32) throw new Error('scalar must be 32 bytes');
  const v = bytesToBigLE(b);
  if (v >= ORDER) throw new Error('non-canonical scalar');
  return v;
};

export type Share = { index: number; value: bigint };

export const dealShares = (secret: bigint, threshold: number, n: number): Share[] => {
  if (!(threshold >= 1 && threshold <= n && n < 256)) throw new Error('bad threshold parameters');
  const coeffs = [mod(secret), ...Array.from({ length: threshold - 1 }, randomScalar)];
  return Array.from({ length: n }, (_, i) => {
    const x = BigInt(i + 1);
    let y = 0n;
    for (let j = coeffs.length - 1; j >= 0; j--) y = mod(y * x + coeffs[j]);
    return { index: i + 1, value: y };
  });
};

// Lagrange coefficient for share `index` at x = 0, over the given set of share indices.
export const lagrangeAtZero = (index: number, indices: number[]): bigint => {
  if (new Set(indices).size !== indices.length) throw new Error('duplicate share index');
  if (!indices.includes(index)) throw new Error('index not in set');
  let num = 1n;
  let den = 1n;
  for (const j of indices) {
    if (j === index) continue;
    num = mod(num * BigInt(j));
    den = mod(den * BigInt(j - index));
  }
  return mod(num * invert(den));
};

export const reconstruct = (shares: Share[]): bigint => {
  const idx = shares.map((s) => s.index);
  return shares.reduce((acc, s) => mod(acc + s.value * lagrangeAtZero(s.index, idx)), 0n);
};
