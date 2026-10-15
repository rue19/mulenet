// SPDX-License-Identifier: Apache-2.0
// ORACLE_INDEX=1 MULENET_NETWORK=undeployed tsx src/main.ts
import { fromHex } from '@mulenet/crypto';
import { OracleSecret, loadPublicConfig, loadSecret, repoRoot } from '@mulenet/sdk/config';
import { resolve } from 'node:path';
import { buildOracle } from './server.js';

const network = process.env.MULENET_NETWORK ?? 'undeployed';
const index = Number(process.env.ORACLE_INDEX ?? 1);
const cfg = loadPublicConfig(network);
const secret = loadSecret(OracleSecret, network, `oracle-${index}`);
const member = cfg.oracles.members.find((m) => m.index === index);
if (!member) throw new Error(`oracle ${index} is not in the consortium config`);

const { app } = buildOracle({
  key: { index, secretKey: fromHex(secret.secretKey), publicKey: fromHex(member.publicShare) },
  groupPublicKey: fromHex(cfg.oracles.groupPublicKey),
  threshold: cfg.oracles.threshold,
  institutions: new Map(cfg.institutions.map((i) => [i.id, fromHex(i.signingPublicKey)])),
  dbPath: process.env.ORACLE_DB ?? resolve(repoRoot(), `.data/${network}/oracle-${index}.db`),
  dailyQuota: Number(process.env.ORACLE_DAILY_QUOTA ?? 5_000),
});

const port = Number(process.env.PORT ?? new URL(member.url).port);
await app.listen({ host: process.env.HOST ?? '127.0.0.1', port });
