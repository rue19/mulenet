// SPDX-License-Identifier: Apache-2.0
// Explorer read model (§7.1) on node:sqlite. Raw transactions are kept for the Privacy X-ray.
import { openDb } from '@mulenet/service-kit';
import type { Snapshot } from './project.js';

const SCHEMA = `
  create table if not exists actions (seq integer primary key autoincrement, height integer not null, tx_hash text not null,
    entry_point text not null, raw text not null, state text not null, at text);
  create table if not exists epochs (n integer primary key, started_height integer not null,
    flags integer not null default 0, revocations integer not null default 0, attestations integer not null default 0);
  create table if not exists attestations (att_key text primary key, epoch integer, k integer, typology integer,
    escalation_ct_hash text, tx_hash text, height integer);
  create table if not exists proposals (id text primary key, kind integer, payload text, approvals integer, executed integer,
    created_epoch integer, last_tx text);
  create table if not exists warrants (att_key text primary key, epoch integer, tx_hash text, height integer);
  create table if not exists meta (key text primary key, value text);
`;

export const openExplorerStore = (path = ':memory:') => {
  const db = openDb(path, SCHEMA);
  let last: Snapshot | undefined;

  return {
    db,
    lastHeight: () => Number((db.prepare("select value from meta where key = 'lastHeight'").get() as { value: string } | undefined)?.value ?? -1),
    latest: () => last,
    apply(s: Snapshot, raw: string, state: string, at?: string) {
      const prev = last;
      db.prepare('insert into actions(height, tx_hash, entry_point, raw, state, at) values (?, ?, ?, ?, ?, ?)').run(s.height, s.txHash, s.entryPoint, raw, state, at ?? null);
      const e = s.counters.currentEpoch;
      db.prepare('insert into epochs(n, started_height) values (?, ?) on conflict(n) do nothing').run(e, s.height);
      const d = (k: 'flagCount' | 'revocationCount' | 'attestationCount') => s.counters[k] - (prev?.counters[k] ?? 0);
      db.prepare('update epochs set flags = flags + ?, revocations = revocations + ?, attestations = attestations + ? where n = ?').run(
        d('flagCount'),
        d('revocationCount'),
        d('attestationCount'),
        e,
      );
      for (const a of s.attestations) {
        db.prepare('insert into attestations values (?, ?, ?, ?, ?, ?, ?) on conflict(att_key) do nothing').run(a.attKey, a.epoch, a.k, a.typology, a.escalationCtHash, s.txHash, s.height);
      }
      for (const p of s.proposals) {
        db.prepare(
          `insert into proposals values (?, ?, ?, ?, ?, ?, ?) on conflict(id) do update set approvals = excluded.approvals,
             executed = excluded.executed, last_tx = case when proposals.approvals != excluded.approvals or proposals.executed != excluded.executed then excluded.last_tx else proposals.last_tx end`,
        ).run(p.id, p.kind, p.payload, p.approvals, p.executed ? 1 : 0, p.createdEpoch, s.txHash);
      }
      for (const w of s.warrants) {
        db.prepare('insert into warrants values (?, ?, ?, ?) on conflict(att_key) do nothing').run(w.attKey, w.epoch, s.txHash, s.height);
      }
      db.prepare("insert into meta(key, value) values ('lastHeight', ?) on conflict(key) do update set value = excluded.value").run(String(s.height));
      last = s;
    },
    restore(s: Snapshot) {
      last = s;
    },
  };
};

export type ExplorerStore = ReturnType<typeof openExplorerStore>;
