// SPDX-License-Identifier: Apache-2.0
// Static rules from the Midnight security checklist (§5.3, §11), checked on the contract source.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const src = readFileSync(new URL('../../mulenet.compact', import.meta.url), 'utf8').replace(/\/\/.*$/gm, '');

describe('static contract rules', () => {
  it('no Set or Map is keyed by a type containing Field (node 1.0.400 advisory)', () => {
    const keys = [...src.matchAll(/\b(Set|Map)<\s*([^,>]+)/g)].map((m) => m[2]);
    expect(keys.length).toBeGreaterThan(0);
    for (const k of keys) expect(k).not.toMatch(/Field/);
  });

  it('every assert message is a static string literal', () => {
    const asserts = [...src.matchAll(/\bassert\(/g)].length;
    const literal = [...src.matchAll(/\bassert\([\s\S]*?,\s*"[^"$`]*"\);/g)].length;
    expect(asserts).toBeGreaterThan(30);
    expect(literal).toBe(asserts);
  });

  it('nothing uses non-persistent (upgrade-unstable) hashes', () => {
    expect(src).not.toMatch(/transient(Hash|Commit)/);
  });

  it('domain strings are unique and fit in 32 bytes', () => {
    const domains = [...src.matchAll(/pad\(32,\s*"([^"]+)"\)/g)].map((m) => m[1]);
    expect(domains.length).toBeGreaterThanOrEqual(12);
    expect(new Set(domains).size).toBe(domains.length);
    for (const d of domains) expect(Buffer.byteLength(d)).toBeLessThanOrEqual(32);
  });

  it('witnesses are only the two secrets', () => {
    const witnesses = [...src.matchAll(/^witness\s+(\w+)/gm)].map((m) => m[1]);
    expect(witnesses).toEqual(['institutionSecret', 'guardianSecret']);
  });
});
