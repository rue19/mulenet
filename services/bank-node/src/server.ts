// SPDX-License-Identifier: Apache-2.0
// Bank-node HTTP API (§4.3). Internal only: every route is signed by the bank's own systems
// (or the demo console). Transactions run as durable jobs; /check is synchronous and free.
import { AttestRequest, CheckRequest, FlagRequest, RevokeRequest } from '@mulenet/sdk/api-types';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { createApp, createVerifier, requireSignature } from '@mulenet/service-kit';
import { FlowError, attest, check, flag, flushOutbox, revoke, type FlowDeps } from './flows.js';

export type BankNodeOptions = {
  deps: FlowDeps;
  clients: Map<string, Uint8Array>; // bank-internal callers allowed to use this node
  regulator?: { id: string; publicKey: Uint8Array }; // may fetch escalation ciphertexts, nothing else
  demoHooks?: boolean;
  logger?: boolean;
  health?: () => Promise<Record<string, unknown>>;
};

export const buildBankNode = (o: BankNodeOptions) => {
  const { store } = o.deps;
  const app = createApp({ name: `bank-node:${o.deps.institutionId}`, logger: o.logger ?? true });
  const keys = new Map(o.clients);
  if (o.regulator) keys.set(o.regulator.id, o.regulator.publicKey);
  const verifier = createVerifier({ publicKeys: keys });
  const bankOnly = (caller?: string) => !!caller && o.clients.has(caller);
  // Bank routes: valid signature AND a bank-internal caller. The regulator key gets 403 here.
  const signed = {
    preHandler: [
      requireSignature(verifier),
      async (req: FastifyRequest, reply: FastifyReply) => {
        if (!bankOnly(req.caller)) return reply.code(403).send({ error: 'forbidden' });
      },
    ],
  };
  const signedAny = { preHandler: requireSignature(verifier) };

  // ── job worker: one job at a time, so quota slots and nonces never race ──
  let running = false;
  const work = async () => {
    if (running) return;
    running = true;
    try {
      for (let job = store.nextQueued(); job; job = store.nextQueued()) {
        const req = JSON.parse(job.request);
        try {
          const onState = (s: 'tagging' | 'proving' | 'sponsoring') => store.setState(job!.id, s);
          const out =
            job.kind === 'flag'
              ? await flag(o.deps, req, onState)
              : job.kind === 'revoke'
                ? await revoke(o.deps, req, onState)
                : await attest(o.deps, { ...req, demoHook: o.demoHooks ? req.demoHook : undefined }, onState);
          store.finish(job.id, 'confirmed', out);
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

  app.post<{ Params: { index: string } }>('/v1/flags/:index/revoke', signed, async (req, reply) => {
    const parsed = RevokeRequest.safeParse(req.body);
    const flagIndex = Number(req.params.index);
    if (!parsed.success || !Number.isInteger(flagIndex) || flagIndex < 0) return reply.code(400).send({ error: 'malformed' });
    const { id } = store.createJob('revoke', parsed.data.idempotencyKey, { flagIndex, identifier: parsed.data.identifier });
    kick();
    return reply.code(202).send({ jobId: id });
  });

  app.post('/v1/attest', signed, async (req, reply) => {
    const parsed = AttestRequest.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'malformed', detail: parsed.error.issues[0]?.message });
    const { idempotencyKey, ...input } = parsed.data;
    const { id } = store.createJob('attest', idempotencyKey, input);
    kick();
    return reply.code(202).send({ jobId: id });
  });

  // The escalation ciphertext is the bank's report to the regulator (§7.6 round 1).
  app.get<{ Params: { attKey: string } }>('/v1/escalations/:attKey', signedAny, async (req, reply) => {
    if (req.caller !== o.regulator?.id && !bankOnly(req.caller)) return reply.code(403).send({ error: 'forbidden' });
    const e = store.escalation(req.params.attKey);
    if (!e) return reply.code(404).send({ error: 'not found' });
    return { attKey: e.att_key, escalationCt: e.ct, caseRef: e.case_ref, k: e.k };
  });

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
      attKey: result.attKey,
      error: j.error ? JSON.parse(j.error) : undefined,
    };
  });

  app.get('/v1/status', async () => ({ institution: o.deps.institutionId, outbox: store.outboxPending().length, ...(await o.health?.()) }));

  return { app, work };
};
