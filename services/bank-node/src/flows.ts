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

  onState('proving');
  let slot = d.store.nextSlot('flag', epoch);
  let res;
  for (let attempt = 0; ; attempt++) {
    try {
      res = await d.chain.sponsoredCall('submitFlag', [T, BigInt(input.typology), ctHash, BigInt(slot), await d.chain.institutionPath()]);
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
