// SPDX-License-Identifier: Apache-2.0
// Server-only access to the consortium. In the demo the console acts for every persona (each
// bank's analyst, the regulator, each guardian operator) using their keys from infra/secrets;
// none of these keys, nor any chain token, ever reaches the browser.
import 'server-only';
import { bankClient, guardianOperator, regulatorClient } from '@mulenet/sdk/clients';
import { deploymentName, loadDeployment, loadPublicConfig } from '@mulenet/sdk/config';

export const NETWORK = process.env.MULENET_NETWORK ?? 'undeployed';
export const DEPLOYMENT = () => deploymentName();
export const EXPLORER = process.env.MULENET_EXPLORER_URL ?? 'http://127.0.0.1:7600';

export const consortium = () => loadPublicConfig(NETWORK);
export const deployment = () => loadDeployment(NETWORK);
export const bankIds = () => consortium().institutions.map((i) => i.id);

const banks = new Map<string, ReturnType<typeof bankClient>>();
export const bank = (id: string) => {
  if (!bankIds().includes(id)) throw new Error('unknown bank');
  if (!banks.has(id)) banks.set(id, bankClient(NETWORK, id));
  return banks.get(id)!;
};
export const guardian = (index: number) => guardianOperator(NETWORK, index);
export const regulator = () => regulatorClient(NETWORK);

export const explorer = async <T>(path: string): Promise<T | null> => {
  try {
    const r = await fetch(`${EXPLORER}/v1/${DEPLOYMENT()}${path}`, { cache: 'no-store' });
    return r.ok ? ((await r.json()) as T) : null;
  } catch {
    return null;
  }
};

// Explorer links for a transaction receipt (§7.2): Preprod has three public explorers.
export const txLinks = (txHash: string) =>
  NETWORK === 'preprod'
    ? [
        { label: 'midnightexplorer', href: `https://preprod.midnightexplorer.com/tx/${txHash}` },
        { label: 'subscan', href: `https://midnight-preprod.subscan.io/extrinsic/${txHash}` },
        { label: '1am', href: `https://explorer.1am.xyz/tx/${txHash}?network=preprod` },
      ]
    : [{ label: 'local explorer', href: `${EXPLORER}/v1/${DEPLOYMENT()}/actions` }];
