// SPDX-License-Identifier: Apache-2.0
// Consortium configuration (decision X6). Public material lives in infra/config/<network>.json
// and is safe to commit; every secret lives in infra/secrets/<network>/<party>.json (gitignored,
// mode 0600) and is loaded only by the party that owns it.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { hex } from './api-types.js';

export const PublicConfig = z.object({
  network: z.enum(['undeployed', 'preprod']),
  contractAddress: z.string().optional(),
  oracles: z.object({
    threshold: z.number().int(),
    groupPublicKey: hex(32),
    members: z.array(z.object({ index: z.number().int(), url: z.string().url(), publicShare: hex(32), signingPublicKey: hex(32) })),
  }),
  guardians: z.object({
    threshold: z.number().int(),
    groupPublicKey: hex(32),
    members: z.array(
      z.object({ index: z.number().int(), url: z.string().url(), publicShare: hex(32), signingPublicKey: hex(32), leaf: hex(32) }),
    ),
  }),
  institutions: z.array(z.object({ id: z.string(), url: z.string().url(), signingPublicKey: hex(32) })),
  regulator: z.object({ id: z.string(), signingPublicKey: hex(32) }),
  relay: z.object({ url: z.string().url() }),
  sponsor: z.object({ url: z.string().url() }),
});
export type PublicConfig = z.infer<typeof PublicConfig>;

export const OracleSecret = z.object({ index: z.number().int(), secretKey: hex(32), signingSecretKey: hex(32) });
export const GuardianSecret = z.object({
  index: z.number().int(),
  guardianSecret: hex(32), // contract witness
  decryptionShare: hex(32), // threshold ElGamal share
  signingSecretKey: hex(32),
});
export const InstitutionSecret = z.object({
  id: z.string(),
  institutionSecret: hex(32), // contract witness
  signingSecretKey: hex(32),
  walletSeed: hex(32),
  storagePassword: z.string().min(16),
});
export const RegulatorSecret = z.object({ id: z.string(), signingSecretKey: hex(32) });

export const repoRoot = () => resolve(import.meta.dirname, '../../..');
export const configPath = (network: string) => resolve(repoRoot(), 'infra/config', `${network}.json`);
export const secretPath = (network: string, party: string) => resolve(repoRoot(), 'infra/secrets', network, `${party}.json`);

export const loadPublicConfig = (network: string, path = configPath(network)): PublicConfig =>
  PublicConfig.parse(JSON.parse(readFileSync(path, 'utf8')));

export const loadSecret = <T extends z.ZodTypeAny>(schema: T, network: string, party: string, path = secretPath(network, party)): z.infer<T> =>
  schema.parse(JSON.parse(readFileSync(path, 'utf8')));

// ── deployments ──
// Several contract instances can share one consortium config (e.g. `main` and a short-epoch
// `demo`, decision X9). MULENET_DEPLOYMENT picks one; each has its own state file and data dir.
export const deploymentName = (): string => process.env.MULENET_DEPLOYMENT ?? 'main';
const suffix = () => (deploymentName() === 'main' ? '' : `-${deploymentName()}`);
export const statePath = (network: string) => resolve(repoRoot(), 'infra/state', `${network}${suffix()}.json`);
export const dataDir = (network: string) => resolve(repoRoot(), '.data', `${network}${suffix()}`);

export type DeploymentState = { network: string; contractAddress: string; deployedAtBlock?: number; params?: Record<string, number> };
export const loadDeployment = (network: string): DeploymentState => JSON.parse(readFileSync(statePath(network), 'utf8'));
