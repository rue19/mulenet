// SPDX-License-Identifier: Apache-2.0
// BANK_ID=bank-a MULENET_NETWORK=undeployed tsx src/main.ts
import { resolve } from 'node:path';
import { fromHex } from '@mulenet/crypto';
import { networks } from '@mulenet/sdk';
import { InstitutionSecret, loadPublicConfig, loadSecret, repoRoot } from '@mulenet/sdk/config';
import { createOprfClient } from '@mulenet/sdk/oprf-client';
import { createRelayClient } from '@mulenet/sdk/relay-client';
import { readFileSync } from 'node:fs';
import { createChain } from './chain.js';
import { buildBankNode } from './server.js';
import { openStore } from './store.js';

const network = (process.env.MULENET_NETWORK ?? 'undeployed') as 'undeployed' | 'preprod';
const bankId = process.env.BANK_ID ?? 'bank-a';
const cfg = loadPublicConfig(network);
const secret = loadSecret(InstitutionSecret, network, bankId);
const me = cfg.institutions.find((i) => i.id === bankId);
if (!me) throw new Error(`${bankId} is not in the consortium config`);
const contractAddress =
  cfg.contractAddress ?? JSON.parse(readFileSync(resolve(repoRoot(), `infra/state/${network}.json`), 'utf8')).contractAddress;

const dataDir = process.env.BANK_DATA ?? resolve(repoRoot(), `.data/${network}/${bankId}`);
const signingKey = { id: bankId, secretKey: fromHex(secret.signingSecretKey) };
const chain = await createChain({
  net: networks[network](),
  contractAddress,
  institutionId: bankId,
  institutionSecret: fromHex(secret.institutionSecret),
  walletSeed: secret.walletSeed,
  storagePassword: secret.storagePassword,
  dataDir,
  sponsorUrl: cfg.sponsor.url,
  signingKey,
});

const { app } = buildBankNode({
  deps: {
    institutionId: bankId,
    institutionSecret: fromHex(secret.institutionSecret),
    guardianGroupKey: fromHex(cfg.guardians.groupPublicKey),
    store: openStore(`${dataDir}/bank.db`),
    oprf: createOprfClient({ oracles: cfg.oracles, signingKey }),
    relay: createRelayClient({ urls: [cfg.relay.url], signingKey }),
    chain,
  },
  // In the demo the bank's own systems and the console sign as the bank itself.
  clients: new Map([[bankId, fromHex(me.signingPublicKey)]]),
});
app.addHook('onClose', () => chain.close());
await app.listen({ host: process.env.HOST ?? '127.0.0.1', port: Number(process.env.PORT ?? new URL(me.url).port) });
