// SPDX-License-Identifier: Apache-2.0
// Sponsor wallet pool (§4.4 step 7, R4). Each wallet has at most one transaction in flight:
// concurrent spends from one wallet fail nondeterministically (DustDoubleSpend, code 196).
// Throughput comes from the number of wallets, not from concurrency within one.

export type PoolWallet<W> = { id: string; wallet: W };
export type SponsorFn<W, T> = (wallet: W, tx: T) => Promise<string>;
export type ResyncFn<W> = (wallet: W) => Promise<void>;

// 170 InvalidDustSpendProof (sponsor not synced), 196 DustDoubleSpend: resync and retry elsewhere.
export const isRetryableSponsorError = (e: unknown): boolean =>
  /Custom error: (170|196)\b|DustDoubleSpend|InvalidDustSpendProof/.test(e instanceof Error ? e.message : String(e));

type Slot<W> = PoolWallet<W> & { busy: boolean; lastError?: string; submitted: number };

export class WalletPool<W, T> {
  private readonly slots: Slot<W>[];
  private readonly waiters: ((s: Slot<W>) => void)[] = [];

  constructor(
    wallets: PoolWallet<W>[],
    private readonly sponsor: SponsorFn<W, T>,
    private readonly resync: ResyncFn<W> = async () => {},
  ) {
    if (wallets.length === 0) throw new Error('sponsor pool needs at least one wallet');
    this.slots = wallets.map((w) => ({ ...w, busy: false, submitted: 0 }));
  }

  private acquire(exclude?: string): Promise<Slot<W>> {
    const free = this.slots.find((s) => !s.busy && s.id !== exclude) ?? this.slots.find((s) => !s.busy);
    if (free) {
      free.busy = true;
      return Promise.resolve(free);
    }
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  private release(s: Slot<W>) {
    const next = this.waiters.shift();
    if (next) next(s);
    else s.busy = false;
  }

  async submit(tx: T): Promise<{ txId: string; walletId: string }> {
    let slot = await this.acquire();
    try {
      return { txId: await this.sponsor(slot.wallet, tx), walletId: slot.id };
    } catch (e) {
      slot.lastError = e instanceof Error ? e.message : String(e);
      if (!isRetryableSponsorError(e)) throw e;
      await this.resync(slot.wallet);
      const failed = slot.id;
      this.release(slot);
      slot = await this.acquire(failed);
      return { txId: await this.sponsor(slot.wallet, tx), walletId: slot.id };
    } finally {
      slot.submitted++;
      this.release(slot);
    }
  }

  status() {
    return {
      wallets: this.slots.map((s) => ({ id: s.id, inFlight: s.busy, submitted: s.submitted, lastError: s.lastError })),
      waiting: this.waiters.length,
    };
  }
}
