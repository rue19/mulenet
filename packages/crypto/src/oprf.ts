// SPDX-License-Identifier: Apache-2.0
// Threshold VOPRF subject tags (§5.2): RFC 9497 VOPRF mode, ristretto255-SHA512, with the
// server key Shamir-shared across oracles (TOPPSS-style). Each oracle evaluates with its
// share k_i and proves it with an RFC 9497 DLEQ proof against its public share K_i = k_i·G.
// The client verifies every proof, combines t evaluations with Lagrange coefficients in the
// exponent (Σ λ_i·k_i·B = k·B), and finishes with the RFC's Finalize. The Finalize hash
// does not depend on the mode, so the result equals a single-key VOPRF under k.
import { ristretto255, ristretto255_oprf } from '@noble/curves/ed25519.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { type Bytes, concat, utf8 } from './bytes.js';
import { dealShares, lagrangeAtZero, randomScalar, scalarFromBytes, scalarToBytes, type Share } from './shamir.js';

const { voprf, oprf } = ristretto255_oprf;
const Point = ristretto255.Point;

export const MAX_BATCH = 64;

export type OracleKeyShare = { index: number; secretKey: Bytes; publicKey: Bytes };
export type OraclePublicShare = { index: number; publicKey: Bytes };
export type OracleKeySet = { threshold: number; groupPublicKey: Bytes; shares: OracleKeyShare[] };

// Trusted-dealer key generation (documented hackathon choice, §8.2).
export const dealOracleKeys = (threshold = 2, n = 3, secret = randomScalar()): OracleKeySet => ({
  threshold,
  groupPublicKey: Point.BASE.multiply(secret).toBytes(),
  shares: dealShares(secret, threshold, n).map((s: Share) => ({
    index: s.index,
    secretKey: scalarToBytes(s.value),
    publicKey: Point.BASE.multiply(s.value).toBytes(),
  })),
});

// ── oracle side ──

export type EvaluateResponse = { index: number; evaluated: Bytes[]; proof: Bytes };

export const oracleEvaluate = (key: OracleKeyShare, blinded: Bytes[]): EvaluateResponse => {
  if (blinded.length === 0 || blinded.length > MAX_BATCH) throw new Error(`batch must be 1..${MAX_BATCH}`);
  const { evaluated, proof } = voprf.blindEvaluateBatch(key.secretKey, key.publicKey, blinded);
  return { index: key.index, evaluated, proof };
};

// ── client side ──

export type BlindState = { inputs: Bytes[]; blinds: Bytes[]; blinded: Bytes[] };

export const blindInputs = (inputs: Bytes[]): BlindState => {
  if (inputs.length === 0 || inputs.length > MAX_BATCH) throw new Error(`batch must be 1..${MAX_BATCH}`);
  const bs = inputs.map((x) => voprf.blind(x));
  return { inputs, blinds: bs.map((b) => b.blind), blinded: bs.map((b) => b.blinded) };
};

export class OracleProofError extends Error {}

const verifyResponse = (st: BlindState, pub: OraclePublicShare, r: EvaluateResponse): void => {
  if (r.evaluated.length !== st.blinded.length) throw new OracleProofError(`oracle ${r.index}: wrong batch size`);
  try {
    // finalizeBatch verifies the batched DLEQ proof against K_i; its outputs are discarded.
    voprf.finalizeBatch(
      st.inputs.map((input, i) => ({ input, blind: st.blinds[i], evaluated: r.evaluated[i], blinded: st.blinded[i] })),
      pub.publicKey,
      r.proof,
    );
  } catch {
    throw new OracleProofError(`oracle ${r.index}: invalid proof`);
  }
};

// Returns the raw RFC 9497 outputs (64 bytes each). Throws unless at least `threshold`
// distinct oracles returned valid proofs.
export const combineAndFinalize = (
  st: BlindState,
  publicShares: OraclePublicShare[],
  responses: EvaluateResponse[],
  threshold: number,
): Bytes[] => {
  const valid: EvaluateResponse[] = [];
  for (const r of responses) {
    const pub = publicShares.find((p) => p.index === r.index);
    if (!pub || valid.some((v) => v.index === r.index)) continue;
    try {
      verifyResponse(st, pub, r);
      valid.push(r);
    } catch {
      // A faulty oracle is skipped; enough honest ones still suffice.
    }
    if (valid.length === threshold) break;
  }
  if (valid.length < threshold) throw new OracleProofError(`need ${threshold} valid oracle responses, got ${valid.length}`);

  const indices = valid.map((v) => v.index);
  return st.inputs.map((input, i) => {
    const Z = valid.reduce(
      (acc, v) => acc.add(Point.fromBytes(v.evaluated[i]).multiply(lagrangeAtZero(v.index, indices))),
      Point.ZERO,
    );
    return oprf.finalize(input, st.blinds[i], Z.toBytes());
  });
};

// Subject tag T (§5.2): domain-separated 32-byte digest of the RFC output.
export const TAG_DOMAIN = 'mulenet:tag:v1';
export const subjectTag = (oprfOutput: Bytes): Bytes => sha256(concat(utf8(TAG_DOMAIN), oprfOutput));

// Reference evaluation with the whole key, for tests and the trusted-dealer audit only.
export const evaluateWithKey = (secretKey: Bytes, input: Bytes): Bytes => {
  scalarFromBytes(secretKey);
  const b = voprf.blind(input);
  const pk = Point.BASE.multiply(scalarFromBytes(secretKey)).toBytes();
  const { evaluated, proof } = voprf.blindEvaluate(secretKey, pk, b.blinded);
  return voprf.finalize(input, b.blind, evaluated, b.blinded, pk, proof);
};

