// SPDX-License-Identifier: Apache-2.0
// Epoch keeper (§5.4). Rolls the epoch once block time has passed nextEpochAt (plus a margin of
// two blocks: block time is block-granular, §7.7). No bank is involved; the sponsor pays both sides.
// advanceEpoch is idempotent in effect: a second call fails "too early", which counts as done.

export type KeeperDeps = {
  nextEpochAt: () => Promise<bigint>; // unix seconds, from public state
  advance: () => Promise<string>; // builds, proves and submits advanceEpoch; returns the tx id
  now?: () => number; // unix ms
  marginSeconds?: number;
  log?: (msg: string, extra?: Record<string, unknown>) => void;
};

export const keeperTick = async (d: KeeperDeps): Promise<'waiting' | 'advanced' | 'already-advanced' | 'error'> => {
  const now = Math.floor((d.now ?? Date.now)() / 1000);
  const due = Number(await d.nextEpochAt()) + (d.marginSeconds ?? 12);
  if (now < due) return 'waiting';
  try {
    const txId = await d.advance();
    d.log?.('epoch advanced', { txId });
    return 'advanced';
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/too early/.test(msg)) return 'already-advanced';
    d.log?.('epoch advance failed', { err: msg.slice(0, 200) });
    return 'error';
  }
};

export const startKeeper = (d: KeeperDeps & { intervalMs?: number }) => {
  let busy = false;
  const timer = setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      await keeperTick(d);
    } finally {
      busy = false;
    }
  }, d.intervalMs ?? 10_000);
  return () => clearInterval(timer);
};
