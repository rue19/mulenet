// SPDX-License-Identifier: Apache-2.0
// Generates the sponsor wallet pool (§8.4). Seeds go to a gitignored, owner-only env file;
// only public addresses are printed, for the faucet.
import { randomBytes } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DustSecretKey } from '@midnight-ntwrk/midnight-js-protocol/ledger';
import { getDustSeed, getUnshieldedSeed } from '@midnight-ntwrk/testkit-js';
import { DustAddress, createKeystore } from '@midnight-ntwrk/wallet-sdk';

const networkId = (process.argv[2] ?? 'preprod') as 'preprod';
const count = Number(process.argv[3] ?? 3);
const out = resolve(import.meta.dirname, `../../../infra/.env.sponsors.${networkId}`);
if (existsSync(out)) {
  console.error(`${out} already exists; refusing to overwrite existing seeds.`);
  process.exit(1);
}

const lines: string[] = [];
for (let i = 0; i < count; i++) {
  const seed = randomBytes(32).toString('hex');
  const night = createKeystore(getUnshieldedSeed(seed), networkId).getBech32Address().asString();
  const dust = DustAddress.encodePublicKey(networkId, DustSecretKey.fromSeed(getDustSeed(seed)).publicKey);
  lines.push(`SPONSOR_SEED_${i}=${seed}`);
  console.log(`sponsor ${i}\n  NIGHT (faucet): ${night}\n  DUST:           ${dust}`);
}
writeFileSync(out, lines.join('\n') + '\n', { mode: 0o600 });
console.log(`\nSeeds written to ${out} (mode 600, gitignored).`);
