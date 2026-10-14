// SPDX-License-Identifier: Apache-2.0
// Chaum–Pedersen proof that log_G(Y) = log_C(D) over ristretto255, made non-interactive with
// Fiat–Shamir. Guardians attach one to every decryption share (§5.5), so a combiner can
// reject a wrong share instead of silently producing garbage.
import { ristretto255 } from '@noble/curves/ed25519.js';
import { sha512 } from '@noble/hashes/sha2.js';
import { type Bytes, concat, utf8 } from './bytes.js';
import { bytesToBigLE, mod, randomScalar, scalarFromBytes, scalarToBytes } from './shamir.js';

const Point = ristretto255.Point;
type P = InstanceType<typeof Point>;

const DOMAIN = utf8('mulenet:dleq:v1');

const challenge = (G: P, Y: P, C: P, D: P, A1: P, A2: P): bigint =>
  mod(bytesToBigLE(sha512(concat(DOMAIN, ...[G, Y, C, D, A1, A2].map((p) => p.toBytes())))));

// Proof = c ‖ s, 64 bytes. Points are passed encoded.
export const proveDleq = (x: bigint, cBytes: Bytes): Bytes => {
  const G = Point.BASE;
  const C = Point.fromBytes(cBytes);
  const r = randomScalar();
  const c = challenge(G, G.multiply(x), C, C.multiply(x), G.multiply(r), C.multiply(r));
  return concat(scalarToBytes(c), scalarToBytes(mod(r - c * x)));
};

export const verifyDleq = (yBytes: Bytes, cBytes: Bytes, dBytes: Bytes, proof: Bytes): boolean => {
  if (proof.length !== 64) return false;
  try {
    const [Y, C, D] = [yBytes, cBytes, dBytes].map((b) => Point.fromBytes(b));
    const c = scalarFromBytes(proof.subarray(0, 32));
    const s = scalarFromBytes(proof.subarray(32));
    const G = Point.BASE;
    // A1 = s·G + c·Y, A2 = s·C + c·D; reject identity commitments from multiply(0).
    const A1 = (s === 0n ? Point.ZERO : G.multiply(s)).add(c === 0n ? Point.ZERO : Y.multiply(c));
    const A2 = (s === 0n ? Point.ZERO : C.multiply(s)).add(c === 0n ? Point.ZERO : D.multiply(c));
    return challenge(G, Y, C, D, A1, A2) === c;
  } catch {
    return false;
  }
};
