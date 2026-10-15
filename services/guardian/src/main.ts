// SPDX-License-Identifier: Apache-2.0
// GUARDIAN_INDEX=1 MULENET_NETWORK=undeployed tsx src/main.ts
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { MuleNet } from '@mulenet/contract';
import { fromHex, toHex } from '@mulenet/crypto';
import { createSponsoredChain, networks } from '@mulenet/sdk';
import { GuardianSecret, dataDir, loadDeployment, loadPublicConfig, loadSecret } from '@mulenet/sdk/config';
import { buildGuardian } from './server.js';

const pc = MuleNet.pureCircuits;
const network = (process.env.MULENET_NETWORK ?? 'undeployed') as 'undeployed' | 'preprod';
const index = Number(process.env.GUARDIAN_INDEX ?? 1);
const cfg = loadPublicConfig(network);
const me = cfg.guardians.members.find((g) => g.index === index);
if (!me) throw new Error(`guardian ${index} is not in the consortium config`);
const secret = loadSecret(GuardianSecret, network, `guardian-${index}`);
const contractAddress = loadDeployment(network).contractAddress;

// The guardian's (zero-DUST) wallet seed and store password are derived from its secret.
const derive = (label: string) => createHash('sha256').update(`mulenet:guardian:${label}:v1`).update(fromHex(secret.guardianSecret)).digest('hex');
const guardianSecret = fromHex(secret.guardianSecret);
const signingKey = { id: `guardian-${index}`, secretKey: fromHex(secret.signingSecretKey) };
const chain = await createSponsoredChain({
  net: networks[network](),
  contractAddress,
  privateStateId: `mulenet-guardian-${index}`,
  privateState: { guardianSecret },
  walletSeed: derive('wallet'),
  storagePassword: `Mg-${derive('store').slice(0, 24)}-X!`,
  dataDir: resolve(dataDir(network), `guardian-${index}`),
  sponsorUrl: cfg.sponsor.url,
  signingKey,
});
const gPath = async () => (await chain.ledger()).guardians.pathForLeaf(BigInt(index - 1), fromHex(me.leaf));

const { app } = buildGuardian({
  key: { index, secretKey: fromHex(secret.decryptionShare), publicKey: fromHex(me.publicShare) },
  ledger: chain.ledger,
  pathIndex: (p) => pc.pathIndex(p),
  governance: {
    async propose(kind, payload) {
      const id = pc.proposalId(kind, payload, (await chain.ledger()).proposalNonce);
      const { txId } = await chain.sponsoredCall('propose', [kind, payload, await gPath()]);
      return { txId, proposalId: toHex(id) };
    },
    approve: async (id) => ({ txId: (await chain.sponsoredCall('approve', [id, await gPath()])).txId }),
    execute: async (id, value) => ({ txId: (await chain.sponsoredCall('execute', [id, value])).txId }),
  },
  regulator: { id: cfg.regulator.id, publicKey: fromHex(cfg.regulator.signingPublicKey) },
  // The guardian's own signing key is its operator key (the console signs as each operator in the demo).
  operator: { id: signingKey.id, publicKey: fromHex(me.signingPublicKey) },
  dbPath: resolve(dataDir(network), `guardian-${index}/guardian.db`),
});
app.addHook('onClose', () => chain.close());
await app.listen({ host: process.env.HOST ?? '127.0.0.1', port: Number(process.env.PORT ?? new URL(me.url).port) });
