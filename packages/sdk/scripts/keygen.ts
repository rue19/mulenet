// Generates all consortium keys for one network (trusted dealer, ADR 0014):
//   infra/config/<network>.json             public config (commit this)
//   infra/secrets/<network>/<party>.json     one secret file per party, mode 0600 (gitignored)
// Usage: npx tsx scripts/keygen.ts [undeployed|preprod] [--force]
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { dealGuardianKeys, dealOracleKeys, hash, toHex } from '@mulenet/crypto';
import { generateSigningKey } from '@mulenet/service-kit';
import { configPath, secretPath, type PublicConfig } from '../src/config.js';

const network = (process.argv[2] ?? 'undeployed') as PublicConfig['network'];
const force = process.argv.includes('--force');
const BANKS = ['bank-a', 'bank-b', 'bank-c', 'bank-d', 'bank-e'];
const host = (svc: string, port: number) => (network === 'undeployed' ? `http://127.0.0.1:${port}` : `http://${svc}:${port}`);

if (existsSync(configPath(network)) && !force) {
  console.error(`${configPath(network)} exists; pass --force to regenerate (this invalidates every existing key).`);
  process.exit(1);
}

const writeSecret = (party: string, value: unknown) => {
  const p = secretPath(network, party);
  mkdirSync(dirname(p), { recursive: true, mode: 0o700 });
  writeFileSync(p, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
};
const rand32 = () => toHex(new Uint8Array(randomBytes(32)));
// ≥16 chars, all four character classes (level provider rule, R12).
const password = () => `Mn-${randomBytes(18).toString('base64url')}-9a`;

const oracleKeys = dealOracleKeys(2, 3);
const oracles = oracleKeys.shares.map((s) => {
  const sig = generateSigningKey(`oracle-${s.index}`);
  writeSecret(`oracle-${s.index}`, { index: s.index, secretKey: toHex(s.secretKey), signingSecretKey: toHex(sig.secretKey) });
  return { index: s.index, url: host(`oracle-${s.index}`, 7100 + s.index), publicShare: toHex(s.publicKey), signingPublicKey: toHex(sig.publicKey) };
});

const guardianKeys = dealGuardianKeys(2, 3);
const guardians = guardianKeys.shares.map((s) => {
  const sig = generateSigningKey(`guardian-${s.index}`);
  const guardianSecret = rand32();
  writeSecret(`guardian-${s.index}`, {
    index: s.index,
    guardianSecret,
    decryptionShare: toHex(s.secretKey),
    signingSecretKey: toHex(sig.secretKey),
  });
  return {
    index: s.index,
    url: host(`guardian-${s.index}`, 7500 + s.index),
    publicShare: toHex(s.publicKey),
    signingPublicKey: toHex(sig.publicKey),
    leaf: toHex(hash.guardianLeaf(Buffer.from(guardianSecret, 'hex'))),
  };
});

const institutions = BANKS.map((id, i) => {
  const sig = generateSigningKey(id);
  writeSecret(id, {
    id,
    institutionSecret: rand32(),
    signingSecretKey: toHex(sig.secretKey),
    walletSeed: rand32(),
    storagePassword: password(),
  });
  return { id, url: host(id, 7401 + i), signingPublicKey: toHex(sig.publicKey) };
});

const regulatorKey = generateSigningKey('regulator');
writeSecret('regulator', { id: 'regulator', signingSecretKey: toHex(regulatorKey.secretKey) });

const config: PublicConfig = {
  network,
  oracles: { threshold: 2, groupPublicKey: toHex(oracleKeys.groupPublicKey), members: oracles },
  guardians: { threshold: 2, groupPublicKey: toHex(guardianKeys.groupPublicKey), members: guardians },
  institutions,
  regulator: { id: 'regulator', signingPublicKey: toHex(regulatorKey.publicKey) },
  relay: { url: host('relay', 7200) },
  sponsor: { url: host('sponsor', 7300) },
};
mkdirSync(dirname(configPath(network)), { recursive: true });
writeFileSync(configPath(network), JSON.stringify(config, null, 2) + '\n');
console.log(`wrote ${configPath(network)} and ${3 + 3 + BANKS.length + 1} secret files under infra/secrets/${network}/`);
