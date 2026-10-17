// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { IdentifierError, isCanonical, normalise, oprfInput, type Identifier } from '../normalise.js';

// Test vectors for mulenet-id/v1 (§5.1). Every institution's implementation must match these.
const VALID: [Identifier, string][] = [
  [{ kind: 'IN', ifsc: 'HDFC0001234', account: '50100123456789' }, 'acct:v1:IN:HDFC0001234:50100123456789'],
  [{ kind: 'IN', ifsc: ' hdfc0001234 ', account: '5010 0123 4567 89' }, 'acct:v1:IN:HDFC0001234:50100123456789'],
  [{ kind: 'IN', ifsc: 'SBIN0ABC123', account: '000123456' }, 'acct:v1:IN:SBIN0ABC123:000123456'],
  [{ kind: 'VPA', vpa: 'rahul.k@okaxis' }, 'vpa:v1:rahul.k@okaxis'],
  [{ kind: 'VPA', vpa: '  Rahul.K@OkAxis ' }, 'vpa:v1:rahul.k@okaxis'],
  [{ kind: 'VPA', vpa: '9876543210@ybl' }, 'vpa:v1:9876543210@ybl'],
  [{ kind: 'GB', sortCode: '40-12-76', account: '12345678' }, 'acct:v1:GB:401276:12345678'],
  [{ kind: 'GB', sortCode: '40 12 76', account: '1234 5678' }, 'acct:v1:GB:401276:12345678'],
];

const INVALID: Identifier[] = [
  { kind: 'IN', ifsc: 'HDFC1001234', account: '50100123456789' }, // 5th char must be 0
  { kind: 'IN', ifsc: 'HDF0001234', account: '50100123456789' }, // too short
  { kind: 'IN', ifsc: 'HDFC0001234', account: '1234' }, // too short
  { kind: 'IN', ifsc: 'HDFC0001234', account: '5010-0123-4567' }, // hyphens not accepted
  { kind: 'IN', ifsc: 'HDFC0001234', account: '1234567890123456789' }, // 19 digits
  { kind: 'VPA', vpa: 'rahul@' },
  { kind: 'VPA', vpa: 'rahul k@okaxis' },
  { kind: 'VPA', vpa: 'rahul@ok-axis' },
  { kind: 'VPA', vpa: '@okaxis' },
  { kind: 'GB', sortCode: '4012', account: '12345678' },
  { kind: 'GB', sortCode: '401276', account: '1234567' },
];

describe('mulenet-id/v1 normalisation', () => {
  it.each(VALID)('normalises %j', (id, expected) => {
    expect(normalise(id)).toBe(expected);
    expect(isCanonical(expected)).toBe(true);
  });

  it.each(INVALID)('rejects %j', (id) => {
    expect(() => normalise(id)).toThrow(IdentifierError);
  });

  it('only canonical strings become OPRF input', () => {
    expect(() => oprfInput('HDFC0001234:50100123456789')).toThrow(IdentifierError);
    expect(new TextDecoder().decode(oprfInput('vpa:v1:rahul.k@okaxis'))).toBe('vpa:v1:rahul.k@okaxis');
  });

  it('is idempotent on its own output', () => {
    const once = normalise({ kind: 'VPA', vpa: ' A.B@OKSBI ' });
    expect(normalise({ kind: 'VPA', vpa: once.slice('vpa:v1:'.length) })).toBe(once);
  });
});
