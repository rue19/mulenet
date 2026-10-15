// SPDX-License-Identifier: Apache-2.0
// The bank node's view of the chain (§4.3 boot sequence), on top of the shared sponsored chain.
import { MuleNet } from '@mulenet/contract';
import { ChainError, createSponsoredChain, type NetworkConfig } from '@mulenet/sdk';
import type { SigningKey } from '@mulenet/service-kit';
import type { Chain } from './flows.js';

const pc = MuleNet.pureCircuits;

export type ChainOptions = {
  net: NetworkConfig;
  contractAddress: string;
  institutionId: string;
  institutionSecret: Uint8Array;
  walletSeed: string;
  storagePassword: string;
  dataDir: string;
  sponsorUrl: string;
  signingKey: SigningKey;
};

export const createChain = async (o: ChainOptions) => {
  const base = await createSponsoredChain({ ...o, privateStateId: `mulenet-${o.institutionId}`, privateState: { institutionSecret: o.institutionSecret } });
  let cached: { gen: bigint; path: ReturnType<MuleNet.Ledger['institutions']['pathForLeaf']> } | undefined;

  const chain: Chain & { wallet: typeof base.wallet; close(): Promise<void> } = {
    wallet: base.wallet,
    snapshot: base.snapshot,
    sponsoredCall: (circuit, args) => base.sponsoredCall(circuit, args),
    async institutionPath() {
      const l = await base.ledger();
      // The institutions tree never resets its history, so a path stays valid until the generation changes.
      if (cached && cached.gen === l.membershipGen) return cached.path;
      const path = l.institutions.findPathForLeaf(pc.institutionLeaf(o.institutionSecret, l.membershipGen));
      if (!path) throw new ChainError('not bound: this institution is not registered at the current generation');
      cached = { gen: l.membershipGen, path };
      return path;
    },
    pathIndex: (path) => pc.pathIndex(path),
    close: base.close,
  };
  return chain;
};
