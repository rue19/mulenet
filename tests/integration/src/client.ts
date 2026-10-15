// SPDX-License-Identifier: Apache-2.0
// Signed client for a bank node's internal API, used by integration tests and the console.
import { randomUUID } from 'node:crypto';
import { fromHex } from '@mulenet/crypto';
import { InstitutionSecret, loadPublicConfig, loadSecret } from '@mulenet/sdk/config';
import type { CheckResult, Job } from '@mulenet/sdk/api-types';
import { signRequest } from '@mulenet/service-kit';

export const bankClient = (network: string, bankId: string) => {
  const cfg = loadPublicConfig(network);
  const url = cfg.institutions.find((i) => i.id === bankId)!.url;
  const key = { id: bankId, secretKey: fromHex(loadSecret(InstitutionSecret, network, bankId).signingSecretKey) };

  const call = async <T>(method: 'GET' | 'POST', path: string, payload?: unknown): Promise<{ status: number; body: T }> => {
    const body = payload === undefined ? undefined : new TextEncoder().encode(JSON.stringify(payload));
    const res = await fetch(`${url}${path}`, {
      method,
      headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...signRequest(key, method, path, body) },
      body,
    });
    return { status: res.status, body: (await res.json()) as T };
  };

  const waitJob = async (jobId: string, timeoutMs = 300_000): Promise<Job> => {
    const end = Date.now() + timeoutMs;
    for (;;) {
      const { body } = await call<Job>('GET', `/v1/jobs/${jobId}`);
      if (body.state === 'confirmed' || body.state === 'failed') return body;
      if (Date.now() > end) throw new Error(`job ${jobId} still ${body.state}`);
      await new Promise((r) => setTimeout(r, 1_000));
    }
  };

  // The bank's own case system knows which flag index it got for which account.
  const flagIndexOf = new Map<string, number>();

  return {
    flag: async (identifier: string, typology = 1, caseRef = 'FRM-TEST') => {
      const { body } = await call<{ jobId: string }>('POST', '/v1/flags', { identifier, typology, caseRef, idempotencyKey: randomUUID() });
      const job = await waitJob(body.jobId);
      if (job.flagIndex !== undefined) flagIndexOf.set(identifier, job.flagIndex);
      return job;
    },
    revokeLatest: async (identifier: string) => {
      const index = flagIndexOf.get(identifier);
      if (index === undefined) throw new Error('no flag of this bank on that account');
      const { body } = await call<{ jobId: string }>('POST', `/v1/flags/${index}/revoke`, { identifier, idempotencyKey: randomUUID() });
      return waitJob(body.jobId);
    },
    attest: async (identifier: string, k: 2 | 3, demoHook?: 'duplicate-slot' | 'include-self', typology = 1) => {
      const { body } = await call<{ jobId: string }>('POST', '/v1/attest', { identifier, typology, caseRef: 'STR-TEST', k, demoHook, idempotencyKey: randomUUID() });
      return waitJob(body.jobId);
    },
    check: async (identifier: string, typology?: number) => (await call<CheckResult>('POST', '/v1/check', { identifier, typology })).body,
    call,
  };
};

import { GuardianSecret, RegulatorSecret } from '@mulenet/sdk/config';

type Signer = { id: string; secretKey: Uint8Array };

const signedJson = async <T>(base: string, key: Signer, method: 'GET' | 'POST', path: string, payload?: unknown) => {
  const body = payload === undefined ? undefined : new TextEncoder().encode(JSON.stringify(payload));
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...signRequest(key, method, path, body) },
    body,
  });
  return { status: res.status, body: (await res.json()) as T };
};

// A guardian's operator: casts governance votes through that guardian's daemon, and can ask the
// sponsor's keeper to roll the epoch.
export const guardianOperator = (network: string, index: number) => {
  const cfg = loadPublicConfig(network);
  const url = cfg.guardians.members.find((g) => g.index === index)!.url;
  const key = { id: `guardian-${index}`, secretKey: fromHex(loadSecret(GuardianSecret, network, `guardian-${index}`).signingSecretKey) };
  return {
    propose: (kind: number, payloadHex: string) => signedJson<{ txId: string; proposalId: string }>(url, key, 'POST', '/v1/gov/propose', { kind, payload: payloadHex }),
    approve: (id: string) => signedJson<{ txId?: string; reason?: string }>(url, key, 'POST', '/v1/gov/approve', { id }),
    execute: (id: string, value = 0) => signedJson<{ txId?: string; reason?: string }>(url, key, 'POST', '/v1/gov/execute', { id, value }),
    advanceEpoch: () => signedJson<{ outcome: string }>(cfg.sponsor.url, key, 'POST', '/v1/keeper/advance', {}),
  };
};

// The regulator: fetches escalations from the attesting bank, buckets from the relay, and asks
// guardians for decryption shares.
export const regulatorClient = (network: string) => {
  const cfg = loadPublicConfig(network);
  const key = { id: cfg.regulator.id, secretKey: fromHex(loadSecret(RegulatorSecret, network, 'regulator').signingSecretKey) };
  const guardianUrl = (i: number) => cfg.guardians.members.find((g) => g.index === i)!.url;
  return {
    escalation: (bankId: string, attKey: string) =>
      signedJson<{ escalationCt: string }>(cfg.institutions.find((i) => i.id === bankId)!.url, key, 'GET', `/v1/escalations/${attKey}`),
    bucket: (bucket: number) => signedJson<{ records: string[] }>(cfg.relay.url, key, 'GET', `/v1/buckets/${bucket}?since=0&limit=500`),
    escalationShare: (g: number, attKey: string, escalationCt: string) =>
      signedJson<{ guardianIndex: number; share: string; proof: string; reason?: string }>(guardianUrl(g), key, 'POST', '/v1/shares/escalation', { attKey, escalationCt }),
    detailShares: (g: number, attKey: string, tag: string, records: string[]) =>
      signedJson<{ guardianIndex: number; shares: { index: number; share: string; proof: string }[]; reason?: string }>(guardianUrl(g), key, 'POST', '/v1/shares/details', {
        attKey,
        tag,
        records,
      }),
    guardianPublicShares: () => cfg.guardians.members.map((g) => ({ index: g.index, publicKey: fromHex(g.publicShare) })),
  };
};
