// SPDX-License-Identifier: Apache-2.0
// The regulator's two share rounds under a warrant (§7.6), run server-side.
import 'server-only';
import { combineAndDecrypt, decodeCbor, decodeRecord, fromHex, openRecord, recordKeys, toHex, type CaseDetails, type EscalationDetails } from '@mulenet/crypto';
import { bankIds, regulator } from './server';

export type Disclosure = {
  identifier: string;
  attestingInstitution: string;
  attestingCaseRef: string;
  flaggers: { institutionId: string; caseRef: string; index: number }[];
  refused: { index: number; reason: string }[];
  guardiansUsed: { round1: number[]; round2: number[] };
};

export const disclose = async (attKey: string, guardians: [number, number] = [1, 2]): Promise<Disclosure> => {
  const reg = regulator();
  const pubs = reg.guardianPublicShares();

  // The attesting bank filed the escalation with the regulator; find which one holds it.
  let escalationCt: string | undefined;
  for (const id of bankIds()) {
    const r = await reg.escalation(id, attKey).catch(() => undefined);
    if (r?.status === 200) {
      escalationCt = r.body.escalationCt;
      break;
    }
  }
  if (!escalationCt) throw new Error('no bank holds an escalation for this attestation');

  // Round 1: the escalation (identifier, T, slots, attesting bank).
  const r1 = await Promise.all(guardians.map((g) => reg.escalationShare(g, attKey, escalationCt!)));
  const refusal1 = r1.find((r) => r.status !== 200);
  if (refusal1) throw new Error(`guardian refused: ${refusal1.body.reason ?? refusal1.status}`);
  const esc = decodeCbor<EscalationDetails>(
    combineAndDecrypt(fromHex(escalationCt), pubs, r1.map((r) => ({ index: r.body.guardianIndex, share: fromHex(r.body.share), proof: fromHex(r.body.proof) })), 2),
  );
  const T = new Uint8Array(esc.tag);

  // Round 2: each flag's case details, one record per request so a revoked flag is refused alone.
  const { body: bucket } = await reg.bucket(recordKeys(T).bucket);
  const flaggers: Disclosure['flaggers'] = [];
  const refused: Disclosure['refused'] = [];
  for (const b64 of bucket.records) {
    let body;
    try {
      body = openRecord(T, decodeRecord(new Uint8Array(Buffer.from(b64, 'base64'))));
    } catch {
      continue; // another subject's record in the same bucket
    }
    const r2 = await Promise.all(guardians.map((g) => reg.detailShares(g, attKey, toHex(T), [b64])));
    const bad = r2.find((r) => r.status !== 200);
    if (bad) {
      refused.push({ index: body.index, reason: bad.body.reason ?? `HTTP ${bad.status}` });
      continue;
    }
    const shares = r2.map((r) => ({ index: r.body.guardianIndex, share: fromHex(r.body.shares[0].share), proof: fromHex(r.body.shares[0].proof) }));
    const d = decodeCbor<CaseDetails>(combineAndDecrypt(body.ct, pubs, shares, 2));
    flaggers.push({ institutionId: d.institutionId, caseRef: d.caseRef, index: body.index });
  }
  return { identifier: esc.identifier, attestingInstitution: esc.institutionId, attestingCaseRef: esc.caseRef, flaggers, refused, guardiansUsed: { round1: guardians, round2: guardians } };
};
