// SPDX-License-Identifier: Apache-2.0
// Submission batching (§4.4 step 5, L1, R3). Requests are held for at most `windowMs` or until
// `maxBatch` arrive, then shuffled across institutions before submission, which weakens timing
// correlation between a bank's internal events and its on-chain flags. The window stays short
// because a transaction's TTL was fixed when the bank built it.
import { randomInt } from 'node:crypto';

export type BatcherOptions<T, R> = { windowMs: number; maxBatch: number; run: (item: T) => Promise<R> };

export class Batcher<T, R> {
  private queue: { item: T; resolve: (r: R) => void; reject: (e: unknown) => void }[] = [];
  private timer?: NodeJS.Timeout;

  constructor(private readonly o: BatcherOptions<T, R>) {}

  get depth() {
    return this.queue.length;
  }

  enqueue(item: T): Promise<R> {
    return new Promise<R>((resolve, reject) => {
      this.queue.push({ item, resolve, reject });
      if (this.queue.length >= this.o.maxBatch || this.o.windowMs === 0) this.flush();
      else this.timer ??= setTimeout(() => this.flush(), this.o.windowMs);
    });
  }

  flush() {
    clearTimeout(this.timer);
    this.timer = undefined;
    const batch = this.queue.splice(0);
    for (let i = batch.length - 1; i > 0; i--) {
      const j = randomInt(i + 1);
      [batch[i], batch[j]] = [batch[j], batch[i]];
    }
    // The pool bounds concurrency to one transaction per wallet.
    for (const b of batch) this.o.run(b.item).then(b.resolve, b.reject);
  }
}
