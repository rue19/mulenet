// SPDX-License-Identifier: Apache-2.0
// Off-chain mirrors of every §5.3 derivation. Compact's persistentHash over Vector<n, Bytes<32>>
// is SHA-256 of the concatenated elements; contracts/src/test/crypto-parity.test.ts checks
// each function against the compiled contract's pureCircuits byte for byte.
import { sha256 } from '@noble/hashes/sha2.js';
import { type Bytes, assertLen, concat, le32, pad32 } from './bytes.js';

const H = (domain: string, ...parts: Bytes[]): Bytes => {
  parts.forEach((p) => assertLen(p, 32, 'hash input'));
  return sha256(concat(pad32(domain), ...parts));
};

export const institutionLeaf = (sk: Bytes, gen: bigint) => H('mulenet:inst:v1', sk, le32(gen));
export const guardianLeaf = (gs: Bytes) => H('mulenet:guardian:v1', gs);
export const pseudonym = (sk: Bytes, t: Bytes) => H('mulenet:pseud:v1', sk, t);
export const flagLeaf = (t: Bytes, p: Bytes, epoch: bigint, typology: bigint, ctHash: Bytes) =>
  H('mulenet:flag:v1', t, p, le32(epoch), le32(typology), ctHash);
export const flagNullifier = (sk: Bytes, t: Bytes, epoch: bigint) => H('mulenet:flagnf:v1', sk, t, le32(epoch));
export const flagQuotaNullifier = (sk: Bytes, epoch: bigint, slot: bigint) => H('mulenet:quota:v1', sk, le32(epoch), le32(slot));
export const revokeQuotaNullifier = (sk: Bytes, epoch: bigint, slot: bigint) =>
  H('mulenet:rvquota:v1', sk, le32(epoch), le32(slot));
export const attestationKey = (t: Bytes, epoch: bigint, typology: bigint) => H('mulenet:att:v1', t, le32(epoch), le32(typology));
export const querierTag = (sk: Bytes, attKey: Bytes) => H('mulenet:qtag:v1', sk, attKey);
export const proposalId = (kind: bigint, payload: Bytes, nonce: bigint) => H('mulenet:prop:v1', le32(kind), payload, le32(nonce));
export const voteNullifier = (gs: Bytes, id: Bytes) => H('mulenet:vote:v1', gs, id);
export const valueCommitment = (v: bigint) => H('mulenet:value:v1', le32(v));
