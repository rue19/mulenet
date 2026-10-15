import { sha256 } from '@noble/hashes/sha2.js';
import { randomBytes } from '@noble/hashes/utils.js';
import { describe, expect, it } from 'vitest';
import { equal, toHex } from '../bytes.js';
import {
  RecordError,
  decodeRecord,
  encodeRecord,
  openBucket,
  openRecord,
  recordId,
  recordKeys,
  sealRecord,
  type FlagRecordBody,
} from '../records.js';

const T = randomBytes(32);
const ct = randomBytes(200);
const body: FlagRecordBody = { p: randomBytes(32), epoch: 12, typology: 1, ctHash: sha256(ct), ct, index: 1234, flaggedAt: 1_800_000_000 };

describe('relay records', () => {
  it('derives stable, distinct keys from T', () => {
    const a = recordKeys(T);
    const b = recordKeys(T);
    expect(equal(a.lookupKey, b.lookupKey)).toBe(true);
    expect(equal(a.lookupKey, a.recKey)).toBe(false);
    expect(a.bucket).toBe((a.lookupKey[0] << 8) | a.lookupKey[1]);
    expect(a.bucket).toBeLessThan(65_536);
  });

  it('round-trips through seal, wire encoding and open', () => {
    const rec = decodeRecord(encodeRecord(sealRecord(T, body)));
    expect(openRecord(T, rec)).toEqual(body);
  });

  it('cannot be opened with another subject tag', () => {
    expect(() => openRecord(randomBytes(32), sealRecord(T, body))).toThrow(RecordError);
  });

  it('detects tampering with the body', () => {
    const rec = sealRecord(T, body);
    rec.body[0] ^= 1;
    expect(() => openRecord(T, rec)).toThrow('authentication failed');
  });

  it('binds the bucket and lookup key (relay cannot move records)', () => {
    const rec = sealRecord(T, body);
    expect(() => openRecord(T, { ...rec, bucket: (rec.bucket + 1) % 65_536 })).toThrow(RecordError);
  });

  it('openBucket returns only this subject’s records and skips corrupt ones', () => {
    const other = randomBytes(32);
    const corrupt = sealRecord(T, body);
    corrupt.body[3] ^= 0xff;
    const opened = openBucket(T, [sealRecord(T, body), sealRecord(other, body), corrupt, sealRecord(T, { ...body, index: 7 })]);
    expect(opened.map((b) => b.index)).toEqual([1234, 7]);
  });

  it('record ids are content addresses', () => {
    const rec = sealRecord(T, body);
    expect(toHex(recordId(rec))).toBe(toHex(recordId(decodeRecord(encodeRecord(rec)))));
    expect(toHex(recordId(rec))).not.toBe(toHex(recordId(sealRecord(T, body))));
  });

  it('rejects a wrong-length tag', () => {
    expect(() => recordKeys(randomBytes(31))).toThrow('32 bytes');
  });
});

describe('record ciphertext binding', () => {
  it('rejects a record whose ct does not hash to its ctHash', () => {
    const rec = sealRecord(T, { ...body, ctHash: randomBytes(32) });
    expect(() => openRecord(T, rec)).toThrow('does not match');
  });
});
