// Syncs every bank and guardian wallet once and snapshots it, one at a time (gentle on the
// Blockfrost rate limit), so services start without a sync from genesis.
// Usage: npx tsx scripts/prewarm-wallets.ts preprod
import { GuardianSecret, InstitutionSecret, guardianDerived, loadPublicConfig, loadSecret, walletStatePath } from '../src/config.js';
import { buildWallet, networks, saveWalletState, waitForSync } from '../src/index.js';

const network = (process.argv[2] ?? 'preprod') as 'preprod';
const log = (...a: unknown[]) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a);
process.on('unhandledRejection', (e) => {
  log(`unhandled rejection: ${e instanceof Error ? e.stack : String(e)}`);
  process.exit(1);
});
const net = networks[network]();
const cfg = loadPublicConfig(network);
const parties = [
  ...cfg.institutions.map((i) => ({ name: i.id, seed: loadSecret(InstitutionSecret, network, i.id).walletSeed })),
  ...cfg.guardians.members.map((g) => ({ name: `guardian-${g.index}`, seed: guardianDerived(loadSecret(GuardianSecret, network, `guardian-${g.index}`).guardianSecret).walletSeed })),
];
for (const p of parties) {
  const statePath = walletStatePath(network, p.seed)!;
  const t0 = Date.now();
  const w = await buildWallet(net, p.seed, { statePath });
  const timer = setInterval(() => void saveWalletState(w, net, statePath).catch(() => {}), 120_000);
  await waitForSync(w, 3 * 3_600_000);
  clearInterval(timer);
  await saveWalletState(w, net, statePath);
  log(`${p.name}: synced and snapshotted in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  await w.wallet.stop();
}
log('all wallets warm');
process.exit(0);
