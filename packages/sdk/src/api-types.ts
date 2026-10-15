// SPDX-License-Identifier: Apache-2.0
// Wire types for every MuleNet service API (decision X5). Binary values are lowercase hex at
// API boundaries (X4). Imported by services, the console and tests; no Midnight imports here,
// so the browser bundle stays small.
import { z } from 'zod';

export const hex = (bytes?: number) =>
  z
    .string()
    .regex(bytes ? new RegExp(`^[0-9a-f]{${bytes * 2}}$`) : /^([0-9a-f]{2})*$/, bytes ? `expected ${bytes}-byte hex` : 'expected hex');

export const Typology = z.number().int().min(1).max(4);

// ── oracle (§4.1) ──
export const OraclePublic = z.object({
  index: z.number().int().min(1),
  publicShare: hex(32),
  groupPublicKey: hex(32),
  threshold: z.number().int().min(1),
  suite: z.literal('ristretto255-SHA512'),
});
export const EvaluateRequest = z.object({ blinded: z.array(hex(32)).min(1).max(64) });
export const EvaluateResponse = z.object({ index: z.number().int(), evaluated: z.array(hex(32)), proof: hex(64) });

// ── relay (§4.2) ──
export const PutRecordRequest = z.object({ record: z.string().max(2048) }); // base64(CBOR)
export const PutRecordResponse = z.object({ id: hex(32) });
export const BucketResponse = z.object({ records: z.array(z.string()), cursor: z.number().int() });
export const SnapshotResponse = z.object({ count: z.number().int(), root: hex(32), at: z.string() });

// ── sponsor (§4.4) ──
export const SponsorCircuit = z.enum([
  'submitFlag',
  'revokeFlag',
  'attestCorroboration2',
  'attestCorroboration3',
  'propose',
  'approve',
  'execute',
  'advanceEpoch',
]);
export const SponsorRequest = z.object({ txHex: hex(), circuit: SponsorCircuit });
export const SponsorResponse = z.object({ txId: z.string(), blockHeight: z.number().int().optional() });
export const SponsorRefusal = z.object({
  reason: z.enum(['not-mulenet', 'circuit-not-allowed', 'ttl', 'preexec-failed', 'quota', 'failure-rate', 'malformed', 'submit-failed']),
  detail: z.string().optional(),
});

// ── bank node (§4.3) ──
export const FlagRequest = z.object({
  identifier: z.string().min(1).max(300),
  typology: Typology,
  caseRef: z.string().min(1).max(100),
  idempotencyKey: z.string().min(8).max(100),
});
// T is never stored, so revocation re-derives it from the identifier in the bank's own case record.
export const RevokeRequest = z.object({ identifier: z.string().min(1).max(300), idempotencyKey: z.string().min(8).max(100) });
export const CheckRequest = z.object({ identifier: z.string().min(1).max(300), typology: Typology.optional() });
export const AttestRequest = FlagRequest.extend({
  k: z.union([z.literal(2), z.literal(3)]),
  // Honoured only when the node runs with MULENET_DEMO_HOOKS=1 (judge-mode refusals).
  demoHook: z.enum(['duplicate-slot', 'include-self']).optional(),
});

export const JobState = z.enum(['queued', 'tagging', 'proving', 'sponsoring', 'submitted', 'confirmed', 'failed']);
export const Job = z.object({
  jobId: z.string(),
  kind: z.enum(['flag', 'revoke', 'attest']),
  state: JobState,
  txId: z.string().optional(),
  blockHeight: z.number().int().optional(),
  flagIndex: z.number().int().optional(),
  attKey: hex(32).optional(),
  error: z.object({ code: z.string(), message: z.string(), retryable: z.boolean() }).optional(),
});

export const CheckResult = z.object({
  distinctInstitutions: z.number().int(),
  flags: z.array(z.object({ epoch: z.number().int(), typology: Typology, fresh: z.boolean() })),
  skipped: z.object({ revoked: z.number().int(), expired: z.number().int(), notOnChain: z.number().int() }),
  attestation: z.object({ k: z.number().int(), epoch: z.number().int(), typology: Typology }).nullable(),
  verifiedAgainst: z.object({ root: z.string(), atBlock: z.number().int() }),
  timings: z.object({ oprfMs: z.number(), relayMs: z.number(), verifyMs: z.number() }),
});

export type OraclePublic = z.infer<typeof OraclePublic>;
export type EvaluateRequest = z.infer<typeof EvaluateRequest>;
export type EvaluateResponse = z.infer<typeof EvaluateResponse>;
export type SponsorRequest = z.infer<typeof SponsorRequest>;
export type SponsorRefusal = z.infer<typeof SponsorRefusal>;
export type FlagRequest = z.infer<typeof FlagRequest>;
export type CheckRequest = z.infer<typeof CheckRequest>;
export type AttestRequest = z.infer<typeof AttestRequest>;
export type RevokeRequest = z.infer<typeof RevokeRequest>;
export type Job = z.infer<typeof Job>;
export type CheckResult = z.infer<typeof CheckResult>;
