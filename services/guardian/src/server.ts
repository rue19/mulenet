// SPDX-License-Identifier: Apache-2.0
// Guardian daemon (§5.3). Releases threshold-decryption shares only under an on-chain warrant
// (policy.ts), keeps a public append-only release log, and lets its operator cast governance
// votes. Auto-approval is off: every vote is an explicit operator action.
import { decodeRecord, decryptionShare, fromHex, toHex, type GuardianKeyShare } from '@mulenet/crypto';
import type { MuleNet } from '@mulenet/contract';
import { createApp, createVerifier, openDb, requireSignature } from '@mulenet/service-kit';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { checkDetails, checkEscalation } from './policy.js';

type Ledger = MuleNet.Ledger;

export type Governance = {
  propose(kind: bigint, payload: Uint8Array): Promise<{ txId: string; proposalId: string }>;
  approve(id: Uint8Array): Promise<{ txId: string }>;
  execute(id: Uint8Array, value: bigint): Promise<{ txId: string }>;
};

export type GuardianOptions = {
  key: GuardianKeyShare;
  ledger: () => Promise<Ledger>;
  pathIndex: (p: ReturnType<Ledger['flags']['pathForLeaf']>) => bigint;
  governance: Governance;
  regulator: { id: string; publicKey: Uint8Array };
  operator: { id: string; publicKey: Uint8Array };
  dbPath?: string;
  logger?: boolean;
};

const hex = z.string().regex(/^([0-9a-f]{2})+$/);
const EscalationReq = z.object({ attKey: hex.length(64), escalationCt: hex });
const DetailsReq = z.object({ attKey: hex.length(64), tag: hex.length(64), records: z.array(z.string()).min(1).max(64) });
const ProposeReq = z.object({ kind: z.number().int().min(1).max(5), payload: hex.length(64) });
const ApproveReq = z.object({ id: hex.length(64) });
const ExecuteReq = z.object({ id: hex.length(64), value: z.number().int().min(0).default(0) });

export const buildGuardian = (o: GuardianOptions) => {
  const db = openDb(
    o.dbPath ?? ':memory:',
    `create table if not exists releases (seq integer primary key autoincrement, at text not null,
       att_key text not null, kind text not null, count integer not null);`,
  );
  const app = createApp({ name: `guardian-${o.key.index}`, logger: o.logger ?? true });
  const verifier = createVerifier({ publicKeys: new Map([[o.regulator.id, o.regulator.publicKey], [o.operator.id, o.operator.publicKey]]) });
  const only = (id: string) => ({
    preHandler: [
      requireSignature(verifier),
      async (req: FastifyRequest, reply: FastifyReply) => {
        if (req.caller !== id) return reply.code(403).send({ error: 'forbidden' });
      },
    ],
  });
  const logRelease = (attKey: string, kind: string, count: number) =>
    db.prepare('insert into releases(at, att_key, kind, count) values (?, ?, ?, ?)').run(new Date().toISOString(), attKey, kind, count);
  const share = (ct: Uint8Array) => {
    const s = decryptionShare(o.key, ct);
    return { share: toHex(s.share), proof: toHex(s.proof) };
  };

  app.post('/v1/shares/escalation', only(o.regulator.id), async (req, reply) => {
    const p = EscalationReq.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: 'malformed' });
    const ct = fromHex(p.data.escalationCt);
    const r = checkEscalation(await o.ledger(), p.data.attKey, ct);
    if (!r.ok) return reply.code(403).send({ error: 'refused', reason: r.reason });
    logRelease(p.data.attKey, 'escalation', 1);
    return { guardianIndex: o.key.index, ...share(ct) };
  });

  app.post('/v1/shares/details', only(o.regulator.id), async (req, reply) => {
    const p = DetailsReq.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: 'malformed' });
    let records;
    try {
      records = p.data.records.map((b) => decodeRecord(new Uint8Array(Buffer.from(b, 'base64'))));
    } catch {
      return reply.code(400).send({ error: 'malformed record' });
    }
    const r = checkDetails(await o.ledger(), p.data.attKey, fromHex(p.data.tag), records, o.pathIndex);
    if (!r.ok) return reply.code(403).send({ error: 'refused', reason: r.reason });
    logRelease(p.data.attKey, 'details', r.value.length);
    return { guardianIndex: o.key.index, shares: r.value.map((v) => ({ index: v.index, ...share(v.ct) })) };
  });

  // Public: the transparency page shows every guardian's releases.
  app.get('/v1/log', async () => db.prepare('select seq, at, att_key as attKey, kind, count from releases order by seq').all());

  // Operator-only governance actions, each one sponsored on-chain.
  app.post('/v1/gov/propose', only(o.operator.id), async (req, reply) => {
    const p = ProposeReq.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: 'malformed' });
    return o.governance.propose(BigInt(p.data.kind), fromHex(p.data.payload));
  });
  app.post('/v1/gov/approve', only(o.operator.id), async (req, reply) => {
    const p = ApproveReq.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: 'malformed' });
    return o.governance.approve(fromHex(p.data.id));
  });
  app.post('/v1/gov/execute', only(o.operator.id), async (req, reply) => {
    const p = ExecuteReq.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: 'malformed' });
    return o.governance.execute(fromHex(p.data.id), BigInt(p.data.value));
  });

  app.setErrorHandler((err: Error & { statusCode?: number }, _req, reply) => {
    const m = /failed assert: ([^\n]+)/.exec(err.message)?.[1];
    if (m) return reply.code(409).send({ error: 'refused-on-chain', reason: m });
    reply.code(err.statusCode ?? 500).send({ error: err.message });
  });

  return { app, db };
};
