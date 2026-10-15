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

  return {
    flag: async (identifier: string, typology = 1, caseRef = 'FRM-TEST') => {
      const { body } = await call<{ jobId: string }>('POST', '/v1/flags', { identifier, typology, caseRef, idempotencyKey: randomUUID() });
      return waitJob(body.jobId);
    },
    check: async (identifier: string, typology?: number) => (await call<CheckResult>('POST', '/v1/check', { identifier, typology })).body,
    call,
  };
};
