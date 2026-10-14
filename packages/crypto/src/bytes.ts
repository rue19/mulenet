// SPDX-License-Identifier: Apache-2.0
export type Bytes = Uint8Array;

export const utf8 = (s: string): Bytes => new TextEncoder().encode(s);

export const concat = (...parts: Bytes[]): Bytes => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
};

export const toHex = (b: Bytes): string => Buffer.from(b).toString('hex');

export const fromHex = (h: string): Bytes => {
  if (!/^([0-9a-f]{2})*$/i.test(h)) throw new Error('invalid hex');
  return new Uint8Array(Buffer.from(h, 'hex'));
};

export const equal = (a: Bytes, b: Bytes): boolean => a.length === b.length && a.every((v, i) => v === b[i]);

// Compact `pad(32, "…")`: UTF-8 bytes, zero-padded on the right. Strings must fit (§5.3 rule).
export const pad32 = (s: string): Bytes => {
  const b = utf8(s);
  if (b.length > 32) throw new Error('domain string longer than 32 bytes');
  const out = new Uint8Array(32);
  out.set(b);
  return out;
};

// Compact `(x as Field) as Bytes<32>`: 32-byte little-endian.
export const le32 = (x: bigint | number): Bytes => {
  let v = BigInt(x);
  if (v < 0n || v >= 1n << 256n) throw new Error('integer out of range');
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
};

export const assertLen = (b: Bytes, n: number, name: string): Bytes => {
  if (!(b instanceof Uint8Array) || b.length !== n) throw new Error(`${name} must be ${n} bytes`);
  return b;
};
