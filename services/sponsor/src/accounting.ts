// SPDX-License-Identifier: Apache-2.0
// Per-caller accounting (§4.4 step 6, R2). Fees are collected even when a transaction's
// fallible phase fails, so a caller submitting failing calls could drain sponsor DUST:
// more than `maxFailures` failures within an hour opens a breaker for an hour.
import { openDb } from '@mulenet/service-kit';

const SCHEMA = `
  create table if not exists usage (caller text not null, day text not null, count integer not null, primary key (caller, day));
  create table if not exists failures (caller text not null, at integer not null);
  create index if not exists failures_caller on failures(caller, at);
`;

export type AccountingOptions = { dbPath?: string; dailyQuota?: number; maxFailures?: number; now?: () => number };

export const createAccounting = ({ dbPath = ':memory:', dailyQuota = 500, maxFailures = 3, now = Date.now }: AccountingOptions = {}) => {
  const db = openDb(dbPath, SCHEMA);
  const HOUR = 3_600_000;
  const day = () => new Date(now()).toISOString().slice(0, 10);

  const recentFailures = (caller: string) =>
    (db.prepare('select at from failures where caller = ? and at > ? order by at').all(caller, now() - HOUR) as { at: number }[]).map((r) => r.at);

  return {
    // Returns a refusal reason, or null if the caller may submit.
    check(caller: string): 'quota' | 'failure-rate' | null {
      const used = (db.prepare('select count from usage where caller = ? and day = ?').get(caller, day()) as { count: number } | undefined)?.count ?? 0;
      if (used >= dailyQuota) return 'quota';
      // The breaker stays open for an hour after the failure that tripped it.
      const all = (db.prepare('select at from failures where caller = ? and at > ? order by at').all(caller, now() - 2 * HOUR) as { at: number }[]).map((r) => r.at);
      for (let i = maxFailures; i < all.length; i++) {
        if (all[i] - all[i - maxFailures] <= HOUR && now() - all[i] < HOUR) return 'failure-rate';
      }
      return null;
    },
    recordSuccess(caller: string) {
      db.prepare('insert into usage(caller, day, count) values (?, ?, 1) on conflict(caller, day) do update set count = count + 1').run(caller, day());
    },
    recordFailure(caller: string) {
      db.prepare('insert into failures(caller, at) values (?, ?)').run(caller, now());
    },
    recentFailures,
  };
};

export type Accounting = ReturnType<typeof createAccounting>;
