import { generateSigningKey, signRequest } from '@mulenet/service-kit';
import { describe, expect, it } from 'vitest';
import { createAccounting } from '../accounting.js';
import { Batcher } from '../batcher.js';
import { WalletPool, isRetryableSponsorError } from '../pool.js';
import type { PreflightResult } from '../preflight.js';
import { buildSponsor, type Role } from '../server.js';

const bank = generateSigningKey('bank-a');
const guardian = generateSigningKey('guardian-1');
const keeper = generateSigningKey('keeper');
const callers = new Map<string, { publicKey: Uint8Array; role: Role }>([
  [bank.id, { publicKey: bank.publicKey, role: 'institution' }],
  [guardian.id, { publicKey: guardian.publicKey, role: 'guardian' }],
  [keeper.id, { publicKey: keeper.publicKey, role: 'keeper' }],
]);

// The "transaction" in these tests is just its first byte, which picks a preflight outcome.
const OUTCOMES: Record<number, PreflightResult> = {
  1: { ok: true, circuits: ['submitFlag'], ttl: new Date(Date.now() + 3_600_000) },
  2: { ok: true, circuits: ['propose'], ttl: new Date(Date.now() + 3_600_000) },
  3: { ok: false, reason: 'not-mulenet', detail: 'foreign contract' },
  4: { ok: false, reason: 'ttl', detail: 'expiring' },
  5: { ok: true, circuits: ['advanceEpoch'], ttl: new Date(Date.now() + 3_600_000) },
  6: { ok: false, reason: 'value-movement', detail: 'unshielded offer' },
};
const inspect = (b: Uint8Array) => {
  if (!OUTCOMES[b[0]]) throw new Error('bad tx');
  return { tx: b, result: OUTCOMES[b[0]] };
};

const setup = (opts: { fail?: (n: number) => Error | undefined; dailyQuota?: number; windowMs?: number } = {}) => {
  let n = 0;
  const pool = new WalletPool<unknown, Uint8Array>([{ id: 'w1', wallet: 'w1' }, { id: 'w2', wallet: 'w2' }], async (w) => {
    n++;
    const err = opts.fail?.(n);
    if (err) throw err;
    return `tx-${n}-${String(w)}`;
  });
  const accounting = createAccounting({ dailyQuota: opts.dailyQuota ?? 100 });
  const { app } = buildSponsor({ callers, inspect, pool: pool as WalletPool<unknown, Uint8Array>, accounting, windowMs: opts.windowMs ?? 0, logger: false });
  return { app, accounting, pool };
};

const post = (app: ReturnType<typeof setup>['app'], key: typeof bank, txByte: number, circuit = 'submitFlag') => {
  const body = Buffer.from(JSON.stringify({ txHex: Buffer.from([txByte, 0, 0]).toString('hex'), circuit }));
  return app.inject({ method: 'POST', url: '/v1/sponsor', headers: { 'content-type': 'application/json', ...signRequest(key, 'POST', '/v1/sponsor', body) }, payload: body });
};

describe('sponsor service', () => {
  it('sponsors a valid institution call', async () => {
    const { app } = setup();
    const r = await post(app, bank, 1);
    expect(r.statusCode).toBe(200);
    expect(r.json().txId).toMatch(/^tx-1-w[12]$/);
  });

  it('refuses unsigned callers', async () => {
    const { app } = setup();
    const r = await app.inject({ method: 'POST', url: '/v1/sponsor', headers: { 'content-type': 'application/json' }, payload: '{}' });
    expect(r.statusCode).toBe(401);
  });

  it('refuses a non-MuleNet transaction, a value-moving one and an expiring one before spending DUST', async () => {
    const { app } = setup({ fail: () => new Error('pool must not be reached') });
    expect((await post(app, bank, 3)).json()).toMatchObject({ reason: 'not-mulenet' });
    expect((await post(app, bank, 6)).json()).toMatchObject({ reason: 'not-mulenet' });
    expect((await post(app, bank, 4)).json()).toMatchObject({ reason: 'ttl' });
  });

  it('refuses bytes that are not a transaction', async () => {
    const { app } = setup();
    expect((await post(app, bank, 99)).json()).toMatchObject({ reason: 'malformed' });
  });

  it('enforces role allow-lists: banks cannot govern, guardians cannot flag', async () => {
    const { app } = setup();
    expect((await post(app, bank, 2, 'propose')).json()).toMatchObject({ reason: 'circuit-not-allowed' });
    expect((await post(app, guardian, 1, 'submitFlag')).json()).toMatchObject({ reason: 'circuit-not-allowed' });
    expect((await post(app, guardian, 2, 'propose')).statusCode).toBe(200);
    expect((await post(app, keeper, 5, 'advanceEpoch')).statusCode).toBe(200);
  });

  it('refuses a declared circuit that does not match the transaction', async () => {
    const { app } = setup();
    expect((await post(app, bank, 1, 'revokeFlag')).json()).toMatchObject({ reason: 'circuit-not-allowed' });
  });

  it('enforces the daily quota', async () => {
    const { app } = setup({ dailyQuota: 2 });
    await post(app, bank, 1);
    await post(app, bank, 1);
    const r = await post(app, bank, 1);
    expect(r.statusCode).toBe(429);
    expect(r.json()).toMatchObject({ reason: 'quota' });
  });

  it('opens the failure breaker after more than 3 failures in an hour', async () => {
    const { app } = setup({ fail: () => new Error('1010: Invalid Transaction: Custom error: 42') });
    for (let i = 0; i < 4; i++) expect((await post(app, bank, 1)).statusCode).toBe(502);
    const r = await post(app, bank, 1);
    expect(r.statusCode).toBe(429);
    expect(r.json()).toMatchObject({ reason: 'failure-rate' });
  });

  it('retries a DustDoubleSpend once on another wallet', async () => {
    const { app } = setup({ fail: (n) => (n === 1 ? new Error('1010: Invalid Transaction: Custom error: 196') : undefined) });
    const r = await post(app, bank, 1);
    expect(r.statusCode).toBe(200);
    expect(r.json().txId).toMatch(/^tx-2-/);
  });
});

describe('wallet pool', () => {
  it('never runs two transactions on one wallet at the same time', async () => {
    const active = new Map<string, number>();
    let maxPerWallet = 0;
    const pool = new WalletPool<string, number>([{ id: 'a', wallet: 'a' }, { id: 'b', wallet: 'b' }], async (w) => {
      active.set(w, (active.get(w) ?? 0) + 1);
      maxPerWallet = Math.max(maxPerWallet, active.get(w)!);
      await new Promise((r) => setTimeout(r, 10));
      active.set(w, active.get(w)! - 1);
      return w;
    });
    const used = await Promise.all(Array.from({ length: 10 }, (_, i) => pool.submit(i)));
    expect(maxPerWallet).toBe(1);
    expect(new Set(used.map((u) => u.walletId))).toEqual(new Set(['a', 'b']));
  });

  it('classifies retryable sponsor errors', () => {
    expect(isRetryableSponsorError(new Error('1010: Invalid Transaction: Custom error: 170'))).toBe(true);
    expect(isRetryableSponsorError(new Error('1010: Invalid Transaction: Custom error: 196'))).toBe(true);
    expect(isRetryableSponsorError(new Error('1010: Invalid Transaction: Custom error: 1'))).toBe(false);
  });
});

describe('batcher', () => {
  it('holds requests for the window, then submits all of them', async () => {
    const ran: number[] = [];
    const b = new Batcher<number, number>({ windowMs: 50, maxBatch: 8, run: async (x) => (ran.push(x), x) });
    const p = Promise.all([b.enqueue(1), b.enqueue(2), b.enqueue(3)]);
    await new Promise((r) => setTimeout(r, 10));
    expect(ran).toEqual([]);
    expect(await p).toEqual([1, 2, 3]);
    expect(ran.sort()).toEqual([1, 2, 3]);
  });

  it('flushes early when the batch is full', async () => {
    const ran: number[] = [];
    const b = new Batcher<number, number>({ windowMs: 60_000, maxBatch: 3, run: async (x) => (ran.push(x), x) });
    await Promise.all([b.enqueue(1), b.enqueue(2), b.enqueue(3)]);
    expect(ran.length).toBe(3);
  });
});
