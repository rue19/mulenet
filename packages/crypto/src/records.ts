// SPDX-License-Identifier: Apache-2.0
// Encrypted flag records held by the relay (§5.4). Anyone who can compute T for an account
// can find and read its records; the relay sees only bucket numbers and opaque bytes.
//
//   lookupKey = HKDF-SHA256(T, info = "mulenet:lookup:v1")
//   bucket    = big-endian u16 of lookupKey[0..2]          (65,536 buckets)
//   recKey    = HKDF-SHA256(T, info = "mulenet:rec:v1")
//   body      = XChaCha20-Poly1305(recKey, nonce, CBOR(FlagRecordBody), aad = v ‖ bucket ‖ lookupKey)
// The body carries the guardian-encrypted case details (ct) so a warrant can retrieve them;
// opening a record checks SHA-256(ct) = ctHash, the value committed in the on-chain leaf.
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { randomBytes } from '@noble/hashes/utils.js';
import { type Bytes, assertLen, concat, equal, utf8 } from './bytes.js';
import { decodeCbor, encodeCbor } from './cbor.js';

export const RECORD_VERSION = 1;

export type FlagRecordBody = {
  p: Bytes; // pseudonym
  epoch: number;
  typology: number;
  ctHash: Bytes;
  ct: Bytes; // case-detail ciphertext, encrypted to the guardian group key; SHA-256(ct) = ctHash
  index: number; // leaf position in the flag tree
  flaggedAt: number; // unix seconds
};

export type FlagRecord = { v: number; bucket: number; lookupKey: Bytes; nonce: Bytes; body: Bytes };

export type RecordKeys = { lookupKey: Bytes; bucket: number; recKey: Bytes };

export const recordKeys = (tag: Bytes): RecordKeys => {
  assertLen(tag, 32, 'subject tag');
  const lookupKey = hkdf(sha256, tag, undefined, utf8('mulenet:lookup:v1'), 32);
  return {
    lookupKey,
    bucket: (lookupKey[0] << 8) | lookupKey[1],
    recKey: hkdf(sha256, tag, undefined, utf8('mulenet:rec:v1'), 32),
  };
};

const aad = (v: number, bucket: number, lookupKey: Bytes) => concat(Uint8Array.of(v, bucket >> 8, bucket & 0xff), lookupKey);

export const sealRecord = (tag: Bytes, body: FlagRecordBody): FlagRecord => {
  const { lookupKey, bucket, recKey } = recordKeys(tag);
  const nonce = randomBytes(24);
  const sealed = xchacha20poly1305(recKey, nonce, aad(RECORD_VERSION, bucket, lookupKey)).encrypt(encodeCbor(body));
  return { v: RECORD_VERSION, bucket, lookupKey, nonce, body: sealed };
};

export class RecordError extends Error {}

export const openRecord = (tag: Bytes, rec: FlagRecord): FlagRecordBody => {
  const { lookupKey, bucket, recKey } = recordKeys(tag);
  if (rec.v !== RECORD_VERSION) throw new RecordError('unsupported record version');
  if (rec.bucket !== bucket || !equal(rec.lookupKey, lookupKey)) throw new RecordError('record is for another subject');
  let body: FlagRecordBody;
  try {
    body = decodeCbor<FlagRecordBody>(xchacha20poly1305(recKey, rec.nonce, aad(rec.v, rec.bucket, rec.lookupKey)).decrypt(rec.body));
  } catch {
    throw new RecordError('authentication failed');
  }
  const asBytes = (b: unknown) => new Uint8Array(b as ArrayLike<number>);
  body = { ...body, p: asBytes(body.p), ctHash: asBytes(body.ctHash), ct: asBytes(body.ct) };
  if (!equal(sha256(body.ct), body.ctHash)) throw new RecordError('ciphertext does not match its hash');
  return body;
};

// Records in a fetched bucket that belong to this subject. Others are ignored, not errors.
export const openBucket = (tag: Bytes, records: FlagRecord[]): FlagRecordBody[] => {
  const { lookupKey } = recordKeys(tag);
  return records.filter((r) => equal(r.lookupKey, lookupKey)).flatMap((r) => {
    try {
      return [openRecord(tag, r)];
    } catch {
      return [];
    }
  });
};

export const encodeRecord = (r: FlagRecord): Bytes => encodeCbor(r);
export const decodeRecord = (b: Bytes): FlagRecord => {
  const r = decodeCbor<FlagRecord>(b);
  return { ...r, lookupKey: new Uint8Array(r.lookupKey), nonce: new Uint8Array(r.nonce), body: new Uint8Array(r.body) };
};
// Content address used by the append-only relay (§8.3).
export const recordId = (r: FlagRecord): Bytes => sha256(encodeRecord(r));
