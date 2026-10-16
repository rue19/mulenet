// Preprod readiness (plan P6-0): endpoints answer, and each sponsor wallet is funded and
// registered for DUST. With --register, unregistered NIGHT is registered for DUST generation.
// Requires BLOCKFROST_PROJECT_ID (a Midnight Preprod project, "nightpreprod…") in the environment.
// Usage: npx tsx scripts/smoke-preprod.ts [--register]
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { balances, buildWallet, ensureDust, networks, redact, waitForSync } from '../src/index.js';
import { repoRoot } from '../src/config.js';

const log = (...a: unknown[]) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a);
const net = networks.preprod();
if (!process.env.BLOCKFROST_PROJECT_ID?.startsWith('nightpreprod')) console.warn('warning: BLOCKFROST_PROJECT_ID should start with "nightpreprod"');

// 1. Node RPC identifies the chain.
const rpc = await fetch(net.node, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'system_chain', params: [] }) });
const chain = ((await rpc.json()) as { result?: string }).result;
log(`node ${redact(net.node)}: system_chain = ${chain}`);
if (!chain || !/preprod/i.test(chain)) throw new Error('node RPC is not Midnight Preprod');

// 2. Indexer has blocks.
const idx = await fetch(net.indexer, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query: '{ block { height } }' }) });
const height = ((await idx.json()) as { data?: { block?: { height?: number } } }).data?.block?.height ?? 0;
log(`indexer ${redact(net.indexer)}: height ${height}`);
if (!(height > 0)) throw new Error('indexer reports no blocks');

// 3. Sponsor wallets. A first sync from genesis can take a long time on Preprod.
const seeds = readFileSync(resolve(repoRoot(), 'infra/.env.sponsors.preprod'), 'utf8')
  .split('\n')
  .filter((l) => l.startsWith('SPONSOR_SEED_'))
  .map((l) => l.split('=')[1].trim());
for (const [i, seed] of seeds.entries()) {
  const w = await buildWallet(net, seed);
  log(`sponsor ${i}: ${w.unshieldedKeystore.getBech32Address().asString()} syncing…`);
  const s = await waitForSync(w, 3 * 3_600_000);
  const b = balances(s);
  const unregistered = s.unshielded?.availableCoins.filter((c) => !c.meta.registeredForDustGeneration).length ?? 0;
  log(`sponsor ${i}: NIGHT ${b.night}, DUST ${b.dust} (${b.dustCoins} spendable coins), ${unregistered} unregistered NIGHT UTXOs`);
  if (process.argv.includes('--register') && b.night > 0n && (unregistered > 0 || b.dustCoins === 0)) {
    log(`sponsor ${i}: registering NIGHT for DUST generation…`);
    await ensureDust(w, 6 * 3_600_000);
    log(`sponsor ${i}: spendable DUST available`);
  }
  await w.wallet.stop();
}
process.exit(0);
