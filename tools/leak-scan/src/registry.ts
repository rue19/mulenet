// SPDX-License-Identifier: Apache-2.0
// Secrets registry (§8.1): everything that must never appear in an output.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Secret } from './scan.js';

const SECRET_FIELDS = new Set(['institutionSecret', 'signingSecretKey', 'walletSeed', 'storagePassword', 'guardianSecret', 'decryptionShare', 'secretKey']);

export const loadRegistry = (root: string, network: string): Secret[] => {
  const secrets: Secret[] = [];
  const dir = join(root, 'infra/secrets', network);
  if (existsSync(dir)) {
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.json'))) {
      const obj = JSON.parse(readFileSync(join(dir, f), 'utf8')) as Record<string, unknown>;
      for (const [k, v] of Object.entries(obj)) {
        if (!SECRET_FIELDS.has(k) || typeof v !== 'string') continue;
        const isHex = /^([0-9a-f]{2})+$/.test(v);
        secrets.push({ name: `${f.replace('.json', '')}.${k}`, value: isHex ? Buffer.from(v, 'hex') : v });
      }
    }
  }
  for (const envFile of ['infra/.env.sponsors.preprod', '.env']) {
    const p = join(root, envFile);
    if (!existsSync(p)) continue;
    for (const line of readFileSync(p, 'utf8').split('\n')) {
      const m = /^(SPONSOR_SEED_\d+|BLOCKFROST_PROJECT_ID|DEPLOYER_SEED)=(.+)$/.exec(line.trim());
      if (m) secrets.push({ name: m[1], value: /^([0-9a-f]{2})+$/.test(m[2]) ? Buffer.from(m[2], 'hex') : m[2] });
    }
  }
  // Values recorded by test runs: identifiers, subject tags, pseudonyms.
  const extra = join(root, 'test-artifacts/secrets.jsonl');
  if (existsSync(extra)) {
    for (const line of readFileSync(extra, 'utf8').split('\n').filter(Boolean)) {
      const { name, hex, text } = JSON.parse(line) as { name: string; hex?: string; text?: string };
      secrets.push({ name, value: hex ? Buffer.from(hex, 'hex') : text! });
    }
  }
  return secrets;
};
