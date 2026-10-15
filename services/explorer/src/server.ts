// SPDX-License-Identifier: Apache-2.0
// Public, read-only explorer API (§7.1). Rate-limited: it must not become a way to burn the
// consortium's Blockfrost quota (R6), and it serves only data that is already public on-chain.
import type { MuleNet } from '@mulenet/contract';
import { createApp } from '@mulenet/service-kit';
import { PROPOSAL_KINDS } from './project.js';
import type { ExplorerStore } from './store.js';
import { expandQuery, search } from './xray.js';

export type ExplorerOptions = {
  deployment: { name: string; network: string; address: string; deployedAtBlock?: number };
  store: ExplorerStore;
  ledger: () => MuleNet.Ledger | undefined;
  canonicalise?: (q: string) => string | undefined;
  rateLimitPerSecond?: number;
  logger?: boolean;
};

export const buildExplorer = (o: ExplorerOptions) => {
  const app = createApp({ name: 'explorer', logger: o.logger ?? true });
  const { db } = o.store;
  const dep = o.deployment.name;

  // Simple per-IP token bucket.
  const buckets = new Map<string, { tokens: number; at: number }>();
  const limit = o.rateLimitPerSecond ?? 20;
  app.addHook('onRequest', async (req, reply) => {
    const now = Date.now();
    const b = buckets.get(req.ip) ?? { tokens: limit, at: now };
    b.tokens = Math.min(limit, b.tokens + ((now - b.at) / 1000) * limit);
    b.at = now;
    if (b.tokens < 1) return reply.code(429).send({ error: 'rate limited' });
    b.tokens -= 1;
    buckets.set(req.ip, b);
    reply.header('access-control-allow-origin', '*');
  });

  const listeners = new Set<(e: object) => void>();
  const publish = (e: object) => listeners.forEach((l) => l(e));

  app.get('/v1/deployments', async () => [{ ...o.deployment, lastHeight: o.store.lastHeight() }]);

  app.get(`/v1/${dep}/stats`, async () => ({
    latest: o.store.latest() ? { ...o.store.latest()!.counters, ...o.store.latest()!.params, root: o.store.latest()!.root, height: o.store.latest()!.height } : null,
    epochs: db.prepare('select n as epoch, started_height as startedHeight, flags, revocations, attestations from epochs order by n').all(),
  }));

  app.get<{ Querystring: { epoch?: string; typology?: string } }>(`/v1/${dep}/attestations`, async (req) => {
    const rows = db.prepare('select att_key as attKey, epoch, k, typology, tx_hash as txHash, height from attestations order by height').all() as {
      epoch: number;
      typology: number;
    }[];
    return rows.filter((r) => (req.query.epoch === undefined || r.epoch === Number(req.query.epoch)) && (req.query.typology === undefined || r.typology === Number(req.query.typology)));
  });

  app.get<{ Params: { attKey: string } }>(`/v1/${dep}/attestations/:attKey`, async (req, reply) => {
    const r = db.prepare('select att_key as attKey, epoch, k, typology, tx_hash as txHash, height from attestations where att_key = ?').get(req.params.attKey);
    return r ?? reply.code(404).send({ error: 'not found' });
  });

  app.get(`/v1/${dep}/proposals`, async () =>
    (db.prepare('select id, kind, payload, approvals, executed, created_epoch as createdEpoch, last_tx as lastTx from proposals').all() as { kind: number; executed: number }[]).map((p) => ({
      ...p,
      kindName: PROPOSAL_KINDS[p.kind],
      executed: !!p.executed,
    })),
  );

  app.get(`/v1/${dep}/warrants`, async () => db.prepare('select att_key as attKey, epoch, tx_hash as txHash, height from warrants order by height').all());

  app.get(`/v1/${dep}/actions`, async () => db.prepare('select seq, height, tx_hash as txHash, entry_point as entryPoint, at from actions order by seq desc limit 200').all());

  app.get(`/v1/${dep}/state`, async () => o.store.latest() ?? {});

  // Merkle path for a flag leaf, so bank nodes can build proofs without touching Blockfrost.
  app.get<{ Querystring: { index?: string; leaf?: string } }>(`/v1/${dep}/tree/path`, async (req, reply) => {
    const l = o.ledger();
    if (!l || !req.query.leaf || req.query.index === undefined) return reply.code(400).send({ error: 'index and leaf required' });
    const path = l.flags.pathForLeaf(BigInt(req.query.index), Buffer.from(req.query.leaf, 'hex'));
    return JSON.parse(JSON.stringify(path, (_, v) => (typeof v === 'bigint' ? v.toString() : v instanceof Uint8Array ? Buffer.from(v).toString('hex') : v)));
  });

  app.get<{ Querystring: { q?: string } }>(`/v1/${dep}/xray`, async (req, reply) => {
    const q = (req.query.q ?? '').trim();
    if (q.length < 4 || q.length > 300) return reply.code(400).send({ error: 'query must be 4–300 characters' });
    const canonical = o.canonicalise?.(q);
    const corpus = (db.prepare('select seq, tx_hash, raw, state from actions').all() as { seq: number; tx_hash: string; raw: string; state: string }[]).flatMap((r) => [
      { source: `tx ${r.tx_hash}`, bytes: Buffer.from(r.raw, 'hex') },
      { source: `state after tx ${r.tx_hash}`, bytes: Buffer.from(r.state, 'hex') },
    ]);
    return { query: q, canonical, ...search(expandQuery(q, canonical), corpus) };
  });

  app.get(`/v1/${dep}/events`, (req, reply) => {
    reply.raw.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive', 'access-control-allow-origin': '*' });
    const send = (e: object) => reply.raw.write(`data: ${JSON.stringify(e)}\n\n`);
    listeners.add(send);
    req.raw.on('close', () => listeners.delete(send));
  });

  return { app, publish };
};
