// SPDX-License-Identifier: Apache-2.0
// Bank-node HTTP API (§4.3). Internal only: every route is signed by the bank's own systems
// (or the demo console). Transactions run as durable jobs; /check is synchronous and free.
import { CheckRequest, FlagRequest } from '@mulenet/sdk/api-types';
import { createApp, createVerifier, requireSignature } from '@mulenet/service-kit';
import { FlowError, check, flag, flushOutbox, type FlowDeps } from './flows.js';

export type BankNodeOptions = {
  deps: FlowDeps;
  clients: Map<string, Uint8Array>; // bank-internal callers allowed to use this node
  logger?: boolean;
  health?: () => Promise<Record<string, unknown>>;
};

export const buildBankNode = (o: BankNodeOptions) => {
  const { store } = o.deps;
  const app = createApp({ name: `bank-node:${o.deps.institutionId}`, logger: o.logger ?? true });
  const signed = { preHandler: requireSignature(createVerifier({ publicKeys: o.clients })) };

  // ── job worker: one job at a time, so quota slots and nonces never race ──
  let running = false;
  const work = async () => {
    if (running) return;
    running = true;
    try {
      for (let job = store.nextQueued(); job; job = store.nextQueued()) {
        const req = JSON.parse(job.request);
        try {
          if (job.kind === 'flag') {
            const out = await flag(o.deps, req, (s) => store.setState(job!.id, s));
            store.finish(job.id, 'confirmed', out);
          } else {
            throw new FlowError('not-implemented', `${job.kind} arrives in Phase 5`);
          }
        } catch (e) {
          const err = e instanceof FlowError ? e : new FlowError('internal', e instanceof Error ? e.message : String(e), true);
          app.log.warn({ jobId: job.id, kind: job.kind, code: err.code }, 'job failed');
          store.finish(job.id, 'failed', undefined, { code: err.code, message: err.message, retryable: err.retryable });
        }
      }
      await flushOutbox(o.deps);
    } finally {
      running = false;
    }
  };
  store.requeueInterrupted();
  const kick = () => void work();
  const timer = setInterval(kick, 5_000);
  app.addHook('onClose', async () => clearInterval(timer));

  app.post('/v1/flags', signed, async (req, reply) => {
    const parsed = FlagRequest.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'malformed', detail: parsed.error.issues[0]?.message });
    const { idempotencyKey, ...input } = parsed.data;
    const { id } = store.createJob('flag', idempotencyKey, input);
    kick();
    return reply.code(202).send({ jobId: id });
  });

  app.post('/v1/check', signed, async (req, reply) => {
    const parsed = CheckRequest.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'malformed', detail: parsed.error.issues[0]?.message });
    try {
      return await check(o.deps, parsed.data);
    } catch (e) {
      if (e instanceof FlowError) return reply.code(e.code === 'invalid-identifier' ? 422 : 503).send({ error: e.code, detail: e.message });
      throw e;
    }
  });

  app.get<{ Params: { id: string } }>('/v1/jobs/:id', signed, async (req, reply) => {
    const j = store.job(req.params.id);
    if (!j) return reply.code(404).send({ error: 'not found' });
    const result = j.result ? JSON.parse(j.result) : {};
    return {
      jobId: j.id,
      kind: j.kind,
      state: j.state,
      txId: result.txId,
      blockHeight: result.blockHeight,
      flagIndex: result.flagIndex,
      error: j.error ? JSON.parse(j.error) : undefined,
    };
  });

  app.get('/v1/status', async () => ({ institution: o.deps.institutionId, outbox: store.outboxPending().length, ...(await o.health?.()) }));

  return { app, work };
};
