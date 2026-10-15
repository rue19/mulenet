// SPDX-License-Identifier: Apache-2.0
// Guardian release policy (§5.3, §7.6). A guardian never takes the regulator's word for which
// ciphertexts belong to a warrant: every link back to the authorised attestation key is checked
// against chain state before a decryption share is released.
// This is a policy control, not a cryptographic one: t colluding guardians could decrypt without
// a warrant (leakage register L10). What it guarantees is that honest guardians release shares
// only for ciphertexts provably tied to a warrant that is public on-chain.
import { createHash } from 'node:crypto';
import { equal, fromHex, hash, openRecord, toHex, type FlagRecord } from '@mulenet/crypto';
import type { MuleNet } from '@mulenet/contract';

type Ledger = MuleNet.Ledger;
export type PolicyResult<T> = { ok: true; value: T } | { ok: false; reason: string };

const sha256 = (b: Uint8Array) => new Uint8Array(createHash('sha256').update(b).digest());

// Round 1: the escalation ciphertext of an attestation under a public warrant.
export const checkEscalation = (ledger: Ledger, attKeyHex: string, escalationCt: Uint8Array): PolicyResult<Uint8Array> => {
  const attKey = fromHex(attKeyHex);
  if (!ledger.disclosures.member(attKey)) return { ok: false, reason: 'no warrant for this attestation' };
  if (!ledger.attestations.member(attKey)) return { ok: false, reason: 'no such attestation' };
  if (!equal(sha256(escalationCt), ledger.attestations.lookup(attKey).escalationCtHash)) {
    return { ok: false, reason: 'ciphertext is not the one committed in the attestation' };
  }
  return { ok: true, value: escalationCt };
};

// Round 2: the case-detail ciphertexts of the flags behind a warranted attestation.
export const checkDetails = (
  ledger: Ledger,
  attKeyHex: string,
  tag: Uint8Array,
  records: FlagRecord[],
  pathIndex: (p: ReturnType<Ledger['flags']['pathForLeaf']>) => bigint,
): PolicyResult<{ index: number; ct: Uint8Array }[]> => {
  const attKey = fromHex(attKeyHex);
  if (!ledger.disclosures.member(attKey) || !ledger.attestations.member(attKey)) return { ok: false, reason: 'no warrant for this attestation' };
  const att = ledger.attestations.lookup(attKey);
  // 1. T is the warranted subject.
  if (!equal(hash.attestationKey(tag, att.epoch, att.typology), attKey)) return { ok: false, reason: 'tag does not match the warranted attestation' };
  if (records.length === 0) return { ok: false, reason: 'no records' };

  const out: { index: number; ct: Uint8Array }[] = [];
  for (const rec of records) {
    let body;
    try {
      // 2. the record belongs to T, and 4. its ct hashes to the ctHash inside it.
      body = openRecord(tag, rec);
    } catch {
      return { ok: false, reason: 'a record does not belong to this subject' };
    }
    // 3. the record is a real flag: its leaf, which commits ctHash, is in the tree at its index.
    const leaf = hash.flagLeaf(tag, body.p, BigInt(body.epoch), BigInt(body.typology), body.ctHash);
    const path = ledger.flags.findPathForLeaf(leaf);
    if (!path || Number(pathIndex(path)) !== body.index) return { ok: false, reason: `record for index ${body.index} is not an on-chain flag` };
    if (!out.some((o) => o.index === body.index)) out.push({ index: body.index, ct: body.ct });
  }
  return { ok: true, value: out };
};

export const ctId = (ct: Uint8Array) => toHex(sha256(ct));
