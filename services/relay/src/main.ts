// SPDX-License-Identifier: Apache-2.0
// MULENET_NETWORK=undeployed tsx src/main.ts
import { resolve } from 'node:path';
import { fromHex } from '@mulenet/crypto';
import { dataDir, loadPublicConfig } from '@mulenet/sdk/config';
import { buildRelay } from './server.js';

const network = process.env.MULENET_NETWORK ?? 'undeployed';
const cfg = loadPublicConfig(network);
const members = new Map([
  ...cfg.institutions.map((i) => [i.id, fromHex(i.signingPublicKey)] as const),
  ...cfg.guardians.members.map((g) => [`guardian-${g.index}`, fromHex(g.signingPublicKey)] as const),
  [cfg.regulator.id, fromHex(cfg.regulator.signingPublicKey)] as const,
]);
const { app } = buildRelay({ members, dbPath: process.env.RELAY_DB ?? resolve(dataDir(network), 'relay.db') });
await app.listen({ host: process.env.HOST ?? '127.0.0.1', port: Number(process.env.PORT ?? new URL(cfg.relay.url).port) });
