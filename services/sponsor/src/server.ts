// SPDX-License-Identifier: Apache-2.0
// Sponsor service (§4.4). Pays DUST fees for MuleNet calls that institutions, guardians and
// the epoch keeper have already proven, balanced, signed and bound. It can only add a fee:
// it never sees private inputs and cannot change what a transaction does.
import { SponsorRequest } from '@mulenet/sdk/api-types';
import { createApp, createVerifier, requireSignature } from '@mulenet/service-kit';
import type { Accounting } from './accounting.js';
import { Batcher } from './batcher.js';
import type { WalletPool } from './pool.js';
import type { PreflightResult } from './preflight.js';

export type Role = 'institution' | 'guardian' | 'keeper';

// Which circuits each role may have sponsored.
export const ROLE_CIRCUITS: Record<Role, ReadonlySet<string>> = {
  institution: new Set(['submitFlag', 'revokeFlag', 'attestCorroboration2', 'attestCorroboration3']),
  guardian: new Set(['propose', 'approve', 'execute']),
  keeper: new Set(['advanceEpoch']),
};

export type SponsorOptions<T> = {
  callers: Map<string, { publicKey: Uint8Array; role: Role }>;
  // Deserialises and pre-flights the bound transaction (see preflight.ts).
  inspect: (bytes: Uint8Array) => { tx: T; result: PreflightResult };
  pool: WalletPool<unknown, T>;
  accounting: Accounting;
  windowMs?: number;
  maxBatch?: number;
  logger?: boolean;
};

export const buildSponsor = <T>(o: SponsorOptions<T>) => {
  const app = createApp({ name: 'sponsor', logger: o.logger ?? true });
  const verify = createVerifier({ publicKeys: new Map([...o.callers].map(([id, c]) => [id, c.publicKey])) });
  const batcher = new Batcher<T, { txId: string; walletId: string }>({
    windowMs: o.windowMs ?? 30_000,
    maxBatch: o.maxBatch ?? 8,
    run: (tx) => o.pool.submit(tx),
  });

  app.post('/v1/sponsor', { preHandler: requireSignature(verify) }, async (req, reply) => {
    const caller = req.caller!;
    const role = o.callers.get(caller)!.role;
    const parsed = SponsorRequest.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ reason: 'malformed', detail: parsed.error.issues[0]?.message });

    const refused = o.accounting.check(caller);
    if (refused) return reply.code(429).send({ reason: refused });

    let inspected;
    try {
      inspected = o.inspect(new Uint8Array(Buffer.from(parsed.data.txHex, 'hex')));
    } catch {
      return reply.code(400).send({ reason: 'malformed', detail: 'not a bound MuleNet transaction' });
    }
    const pf = inspected.result;
    if (!pf.ok) return reply.code(400).send({ reason: pf.reason === 'value-movement' ? 'not-mulenet' : pf.reason, detail: pf.detail });
    if (pf.circuits.some((c) => !ROLE_CIRCUITS[role].has(c)) || !pf.circuits.includes(parsed.data.circuit)) {
      return reply.code(400).send({ reason: 'circuit-not-allowed', detail: `${role} may not call ${pf.circuits.join(',')}` });
    }

    try {
      const { txId, walletId } = await batcher.enqueue(inspected.tx);
      o.accounting.recordSuccess(caller);
      req.log.info({ caller, circuit: parsed.data.circuit, walletId, txId }, 'sponsored');
      return { txId };
    } catch (e) {
      o.accounting.recordFailure(caller);
      req.log.warn({ caller, circuit: parsed.data.circuit, err: e instanceof Error ? e.message : String(e) }, 'submission failed');
      return reply.code(502).send({ reason: 'submit-failed', detail: e instanceof Error ? e.message.slice(0, 200) : 'unknown' });
    }
  });

  app.get('/v1/status', async () => ({ ...o.pool.status(), queueDepth: batcher.depth }));
  return { app, batcher };
};
