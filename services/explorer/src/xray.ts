// SPDX-License-Identifier: Apache-2.0
// Privacy X-ray (§7.3): search every public byte the explorer holds (raw transactions and
// decoded contract states) for a value, in all the encodings it could appear in. The expected
// answer for an account identifier, its normalised form, or a subject tag is 0 hits.
import { createHash } from 'node:crypto';

export type Needle = { label: string; bytes: Buffer };

export const expandQuery = (q: string, canonical?: string): Needle[] => {
  const out: Needle[] = [];
  const add = (label: string, b: Buffer) => {
    if (b.length >= 4 && !out.some((n) => n.bytes.equals(b))) out.push({ label, bytes: b });
  };
  for (const [name, v] of [['input', q], ['mulenet-id/v1', canonical]] as const) {
    if (!v) continue;
    add(`${name} (utf-8)`, Buffer.from(v, 'utf8'));
    add(`${name} (hex text)`, Buffer.from(Buffer.from(v, 'utf8').toString('hex'), 'utf8'));
    add(`${name} (base64 text)`, Buffer.from(Buffer.from(v, 'utf8').toString('base64'), 'utf8'));
    add(`${name} (sha256)`, createHash('sha256').update(v).digest());
  }
  // A hex query (a tag, a key, a pseudonym) is also searched as raw bytes.
  const hex = q.trim().replace(/^0x/, '');
  if (/^([0-9a-fA-F]{2}){4,}$/.test(hex)) add('input (raw bytes)', Buffer.from(hex, 'hex'));
  return out;
};

export type Hit = { needle: string; source: string; offset: number };

export const search = (needles: Needle[], corpus: { source: string; bytes: Buffer }[]) => {
  const hits: Hit[] = [];
  let bytes = 0;
  for (const doc of corpus) {
    bytes += doc.bytes.length;
    for (const n of needles) {
      const at = doc.bytes.indexOf(n.bytes);
      if (at >= 0) hits.push({ needle: n.label, source: doc.source, offset: at });
    }
  }
  return { hits, searchedBytes: bytes, documents: corpus.length, needles: needles.map((n) => n.label) };
};
