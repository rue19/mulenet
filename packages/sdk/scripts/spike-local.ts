// Day-1 spike on the local `undeployed` network (§13.3):
//   1. deploy, register four institutions through 2-of-3 governance
//   2. prove two submitFlag calls against the SAME ledger state, then submit both —
//      both must land (PLAN.md §1.1: insert() takes the next free index on-chain)
//   3. attest k=3, revoke, and time every proof
//   4. scan the real on-chain transaction bytes for T, instSecret and pseudonyms
// Usage: MN_PROOF_SERVER=http://127.0.0.1:6301 npx tsx scripts/spike-local.ts [label]
import { randomBytes } from 'node:crypto';
import { MuleNet, type MuleNetPrivateState } from '@mulenet/contract';
import { inMemoryPrivateStateProvider } from '@midnight-ntwrk/testkit-js';
import {
  GENESIS_SEED,
  balances,
  buildCall,
  buildWallet,
  deployMuleNet,
  ensureDust,
  joinAs,
  makeProviders,
  networks,
  readLedger,
  submitBuilt,
  waitForSync,
  walletAndMidnightProvider,
  type MuleNetHandle,
  type ProofTiming,
} from '../src/index.js';

const pc = MuleNet.pureCircuits;
const label = process.argv[2] ?? 'run';
const log = (...a: unknown[]) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a);
const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');
const rand = () => new Uint8Array(randomBytes(32));

const timings: ProofTiming[] = [];
const results: { circuit: string; proveMs: number; totalMs: number; blockHeight?: number }[] = [];

const timed = async <T extends { public: { blockHeight: number } }>(circuit: string, fn: () => Promise<T>): Promise<T> => {
  const before = timings.length;
  const t = performance.now();
  const out = await fn();
  const proveMs = timings.slice(before).reduce((s, x) => s + x.ms, 0);
  results.push({ circuit, proveMs, totalMs: performance.now() - t, blockHeight: out.public.blockHeight });
  log(`${circuit}: prove ${(proveMs / 1000).toFixed(1)} s, total ${((performance.now() - t) / 1000).toFixed(1)} s, block ${out.public.blockHeight}`);
  return out;
};

const main = async () => {
  const net = networks.undeployed();
  log(`proof server ${net.proofServer}`);

  const wallet = await buildWallet(net, GENESIS_SEED);
  await waitForSync(wallet);
  await ensureDust(wallet);
  log('genesis wallet', balances(await waitForSync(wallet)));

  const providers = makeProviders(net, await walletAndMidnightProvider(wallet), inMemoryPrivateStateProvider<string, MuleNetPrivateState>(), timings);

  // ── deploy ──
  const guardianSecrets = [rand(), rand(), rand()];
  const now = BigInt(Math.floor(Date.now() / 1000));
  const t0 = performance.now();
  const deployed = await deployMuleNet(providers, 'deployer', {
    guardianLeaves: guardianSecrets.map((g) => pc.guardianLeaf(g)) as [Uint8Array, Uint8Array, Uint8Array],
    threshold: 2n,
    k: 3n,
    epochLength: 86_400n,
    firstRollAt: now + 86_400n,
    ttl: 30n,
    flagQuota: 500n,
    revokeQuota: 3n,
  });
  const address = deployed.deployTxData.public.contractAddress;
  log(`deployed ${address} in ${((performance.now() - t0) / 1000).toFixed(1)} s`);

  const guardian = await Promise.all(guardianSecrets.map((g, i) => joinAs(providers, address, `guardian${i}`, { guardianSecret: g })));
  const bankSecrets = Object.fromEntries(['A', 'B', 'C', 'D'].map((n) => [n, rand()])) as Record<string, Uint8Array>;
  const bank: Record<string, MuleNetHandle> = {};
  for (const [n, sk] of Object.entries(bankSecrets)) bank[n] = await joinAs(providers, address, `bank${n}`, { institutionSecret: sk });

  const L = () => readLedger(providers, address);
  const gPath = async (i: number) => (await L()).guardians.pathForLeaf(BigInt(i), pc.guardianLeaf(guardianSecrets[i]));
  const instPath = async (n: string) => {
    const l = await L();
    const p = l.institutions.findPathForLeaf(pc.institutionLeaf(bankSecrets[n], l.membershipGen));
    if (!p) throw new Error(`bank ${n} not registered`);
    return p;
  };

  // ── governance: register A–D ──
  for (const [i, n] of ['A', 'B', 'C', 'D'].entries()) {
    const leaf = pc.institutionLeaf(bankSecrets[n], 0n);
    const id = pc.proposalId(1n, leaf, (await L()).proposalNonce);
    const first = i === 0;
    const run = <T extends { public: { blockHeight: number } }>(c: string, f: () => Promise<T>) => (first ? timed(c, f) : f());
    await run('propose', async () => guardian[0].callTx.propose(1n, leaf, await gPath(0)));
    await run('approve', async () => guardian[0].callTx.approve(id, await gPath(0)));
    await guardian[1].callTx.approve(id, await gPath(1));
    await run('execute', () => guardian[2].callTx.execute(id, 0n));
    log(`registered bank ${n}`);
  }

  // ── flags ──
  const S = rand(); // stands in for an OPRF tag T
  const flagRec: Record<string, { ctHash: Uint8Array; leaf: Uint8Array; epoch: bigint }> = {};
  const flagArgs = async (n: string, slot: bigint) => {
    const ctHash = rand();
    const epoch = (await L()).currentEpoch;
    flagRec[n] = { ctHash, epoch, leaf: pc.flagLeaf(S, pc.pseudonym(bankSecrets[n], S), epoch, 1n, ctHash) };
    return [S, 1n, ctHash, slot, await instPath(n)];
  };

  const flagA = await timed('submitFlag', async () => {
    const [t, ty, ct, slot, path] = await flagArgs('A', 0n);
    return bank.A.callTx.submitFlag(t as Uint8Array, ty as bigint, ct as Uint8Array, slot as bigint, path as never);
  });

  // Concurrency test: B and C both build against the state after A's flag.
  const stateBefore = await L();
  const callB = await buildCall(providers, address, 'bankB', 'submitFlag', await flagArgs('B', 0n));
  const callC = await buildCall(providers, address, 'bankC', 'submitFlag', await flagArgs('C', 0n));
  log(`built B and C against flagCount=${stateBefore.flagCount}, firstFree=${stateBefore.flags.firstFree()}`);
  const subB = await timed('submitFlag (stale-state B)', async () => ({ public: await submitBuilt(providers, callB.private.unprovenTx, 'submitFlag') }));
  const subC = await timed('submitFlag (stale-state C)', async () => ({ public: await submitBuilt(providers, callC.private.unprovenTx, 'submitFlag') }));
  const afterFlags = await L();
  const concurrencyOk =
    afterFlags.flagCount === 3n && ['A', 'B', 'C'].every((n) => afterFlags.flags.findPathForLeaf(flagRec[n].leaf) !== undefined);
  log(`concurrency test: ${concurrencyOk ? 'PASS' : 'FAIL'} (flagCount=${afterFlags.flagCount})`);

  // ── attest k=3 ──
  const slot = async (n: string) => {
    const l = await L();
    const r = flagRec[n];
    const path = l.flags.findPathForLeaf(r.leaf);
    if (!path) throw new Error(`flag of ${n} missing`);
    return { pseudonym: pc.pseudonym(bankSecrets[n], S), epoch: r.epoch, ctHash: r.ctHash, path };
  };
  const slots = [await slot('A'), await slot('B'), await slot('C')];
  const att = await timed('attestCorroboration3', async () =>
    bank.D.callTx.attestCorroboration3(S, 1n, slots, await instPath('D'), rand()),
  );
  const attKey = pc.attestationKey(S, (await L()).currentEpoch, 1n);
  log(`attestation k=${(await L()).attestations.lookup(attKey).k}`);

  // ── revoke C ──
  const revIndex = BigInt(pc.pathIndex(slots[2].path));
  const rev = await timed('revokeFlag', async () =>
    bank.C.callTx.revokeFlag(S, flagRec.C.epoch, 1n, flagRec.C.ctHash, revIndex, 0n, (await slot('C')).path, await instPath('C')),
  );
  log(`revocationCount=${(await L()).revocationCount}`);

  // ── leak scan over real on-chain transaction bytes (I8 preview) ──
  const secrets: Record<string, Uint8Array> = { T: S };
  for (const n of ['A', 'B', 'C', 'D']) {
    secrets[`instSecret${n}`] = bankSecrets[n];
    secrets[`pseudonym${n}`] = pc.pseudonym(bankSecrets[n], S);
  }
  guardianSecrets.forEach((g, i) => (secrets[`guardianSecret${i}`] = g));
  const txs = { flagA, subB, subC, att, rev } as unknown as Record<string, { public: { tx: { serialize(): Uint8Array } } }>;
  const leaks: string[] = [];
  for (const [txName, tx] of Object.entries(txs)) {
    const bytes = Buffer.from(tx.public.tx.serialize());
    for (const [name, secret] of Object.entries(secrets)) {
      if (bytes.includes(Buffer.from(secret))) leaks.push(`${name} in ${txName}`);
      if (bytes.toString('hex').includes(hex(secret))) leaks.push(`${name} (hex) in ${txName}`);
    }
  }
  log(`leak scan: ${leaks.length === 0 ? 'PASS (0 hits)' : 'FAIL ' + leaks.join(', ')}`);

  console.log(JSON.stringify({ label, address, concurrencyOk, leaks, results }, null, 2));
  await wallet.wallet.stop();
  process.exit(concurrencyOk && leaks.length === 0 ? 0 : 1);
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
