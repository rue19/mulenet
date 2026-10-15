// Phase 4 integration test (§4.6), against the live local network with every service running
// as its own process and every transaction sponsored.
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bankClient } from './client.js';
import { startStack, type Stack } from './stack.js';

const NET = 'undeployed';
// A fresh account per run, so repeated runs against one deployment stay independent.
const acct = () => `acct:v1:IN:HDFC0001234:${(BigInt('0x' + randomBytes(7).toString('hex')) % 10n ** 14n).toString().padStart(14, '1')}`;
const X = acct();
const Y = acct();

let stack: Stack;
beforeAll(async () => {
  // Keeper off: an epoch roll mid-test would make the same-epoch duplicate check meaningless.
  stack = await startStack(NET, { banks: ['bank-a', 'bank-b', 'bank-c', 'bank-e'], keeper: false });
});
afterAll(async () => {
  await stack?.stop();
});

describe('phase 4: flag → check through oracles, sponsor, relay and chain', () => {
  const A = bankClient(NET, 'bank-a');
  const B = bankClient(NET, 'bank-b');
  const C = bankClient(NET, 'bank-c');
  const E = bankClient(NET, 'bank-e'); // deliberately not registered by bootstrap

  it('A and B flag X; C sees two distinct institutions', async () => {
    const a = await A.flag(X);
    expect(a.state).toBe('confirmed');
    const b = await B.flag(X);
    expect(b.state).toBe('confirmed');
    const r = await C.check(X);
    expect(r.distinctInstitutions).toBe(2);
    expect(r.skipped).toEqual({ revoked: 0, expired: 0, notOnChain: 0 });
  });

  it('a duplicate flag by A in the same epoch fails as duplicate-flag', async () => {
    const again = await A.flag(X);
    expect(again.state).toBe('failed');
    expect(again.error?.code).toBe('duplicate-flag');
  });

  it('an unregistered institution is refused before any transaction', async () => {
    const z = await E.flag(X);
    expect(z.state).toBe('failed');
    expect(z.error?.code).toBe('not-a-member');
    expect(z.txId).toBeUndefined();
  });

  it('bank wallets hold zero DUST throughout: the sponsor paid every fee', async () => {
    for (const bank of [A, B]) {
      const { body } = await bank.call<{ walletDust: string }>('GET', '/v1/status');
      expect(body.walletDust).toBe('0');
    }
  });

  it('an unseen account checks as 0', async () => {
    expect((await C.check(Y)).distinctInstitutions).toBe(0);
  });
});
