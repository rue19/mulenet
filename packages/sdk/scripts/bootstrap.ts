// Deploys MuleNet and registers every consortium institution through 2-of-3 governance (§4.5).
// Setup is self-paid by the deployer wallet (genesis locally). Writes infra/state/<network>.json
// (address and deploy facts; no secrets).
// Usage: MN_PROOF_SERVER=http://127.0.0.1:6301 npx tsx scripts/bootstrap.ts [undeployed] [--epoch 300] [--ttl 2] [--k 2] [--skip bank-e]
// --skip leaves institutions unregistered (the demo onboards bank-e live through governance).
// MULENET_DEPLOYMENT=demo writes infra/state/<network>-demo.json instead of the main deployment.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { MuleNet, type MuleNetPrivateState } from '@mulenet/contract';
import { fromHex } from '@mulenet/crypto';
import { inMemoryPrivateStateProvider } from '@midnight-ntwrk/testkit-js';
import { GuardianSecret, InstitutionSecret, deploymentName, loadPublicConfig, loadSecret, statePath } from '../src/config.js';
import { GENESIS_SEED, buildWallet, deployMuleNet, ensureDust, joinAs, makeProviders, networks, readLedger, walletAndMidnightProvider } from '../src/index.js';

const pc = MuleNet.pureCircuits;
const network = (process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'undeployed') as 'undeployed' | 'preprod';
const arg = (name: string, dflt: number) => {
  const i = process.argv.indexOf(`--${name}`);
  return BigInt(i > 0 ? Number(process.argv[i + 1]) : dflt);
};
const log = (...a: unknown[]) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a);

const cfg = loadPublicConfig(network);
const net = networks[network]();
const deployerSeed = network === 'undeployed' ? GENESIS_SEED : process.env.DEPLOYER_SEED;
if (!deployerSeed) throw new Error('DEPLOYER_SEED is required outside the local network');

const wallet = await buildWallet(net, deployerSeed);
await ensureDust(wallet);
const providers = makeProviders(net, await walletAndMidnightProvider(wallet), inMemoryPrivateStateProvider<string, MuleNetPrivateState>());

const guardians = cfg.guardians.members.sort((a, b) => a.index - b.index);
const epochLength = arg('epoch', 300);
const deployed = await deployMuleNet(providers, 'deployer', {
  guardianLeaves: guardians.map((g) => fromHex(g.leaf)) as [Uint8Array, Uint8Array, Uint8Array],
  threshold: BigInt(cfg.guardians.threshold),
  k: arg('k', 2),
  epochLength,
  firstRollAt: BigInt(Math.floor(Date.now() / 1000)) + epochLength,
  ttl: arg('ttl', 2),
  flagQuota: 500n,
  revokeQuota: 3n,
});
const address = deployed.deployTxData.public.contractAddress;
log(`deployed ${address} at block ${deployed.deployTxData.public.blockHeight}`);

const gSecrets = guardians.map((g) => loadSecret(GuardianSecret, network, `guardian-${g.index}`));
const gHandles = await Promise.all(gSecrets.map((s, i) => joinAs(providers, address, `guardian-${i}`, { guardianSecret: fromHex(s.guardianSecret) })));
const gPath = async (i: number) => (await readLedger(providers, address)).guardians.pathForLeaf(BigInt(i), fromHex(guardians[i].leaf));

const skipIdx = process.argv.indexOf('--skip');
const skip = new Set(skipIdx > 0 ? process.argv[skipIdx + 1].split(',') : []);
for (const inst of cfg.institutions.filter((i) => !skip.has(i.id))) {
  const sk = fromHex(loadSecret(InstitutionSecret, network, inst.id).institutionSecret);
  const l = await readLedger(providers, address);
  const leaf = pc.institutionLeaf(sk, l.membershipGen);
  const id = pc.proposalId(1n, leaf, l.proposalNonce);
  await gHandles[0].callTx.propose(1n, leaf, await gPath(0));
  await gHandles[0].callTx.approve(id, await gPath(0));
  await gHandles[1].callTx.approve(id, await gPath(1));
  await gHandles[2].callTx.execute(id, 0n);
  log(`registered ${inst.id}`);
}

const state = {
  network,
  deployment: deploymentName(),
  contractAddress: address,
  deployedAtBlock: deployed.deployTxData.public.blockHeight,
  deployedAt: new Date().toISOString(),
  params: { epochLength: Number(epochLength), ttl: Number(arg('ttl', 2)), k: Number(arg('k', 2)), threshold: cfg.guardians.threshold },
  registered: cfg.institutions.filter((i) => !skip.has(i.id)).map((i) => i.id),
};
const out = statePath(network);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(state, null, 2) + '\n');
log(`wrote ${out}`);
await wallet.wallet.stop();
process.exit(0);
