// SPDX-License-Identifier: Apache-2.0
// Bank-node durable state (decision X7). Proving takes seconds and can fail mid-flight, so jobs,
// own flags, quota-slot usage and pending relay writes all survive restarts.
// Nothing here holds a raw identifier or a subject tag T.
import { randomUUID } from 'node:crypto';
import { openDb } from '@mulenet/service-kit';

const SCHEMA = `
  create table if not exists jobs (
    id text primary key, kind text not null, idem text not null unique, state text not null,
    request text not null, result text, error text, created integer not null, updated integer not null
  );
  create table if not exists flags (
    flag_index integer primary key, case_ref text not null, epoch integer not null, typology integer not null,
    ct_hash text not null, tx_id text not null, revoked integer not null default 0, created integer not null
  );
  create table if not exists quota_slots (kind text not null, epoch integer not null, used integer not null,
                                          primary key (kind, epoch));
  create table if not exists outbox (id text primary key, record text not null, attempts integer not null default 0,
                                     created integer not null);
`;

export type JobKind = 'flag' | 'revoke' | 'attest';
export type JobState = 'queued' | 'tagging' | 'proving' | 'sponsoring' | 'submitted' | 'confirmed' | 'failed';
export type JobRow = {
  id: string;
  kind: JobKind;
  idem: string;
  state: JobState;
  request: string; // JSON; the identifier inside is wiped once the job ends
  result: string | null;
  error: string | null;
};

export const openStore = (path = ':memory:') => {
  const db = openDb(path, SCHEMA);
  const now = () => Date.now();

  return {
    db,
    // Idempotent: the same key returns the existing job instead of creating a second one.
    createJob(kind: JobKind, idem: string, request: unknown): { id: string; created: boolean } {
      const existing = db.prepare('select id from jobs where idem = ?').get(idem) as { id: string } | undefined;
      if (existing) return { id: existing.id, created: false };
      const id = randomUUID();
      db.prepare('insert into jobs(id, kind, idem, state, request, created, updated) values (?, ?, ?, ?, ?, ?, ?)').run(
        id,
        kind,
        idem,
        'queued',
        JSON.stringify(request),
        now(),
        now(),
      );
      return { id, created: true };
    },
    job: (id: string) => db.prepare('select * from jobs where id = ?').get(id) as JobRow | undefined,
    nextQueued: () => db.prepare("select * from jobs where state = 'queued' order by created limit 1").get() as JobRow | undefined,
    // Jobs left mid-flight by a crash go back to the queue at boot.
    requeueInterrupted: () =>
      db.prepare("update jobs set state = 'queued', updated = ? where state in ('tagging','proving','sponsoring','submitted')").run(now()),
    setState(id: string, state: JobState) {
      db.prepare('update jobs set state = ?, updated = ? where id = ?').run(state, now(), id);
    },
    finish(id: string, state: 'confirmed' | 'failed', result: unknown, error?: { code: string; message: string; retryable: boolean }) {
      // Drop the identifier from the stored request once the job is done (§4.3 step 11).
      const req = JSON.parse((db.prepare('select request from jobs where id = ?').get(id) as { request: string }).request);
      delete req.identifier;
      db.prepare('update jobs set state = ?, result = ?, error = ?, request = ?, updated = ? where id = ?').run(
        state,
        result === undefined ? null : JSON.stringify(result),
        error ? JSON.stringify(error) : null,
        JSON.stringify(req),
        now(),
        id,
      );
    },
    recordFlag(f: { index: number; caseRef: string; epoch: number; typology: number; ctHash: string; txId: string }) {
      db.prepare(
        'insert into flags(flag_index, case_ref, epoch, typology, ct_hash, tx_id, created) values (?, ?, ?, ?, ?, ?, ?)',
      ).run(f.index, f.caseRef, f.epoch, f.typology, f.ctHash, f.txId, now());
    },
    flag: (index: number) =>
      db.prepare('select * from flags where flag_index = ?').get(index) as
        | { flag_index: number; case_ref: string; epoch: number; typology: number; ct_hash: string; tx_id: string; revoked: number }
        | undefined,
    markRevoked: (index: number) => db.prepare('update flags set revoked = 1 where flag_index = ?').run(index),
    // Quota slots are committed only after the transaction confirms (a failed tx consumes nothing).
    nextSlot: (kind: 'flag' | 'revoke', epoch: number) =>
      (db.prepare('select used from quota_slots where kind = ? and epoch = ?').get(kind, epoch) as { used: number } | undefined)?.used ?? 0,
    commitSlot(kind: 'flag' | 'revoke', epoch: number, slot: number) {
      db.prepare(
        'insert into quota_slots(kind, epoch, used) values (?, ?, ?) on conflict(kind, epoch) do update set used = max(used, excluded.used)',
      ).run(kind, epoch, slot + 1);
    },
    outboxAdd: (id: string, record: string) =>
      db.prepare('insert into outbox(id, record, created) values (?, ?, ?) on conflict(id) do nothing').run(id, record, now()),
    outboxPending: () => db.prepare('select id, record, attempts from outbox order by created').all() as { id: string; record: string; attempts: number }[],
    outboxDone: (id: string) => db.prepare('delete from outbox where id = ?').run(id),
    outboxBump: (id: string) => db.prepare('update outbox set attempts = attempts + 1 where id = ?').run(id),
  };
};

export type Store = ReturnType<typeof openStore>;
