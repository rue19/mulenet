// SPDX-License-Identifier: Apache-2.0
// Flag relay (§4.2 of docs/plans/PHASES_4-9.md). An append-only store of encrypted flag
// records, bucketed by the first two bytes of lookupKey. It checks structure and size only:
// it cannot read records, and it cannot forge one that a client would accept, because
// clients recompute every record's leaf against the on-chain tree.
import { createHash } from 'node:crypto';
import { decodeRecord, recordId, toHex } from '@mulenet/crypto';
import { PutRecordRequest } from '@mulenet/sdk/api-types';
import { createApp, createVerifier, openDb, requireSignature } from '@mulenet/service-kit';

export const MAX_RECORD_BYTES = 1024;

const SCHEMA = `
  create table if not exists records (
    seq     integer primary key autoincrement,
    id      text    not null unique,
    bucket  integer not null,
    data    blob    not null,
    at      text    not null
  );
  create index if not exists records_bucket on records(bucket, seq);
`;

export type RelayOptions = { members: Map<string, Uint8Array>; dbPath?: string; logger?: boolean; now?: () => number };

// Merkle root over record ids in insertion order, so members can compare snapshots (§8.3).
export const merkleRoot = (ids: Buffer[]): Buffer => {
  if (ids.length === 0) return Buffer.alloc(32);
  let level = ids;
  while (level.length > 1) {
    const next: Buffer[] = [];
    for (let i = 0; i < level.length; i += 2) {
      next.push(createHash('sha256').update(level[i]).update(level[i + 1] ?? level[i]).digest());
    }
    level = next;
  }
  return level[0];
};

export const buildRelay = (o: RelayOptions) => {
  const now = o.now ?? Date.now;
  const db = openDb(o.dbPath ?? ':memory:', SCHEMA);
  const app = createApp({ name: 'relay', logger: o.logger ?? true });
  const signed = { preHandler: requireSignature(createVerifier({ publicKeys: o.members, now: () => Math.floor(now() / 1000) })) };

  app.put('/v1/records', signed, async (req, reply) => {
    const parsed = PutRecordRequest.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'malformed' });
    const bytes = Buffer.from(parsed.data.record, 'base64');
    if (bytes.length === 0 || bytes.length > MAX_RECORD_BYTES) return reply.code(400).send({ error: 'size' });

    let rec;
    try {
      rec = decodeRecord(new Uint8Array(bytes));
    } catch {
      return reply.code(400).send({ error: 'not a record' });
    }
    const ok =
      rec.v === 1 &&
      Number.isInteger(rec.bucket) &&
      rec.bucket >= 0 &&
      rec.bucket < 65_536 &&
      rec.lookupKey.length === 32 &&
      rec.nonce.length === 24 &&
      rec.body.length > 16 &&
      rec.bucket === ((rec.lookupKey[0] << 8) | rec.lookupKey[1]);
    if (!ok) return reply.code(400).send({ error: 'not a record' });

    const id = toHex(recordId(rec));
    const res = db
      .prepare('insert into records(id, bucket, data, at) values (?, ?, ?, ?) on conflict(id) do nothing')
      .run(id, rec.bucket, bytes, new Date(now()).toISOString());
    if (res.changes === 0) return reply.code(409).send({ id });
    return reply.code(201).send({ id });
  });

  // Members fetch whole buckets: the relay learns the bucket, never which record was wanted.
  app.get<{ Params: { bucket: string }; Querystring: { since?: string; limit?: string } }>('/v1/buckets/:bucket', signed, async (req, reply) => {
    const bucket = Number(req.params.bucket);
    if (!Number.isInteger(bucket) || bucket < 0 || bucket >= 65_536) return reply.code(400).send({ error: 'bucket' });
    const since = Math.max(0, Number(req.query.since ?? 0) || 0);
    const limit = Math.min(500, Math.max(1, Number(req.query.limit ?? 500) || 500));
    const rows = db
      .prepare('select seq, data from records where bucket = ? and seq > ? order by seq limit ?')
      .all(bucket, since, limit) as { seq: number; data: Uint8Array }[];
    return {
      records: rows.map((r) => Buffer.from(r.data).toString('base64')),
      cursor: rows.length ? rows[rows.length - 1].seq : since,
    };
  });

  app.get('/v1/snapshot', async () => {
    const ids = (db.prepare('select id from records order by seq').all() as { id: string }[]).map((r) => Buffer.from(r.id, 'hex'));
    return { count: ids.length, root: merkleRoot(ids).toString('hex'), at: new Date(now()).toISOString() };
  });

  return { app, db };
};
