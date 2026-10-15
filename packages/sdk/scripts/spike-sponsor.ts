// Sponsorship spike on the local network (plan §4.4 and an early look at S6.1):
//   1. a fresh bank wallet with zero DUST prepares submitFlag; the genesis wallet sponsors it
//   2. bank DUST stays exactly 0
//   3. the sponsor pre-flight accepts the real tx and refuses it for another contract address
//   4. a tampered tx is rejected
//   5. linkability: do bank wallet keys appear in the finalized tx bytes? Is anything shared by
//      two of bank A's transactions that is absent from bank B's?
// Usage: MN_PROOF_SERVER=http://127.0.0.1:6301 npx tsx scripts/spike-sponsor.ts
import { randomBytes } from 'node:crypto';
import { MuleNet, type MuleNetPrivateState } from '@mulenet/contract';
import { inMemoryPrivateStateProvider } from '@midnight-ntwrk/testkit-js';
import { preflight } from '../../../services/sponsor/src/preflight.js';
import {
  GENESIS_SEED,
  addDustFeesAndFinalize,
  balances,
  buildWallet,
  deployMuleNet,
  deserializeFinalized,
  ensureDust,
  joinAs,
  makeProviders,
  networks,
  prepareSponsoredCall,
  readLedger,
  waitForSync,
  walletAndMidnightProvider,
  type WalletContext,
} from '../src/index.js';

const pc = MuleNet.pureCircuits;
const log = (...a: unknown[]) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a);
const rand = () => new Uint8Array(randomBytes(32));
const hexToBytes = (h: string) => Buffer.from(h.replace(/^0x/, ''), 'hex');
const leLimbs = (x: bigint) => {
  const b = Buffer.alloc(32);
  for (let i = 0; i < 32; i++, x >>= 8n) b[i] = Number(x & 0xffn);
  return b;
};
const ALLOWED = new Set(['submitFlag', 'revokeFlag', 'attestCorroboration2', 'attestCorroboration3', 'propose', 'approve', 'execute', 'advanceEpoch']);

const main = async () => {
  const net = networks.undeployed();
  const sponsor = await buildWallet(net, GENESIS_SEED);
  await ensureDust(sponsor);
  const sponsorDust0 = balances(await waitForSync(sponsor)).dust;

  const sponsorProviders = makeProviders(net, await walletAndMidnightProvider(sponsor), inMemoryPrivateStateProvider<string, MuleNetPrivateState>());

  // ── deploy and register two banks (setup is self-paid by the genesis wallet) ──
  const g = [rand(), rand(), rand()];
  const deployed = await deployMuleNet(sponsorProviders, 'deployer', {
    guardianLeaves: g.map((x) => pc.guardianLeaf(x)) as [Uint8Array, Uint8Array, Uint8Array],
    threshold: 2n,
    k: 2n,
    epochLength: 86_400n,
    firstRollAt: BigInt(Math.floor(Date.now() / 1000) + 86_400),
    ttl: 30n,
    flagQuota: 500n,
    revokeQuota: 3n,
  });
  const address = deployed.deployTxData.public.contractAddress;
  log(`deployed ${address}`);
  const guardian = await Promise.all(g.map((x, i) => joinAs(sponsorProviders, address, `g${i}`, { guardianSecret: x })));
  const L = () => readLedger(sponsorProviders, address);
  const sk = { A: rand(), B: rand() };
  for (const n of ['A', 'B'] as const) {
    const leaf = pc.institutionLeaf(sk[n], 0n);
    const id = pc.proposalId(1n, leaf, (await L()).proposalNonce);
    await guardian[0].callTx.propose(1n, leaf, (await L()).guardians.pathForLeaf(0n, pc.guardianLeaf(g[0])));
    await guardian[0].callTx.approve(id, (await L()).guardians.pathForLeaf(0n, pc.guardianLeaf(g[0])));
    await guardian[1].callTx.approve(id, (await L()).guardians.pathForLeaf(1n, pc.guardianLeaf(g[1])));
    await guardian[2].callTx.execute(id, 0n);
  }
  log('registered banks A and B');

  // ── zero-DUST bank wallets ──
  const bankWallet: Record<string, WalletContext> = {};
  const bankProviders: Record<string, ReturnType<typeof makeProviders>> = {};
  for (const n of ['A', 'B'] as const) {
    bankWallet[n] = await buildWallet(net, randomBytes(32).toString('hex'));
    await waitForSync(bankWallet[n]);
    bankProviders[n] = makeProviders(net, await walletAndMidnightProvider(bankWallet[n]), inMemoryPrivateStateProvider<string, MuleNetPrivateState>());
    await joinAs(bankProviders[n], address, `bank${n}`, { institutionSecret: sk[n] });
  }
  const dustOf = async (n: string) => balances(await waitForSync(bankWallet[n])).dust;
  log(`bank DUST before: A=${await dustOf('A')} B=${await dustOf('B')}`);

  const instPath = async (n: 'A' | 'B') => {
    const l = await L();
    return l.institutions.findPathForLeaf(pc.institutionLeaf(sk[n], l.membershipGen))!;
  };

  const txs: { bank: string; bytes: Uint8Array }[] = [];
  let firstUserTx: Uint8Array | undefined;
  const sponsoredFlag = async (n: 'A' | 'B', slot: bigint) => {
    const t0 = performance.now();
    const { bytes } = await prepareSponsoredCall(bankProviders[n], bankWallet[n], address, `bank${n}`, 'submitFlag', [
      rand(),
      1n,
      rand(),
      slot,
      await instPath(n),
    ]);
    firstUserTx ??= bytes;
    const userTx = deserializeFinalized(bytes);
    const pf = preflight(userTx, { contractAddress: address, allowedCircuits: ALLOWED });
    if (!pf.ok) throw new Error(`preflight refused a valid tx: ${pf.reason} ${pf.detail}`);
    const sponsored = await addDustFeesAndFinalize(sponsor, userTx, pf.ttl);
    const txId = await sponsor.wallet.submitTransaction(sponsored);
    const fin = await sponsorProviders.publicDataProvider.watchForTxData(txId);
    txs.push({ bank: n, bytes: fin.tx.serialize() });
    log(`sponsored submitFlag by ${n}: block ${fin.blockHeight}, ${((performance.now() - t0) / 1000).toFixed(1)} s, ${fin.tx.serialize().length} bytes`);
  };

  await sponsoredFlag('A', 0n);
  await sponsoredFlag('A', 1n);
  await sponsoredFlag('B', 0n);
  const after = await L();
  const dustA = await dustOf('A');
  const dustB = await dustOf('B');
  const sponsorDust1 = balances(await waitForSync(sponsor)).dust;
  log(`flagCount=${after.flagCount}; bank DUST after: A=${dustA} B=${dustB}; sponsor DUST ${sponsorDust0} -> ${sponsorDust1}`);

  // ── pre-flight negative: same tx, another contract address ──
  const foreign = preflight(deserializeFinalized(firstUserTx!), { contractAddress: '00'.repeat(32), allowedCircuits: ALLOWED });
  const narrow = preflight(deserializeFinalized(firstUserTx!), { contractAddress: address, allowedCircuits: new Set(['advanceEpoch']) });
  log(`preflight with foreign address: ${foreign.ok ? 'ACCEPTED (bad)' : foreign.reason}; with narrow allow-list: ${narrow.ok ? 'ACCEPTED (bad)' : narrow.reason}`);

  // ── tamper: flip one byte of a fresh user tx before sponsoring ──
  const { bytes: fresh } = await prepareSponsoredCall(bankProviders.B, bankWallet.B, address, 'bankB', 'submitFlag', [rand(), 1n, rand(), 1n, await instPath('B')]);
  const tampered = Uint8Array.from(fresh);
  tampered[Math.floor(tampered.length / 2)] ^= 0x01;
  let tamperResult = 'ACCEPTED (bad)';
  try {
    const t = deserializeFinalized(tampered);
    const s = await addDustFeesAndFinalize(sponsor, t, new Date(Date.now() + 20 * 60_000));
    const id = await sponsor.wallet.submitTransaction(s);
    await sponsorProviders.publicDataProvider.watchForTxData(id);
  } catch (e) {
    tamperResult = `rejected (${(e instanceof Error ? e.message : String(e)).slice(0, 120)})`;
  }
  log(`tampered tx: ${tamperResult}`);

  // ── S6.1 linkability scan ──
  const keysOf = (w: WalletContext) => ({
    coinPublicKey: hexToBytes(w.shieldedSecretKeys.coinPublicKey),
    encryptionPublicKey: hexToBytes(w.shieldedSecretKeys.encryptionPublicKey),
    unshieldedVerifyingKey: hexToBytes(w.unshieldedKeystore.getPublicKey()),
    dustPublicKey: leLimbs(w.dustSecretKey.publicKey),
  });
  const hits: string[] = [];
  for (const n of ['A', 'B']) {
    for (const [name, key] of Object.entries(keysOf(bankWallet[n]))) {
      txs.forEach((t, i) => {
        if (key.length >= 16 && Buffer.from(t.bytes).includes(key)) hits.push(`bank ${n} ${name} in tx#${i} (by ${t.bank})`);
      });
    }
  }
  // 16-byte windows shared by both of A's txs but absent from B's: anything that links A's txs.
  const windows = (b: Uint8Array) => {
    const s = new Set<string>();
    for (let i = 0; i + 16 <= b.length; i++) s.add(Buffer.from(b.subarray(i, i + 16)).toString('hex'));
    return s;
  };
  const [a1, a2, b1] = txs.map((t) => windows(t.bytes));
  const linking = [...a1].filter((w) => a2.has(w) && !b1.has(w));
  log(`S6.1 key scan: ${hits.length === 0 ? '0 hits' : hits.join('; ')}`);
  log(`S6.1 A-only shared 16-byte windows: ${linking.length}${linking.length ? ' e.g. ' + linking.slice(0, 3).join(', ') : ''}`);

  // The genesis sponsor sits at its DUST cap and regenerates faster than these fees drain it,
  // so its balance is reported but not asserted on the local network.
  const ok = after.flagCount === 3n && dustA === 0n && dustB === 0n && !foreign.ok && !narrow.ok && !tamperResult.startsWith('ACCEPTED');
  console.log(JSON.stringify({ ok, address, keyHits: hits, linkingWindows: linking.length, txBytes: txs.map((t) => t.bytes.length) }));
  for (const w of [sponsor, bankWallet.A, bankWallet.B]) await w.wallet.stop();
  process.exit(ok ? 0 : 1);
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
