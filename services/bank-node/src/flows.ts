// SPDX-License-Identifier: Apache-2.0
// Bank-node flows (§4.3 of docs/plans/PHASES_4-9.md). Dependencies are injected so the logic
// can be tested without a chain: `chain` hides the wallet, proving, sponsorship and indexer.
import {
  IdentifierError,
  decodeRecord,
  encodeRecord,
  encryptObject,
  hash,
  isCanonical,
  normalise,
  openBucket,
  recordId,
  recordKeys,
  sealRecord,
  toHex,
  type CaseDetails,
  type Identifier,
} from '@mulenet/crypto';
import type { MuleNet } from '@mulenet/contract';
import type { CheckResult } from '@mulenet/sdk/api-types';
import type { OprfClient } from '@mulenet/sdk/oprf-client';
import type { RelayClient } from '@mulenet/sdk/relay-client';
import type { Store } from './store.js';

type Ledger = MuleNet.Ledger;
type MerklePath = ReturnType<Ledger['flags']['pathForLeaf']>;

export type Chain = {
  snapshot(): Promise<{ ledger: Ledger; blockHeight: number }>;
  // Builds, proves, balances own value, signs and binds, sends to the sponsor, waits for the
  // transaction to be final. Throws with the contract's assert message on rejection.
  sponsoredCall(circuit: 'submitFlag' | 'revokeFlag' | 'attestCorroboration2' | 'attestCorroboration3', args: unknown[]): Promise<{ txId: string; blockHeight: number }>;
  institutionPath(): Promise<MerklePath>;
  pathIndex(path: MerklePath): bigint;
};

export type FlowDeps = {
  institutionId: string;
  institutionSecret: Uint8Array;
  guardianGroupKey: Uint8Array;
  store: Store;
  oprf: Pick<OprfClient, 'tag'>;
  relay: Pick<RelayClient, 'put' | 'bucket'>;
  chain: Chain;
};

export class FlowError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable = false,
  ) {
    super(message);
  }
}

// Bank systems may send canonical strings or the common loose forms; anything else is refused.
export const canonicalise = (raw: string): string => {
  const s = raw.trim();
  if (isCanonical(s)) return s;
  let id: Identifier | undefined;
  if (s.includes('@')) id = { kind: 'VPA', vpa: s };
  else if (/^[A-Za-z]{4}0[A-Za-z0-9]{6}[:\s]/.test(s)) {
    const [ifsc, ...rest] = s.split(/[:\s]+/);
    id = { kind: 'IN', ifsc, account: rest.join('') };
  } else if (/^\d{2}-?\d{2}-?\d{2}[:\s]/.test(s)) {
    const [sortCode, ...rest] = s.split(/[:\s]+/);
    id = { kind: 'GB', sortCode, account: rest.join('') };
  }
  if (!id) throw new FlowError('invalid-identifier', 'identifier is not in a recognised format');
  try {
    return normalise(id);
  } catch (e) {
    throw new FlowError('invalid-identifier', e instanceof IdentifierError ? e.message : 'invalid identifier');
  }
};

const assertMessage = (e: unknown) => {
  const m = e instanceof Error ? e.message : String(e);
  return /failed assert: ([^\n]+)/.exec(m)?.[1] ?? m;
};

// The caller's membership path. An institution missing from the registry at the current
// generation is refused here, before anything is proven or sent to the sponsor.
const memberPath = async (d: FlowDeps) => {
  try {
    return await d.chain.institutionPath();
  } catch (e) {
    if (/not bound|not a member|not registered/.test(e instanceof Error ? e.message : String(e))) {
      throw new FlowError('not-a-member', 'this institution is not a registered member');
    }
    throw e;
  }
};

// ── outbox: relay writes are retried until the relay has the record ──

export const flushOutbox = async (d: Pick<FlowDeps, 'store' | 'relay'>) => {
  for (const row of d.store.outboxPending()) {
    try {
      await d.relay.put(decodeRecord(new Uint8Array(Buffer.from(row.record, 'base64'))));
      d.store.outboxDone(row.id);
    } catch {
      d.store.outboxBump(row.id);
    }
  }
};

// ── flag (§4.3 "The flag flow") ──

export type FlagInput = { identifier: string; typology: number; caseRef: string };
export type FlagOutput = { flagIndex: number; txId: string; blockHeight: number; epoch: number };

export const flag = async (d: FlowDeps, input: FlagInput, onState: (s: 'tagging' | 'proving' | 'sponsoring') => void = () => {}): Promise<FlagOutput> => {
  const canonical = canonicalise(input.identifier);
  onState('tagging');
  const T = await d.oprf.tag(canonical);
  const p = hash.pseudonym(d.institutionSecret, T);

  const { ledger } = await d.chain.snapshot();
  const epoch = Number(ledger.currentEpoch);
  const details: CaseDetails = {
    institutionId: d.institutionId,
    caseRef: input.caseRef,
    typology: input.typology,
    evidenceSummary: '',
    contactRef: `${d.institutionId}/fraud-ops`,
  };
  const { ct, ctHash } = encryptObject(d.guardianGroupKey, details);
  const leaf = hash.flagLeaf(T, p, BigInt(epoch), BigInt(input.typology), ctHash);

  const instPath = await memberPath(d);
  onState('proving');
  let slot = d.store.nextSlot('flag', epoch);
  let res;
  for (let attempt = 0; ; attempt++) {
    try {
      res = await d.chain.sponsoredCall('submitFlag', [T, BigInt(input.typology), ctHash, BigInt(slot), instPath]);
      break;
    } catch (e) {
      const msg = assertMessage(e);
      if (msg === 'quota slot used' && attempt < 2) {
        d.store.commitSlot('flag', epoch, slot); // used by an earlier run that we lost track of
        slot = d.store.nextSlot('flag', epoch);
        continue;
      }
      if (msg === 'duplicate flag') throw new FlowError('duplicate-flag', 'this institution already flagged this account in the current epoch');
      if (msg === 'quota') throw new FlowError('quota', 'flag quota for this epoch is exhausted');
      if (msg === 'not bound' || msg === 'not a member') throw new FlowError('not-a-member', 'this institution is not a registered member');
      throw new FlowError('chain', msg, true);
    }
  }
  d.store.commitSlot('flag', epoch, slot);

  // Locate the leaf that just landed. insert() chose the index on-chain (ADR 0011).
  const after = (await d.chain.snapshot()).ledger;
  const path = after.flags.findPathForLeaf(leaf);
  if (!path) throw new FlowError('chain', 'flag confirmed but leaf not found', true);
  const flagIndex = Number(d.chain.pathIndex(path));

  const record = sealRecord(T, { p, epoch, typology: input.typology, ctHash, ct, index: flagIndex, flaggedAt: Math.floor(Date.now() / 1000) });
  d.store.outboxAdd(toHex(recordId(record)), Buffer.from(encodeRecord(record)).toString('base64'));
  d.store.recordFlag({ index: flagIndex, caseRef: input.caseRef, epoch, typology: input.typology, ctHash: toHex(ctHash), txId: res.txId });
  await flushOutbox(d);
  return { flagIndex, txId: res.txId, blockHeight: res.blockHeight, epoch };
};

// ── check (§4.3 "The check flow"): off-chain, free, no transaction ──

export const check = async (d: FlowDeps, input: { identifier: string; typology?: number }): Promise<CheckResult> => {
  const canonical = canonicalise(input.identifier);
  const t0 = performance.now();
  const T = await d.oprf.tag(canonical);
  const t1 = performance.now();
  const { records } = await d.relay.bucket(recordKeys(T).bucket);
  const bodies = openBucket(T, records);
  const t2 = performance.now();

  const { ledger, blockHeight } = await d.chain.snapshot();
  const current = Number(ledger.currentEpoch);
  const minEpoch = Math.max(0, current - Number(ledger.epochTtl));
  const firstFree = Number(ledger.flags.firstFree());

  const skipped = { revoked: 0, expired: 0, notOnChain: 0 };
  const pseudonyms = new Set<string>();
  const flags: CheckResult['flags'] = [];
  const seenLeaves = new Set<string>();
  for (const b of bodies) {
    if (input.typology !== undefined && b.typology !== input.typology) continue;
    const leaf = hash.flagLeaf(T, b.p, BigInt(b.epoch), BigInt(b.typology), b.ctHash);
    if (seenLeaves.has(toHex(leaf))) continue;
    seenLeaves.add(toHex(leaf));
    const path = ledger.flags.findPathForLeaf(leaf);
    // A record counts only if its leaf is in the tree at the index it claims.
    if (!path || Number(d.chain.pathIndex(path)) !== b.index) {
      if (b.index < firstFree) skipped.revoked++;
      else skipped.notOnChain++;
      continue;
    }
    const fresh = b.epoch >= minEpoch;
    flags.push({ epoch: b.epoch, typology: b.typology as 1 | 2 | 3 | 4, fresh });
    if (!fresh) {
      skipped.expired++;
      continue;
    }
    pseudonyms.add(toHex(b.p));
  }

  let attestation: CheckResult['attestation'] = null;
  for (const ty of input.typology !== undefined ? [input.typology] : [1, 2, 3, 4]) {
    const key = hash.attestationKey(T, BigInt(current), BigInt(ty));
    if (ledger.attestations.member(key)) {
      const a = ledger.attestations.lookup(key);
      attestation = { k: Number(a.k), epoch: Number(a.epoch), typology: Number(a.typology) as 1 | 2 | 3 | 4 };
      break;
    }
  }
  const t3 = performance.now();

  return {
    distinctInstitutions: pseudonyms.size,
    flags,
    skipped,
    attestation,
    verifiedAgainst: { root: ledger.flags.root().field.toString(16), atBlock: blockHeight },
    timings: { oprfMs: Math.round(t1 - t0), relayMs: Math.round(t2 - t1), verifyMs: Math.round(t3 - t2) },
  };
};

// ── attest (§5.1) ──

export type AttestInput = {
  identifier: string;
  typology: number;
  caseRef: string;
  k: 2 | 3;
  // Demo-only hooks (MULENET_DEMO_HOOKS=1) that force the two on-chain refusals in the script.
  demoHook?: 'duplicate-slot' | 'include-self';
};
export type AttestOutput = { attKey: string; txId: string; blockHeight: number; epoch: number };

export const attest = async (
  d: FlowDeps,
  input: AttestInput,
  onState: (s: 'tagging' | 'proving' | 'sponsoring') => void = () => {},
): Promise<AttestOutput> => {
  const canonical = canonicalise(input.identifier);
  onState('tagging');
  const T = await d.oprf.tag(canonical);
  const self = toHex(hash.pseudonym(d.institutionSecret, T));
  const bodies = openBucket(T, (await d.relay.bucket(recordKeys(T).bucket)).records);

  for (let attempt = 0; ; attempt++) {
    // One snapshot: every slot path comes from the same root (the contract asserts it).
    const { ledger } = await d.chain.snapshot();
    const epoch = Number(ledger.currentEpoch);
    const minEpoch = Math.max(0, epoch - Number(ledger.epochTtl));
    type Slot = { pseudonym: Uint8Array; epoch: bigint; ctHash: Uint8Array; path: MerklePath; index: number; flagEpoch: number };
    const valid: Slot[] = [];
    let own: Slot | undefined;
    for (const b of [...bodies].sort((x, y) => y.epoch - x.epoch)) {
      if (b.typology !== input.typology || b.epoch < minEpoch) continue;
      const path = ledger.flags.findPathForLeaf(hash.flagLeaf(T, b.p, BigInt(b.epoch), BigInt(b.typology), b.ctHash));
      if (!path || Number(d.chain.pathIndex(path)) !== b.index) continue;
      const slot = { pseudonym: b.p, epoch: BigInt(b.epoch), ctHash: b.ctHash, path, index: b.index, flagEpoch: b.epoch };
      if (toHex(b.p) === self) {
        own ??= slot;
        continue;
      }
      if (!valid.some((v) => toHex(v.pseudonym) === toHex(b.p))) valid.push(slot);
    }

    let slots = valid.slice(0, input.k);
    if (input.demoHook === 'duplicate-slot' && valid.length >= 1) slots = [valid[0], ...valid.slice(0, input.k - 1)];
    if (input.demoHook === 'include-self' && own) slots = [own, ...valid.slice(0, input.k - 1)];
    // Fewer than k usable flags: refuse without proving. No proof of "≥ k" can be built.
    if (slots.length < input.k) {
      throw new FlowError('insufficient', `only ${valid.length} independent fresh flags of this typology; ${input.k} required`);
    }

    const escalation = encryptObject(d.guardianGroupKey, {
      identifier: canonical,
      tag: T,
      leafIndices: slots.map((s) => s.index),
      institutionId: d.institutionId,
      caseRef: input.caseRef,
    });
    const attKey = toHex(hash.attestationKey(T, BigInt(epoch), BigInt(input.typology)));

    onState('proving');
    try {
      const res = await d.chain.sponsoredCall(input.k === 3 ? 'attestCorroboration3' : 'attestCorroboration2', [
        T,
        BigInt(input.typology),
        slots.map(({ pseudonym, epoch: e, ctHash, path }) => ({ pseudonym, epoch: e, ctHash, path })),
        await memberPath(d),
        escalation.ctHash,
      ]);
      d.store.recordEscalation(attKey, toHex(escalation.ct), input.caseRef, input.k);
      return { attKey, txId: res.txId, blockHeight: res.blockHeight, epoch };
    } catch (e) {
      const msg = assertMessage(e);
      // A revocation or epoch roll landed in between: rebuild from fresh state once.
      if ((msg === 'slot not in tree' || msg === 'mixed roots') && attempt === 0) continue;
      const known: Record<string, string> = {
        dup: 'duplicate-pseudonym',
        'self excluded': 'self-excluded',
        'already attested': 'already-attested',
        policy: 'policy',
        'slot expired': 'expired',
      };
      if (known[msg]) throw new FlowError(known[msg], msg);
      throw new FlowError('chain', msg, true);
    }
  }
};

// ── revoke (§5.2) ──
// T is never stored, so the bank re-derives it from the identifier in its own case system.

export const revoke = async (
  d: FlowDeps,
  input: { flagIndex: number; identifier: string },
  onState: (s: 'tagging' | 'proving' | 'sponsoring') => void = () => {},
): Promise<{ txId: string; blockHeight: number }> => {
  const f = d.store.flag(input.flagIndex);
  if (!f) throw new FlowError('not-found', 'no flag of this institution at that index');
  if (f.revoked) throw new FlowError('already-revoked', 'this flag was already revoked');
  onState('tagging');
  const T = await d.oprf.tag(canonicalise(input.identifier));
  const leaf = hash.flagLeaf(T, hash.pseudonym(d.institutionSecret, T), BigInt(f.epoch), BigInt(f.typology), Buffer.from(f.ct_hash, 'hex'));

  const { ledger } = await d.chain.snapshot();
  const path = ledger.flags.findPathForLeaf(leaf);
  if (!path || Number(d.chain.pathIndex(path)) !== f.flag_index) {
    throw new FlowError('identifier-mismatch', 'that identifier does not reproduce this flag');
  }
  const epoch = Number(ledger.currentEpoch);
  const slot = d.store.nextSlot('revoke', epoch);

  onState('proving');
  try {
    const res = await d.chain.sponsoredCall('revokeFlag', [
      T,
      BigInt(f.epoch),
      BigInt(f.typology),
      Buffer.from(f.ct_hash, 'hex'),
      BigInt(f.flag_index),
      BigInt(slot),
      path,
      await memberPath(d),
    ]);
    d.store.commitSlot('revoke', epoch, slot);
    d.store.markRevoked(f.flag_index);
    return res;
  } catch (e) {
    const msg = assertMessage(e);
    if (msg === 'quota') throw new FlowError('quota', 'revocation quota for this epoch is exhausted');
    throw new FlowError('chain', msg, true);
  }
};
