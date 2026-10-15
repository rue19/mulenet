// SPDX-License-Identifier: Apache-2.0
// Tagging oracle (§4.1 of docs/plans/PHASES_4-9.md). Holds one Shamir share of the OPRF key
// and evaluates blinded ristretto255 points with an RFC 9497 DLEQ proof. It never sees an
// account identifier or a tag, and it stores no blinded point: only per-institution counts.
import { fromHex, oracleEvaluate, toHex, type OracleKeyShare } from '@mulenet/crypto';
import { EvaluateRequest, type EvaluateResponse, type OraclePublic } from '@mulenet/sdk/api-types';
import { createApp, createVerifier, openDb, requireSignature, type DatabaseSync } from '@mulenet/service-kit';

export type OracleOptions = {
  key: OracleKeyShare;
  groupPublicKey: Uint8Array;
  threshold: number;
  institutions: Map<string, Uint8Array>; // caller id → Ed25519 public key
  dbPath?: string;
  dailyQuota?: number;
  burstFactor?: number; // alarm when a 5-minute window exceeds burstFactor × the caller's median window
  now?: () => number; // unix ms, for tests
  logger?: boolean;
};

const SCHEMA = `
  create table if not exists quota (institution text not null, day text not null, used integer not null,
                                    primary key (institution, day));
  create table if not exists audit (institution text not null, day text not null, count integer not null,
                                    primary key (institution, day));
`;

export const buildOracle = (o: OracleOptions) => {
  const now = o.now ?? Date.now;
  const db: DatabaseSync = openDb(o.dbPath ?? ':memory:', SCHEMA);
  const dailyQuota = o.dailyQuota ?? 5_000;
  const burstFactor = o.burstFactor ?? 10;
  const windows = new Map<string, { slot: number; counts: number[] }>(); // last 24 five-minute windows per caller
  const app = createApp({ name: `oracle-${o.key.index}`, logger: o.logger ?? true });
  const verify = createVerifier({ publicKeys: o.institutions, now: () => Math.floor(now() / 1000) });

  const day = () => new Date(now()).toISOString().slice(0, 10);
  const used = (inst: string): number =>
    (db.prepare('select used from quota where institution = ? and day = ?').get(inst, day()) as { used: number } | undefined)?.used ?? 0;

  const recordBurst = (inst: string, n: number) => {
    const slot = Math.floor(now() / 300_000);
    const w = windows.get(inst) ?? { slot, counts: [0] };
    if (w.slot !== slot) {
      w.slot = slot;
      w.counts.push(0);
      if (w.counts.length > 24) w.counts.shift();
    }
    w.counts[w.counts.length - 1] += n;
    windows.set(inst, w);
    const current = w.counts[w.counts.length - 1];
    const history = w.counts.slice(0, -1).sort((x, y) => x - y);
    const median = history.length ? history[Math.floor(history.length / 2)] : 0;
    if (history.length >= 3 && current > Math.max(burstFactor * median, 50)) {
      app.log.warn({ institution: inst, window: current, median }, 'enumeration-like burst');
    }
  };

  const publicInfo: OraclePublic = {
    index: o.key.index,
    publicShare: toHex(o.key.publicKey),
    groupPublicKey: toHex(o.groupPublicKey),
    threshold: o.threshold,
    suite: 'ristretto255-SHA512',
  };
  app.get('/v1/public', async () => publicInfo);

  app.post('/v1/evaluate', { preHandler: requireSignature(verify) }, async (req, reply) => {
    const parsed = EvaluateRequest.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'malformed', detail: parsed.error.issues[0]?.message });
    const inst = req.caller!;
    const n = parsed.data.blinded.length;
    if (used(inst) + n > dailyQuota) {
      const reset = new Date(now());
      reset.setUTCHours(24, 0, 0, 0);
      return reply.code(429).send({ error: 'quota', resetAt: reset.toISOString() });
    }

    let res;
    try {
      res = oracleEvaluate(o.key, parsed.data.blinded.map(fromHex));
    } catch {
      return reply.code(400).send({ error: 'malformed', detail: 'not a valid ristretto255 point' });
    }

    const d = day();
    db.prepare(
      'insert into quota(institution, day, used) values (?, ?, ?) on conflict(institution, day) do update set used = used + excluded.used',
    ).run(inst, d, n);
    db.prepare(
      'insert into audit(institution, day, count) values (?, ?, 1) on conflict(institution, day) do update set count = count + 1',
    ).run(inst, d);
    recordBurst(inst, n);

    const body: EvaluateResponse = { index: res.index, evaluated: res.evaluated.map(toHex), proof: toHex(res.proof) };
    return body;
  });

  // Count-only audit log: who asked how many times per day. Nothing about what was asked.
  app.get('/v1/audit', async () => db.prepare('select institution, day, count from audit order by day, institution').all());

  return { app, db };
};
