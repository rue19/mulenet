// SPDX-License-Identifier: Apache-2.0
// The bank node's view of the chain (§4.3 boot sequence). The bank's wallet holds zero DUST:
// it proves and binds its own transactions, and the consortium sponsor pays the fee (R1).
import { MuleNet, type MuleNetPrivateState } from '@mulenet/contract';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { joinAs, makeProviders, prepareSponsoredCall, readLedger, type NetworkConfig } from '@mulenet/sdk';
import { buildWallet, waitForSync, walletAndMidnightProvider, type WalletContext } from '@mulenet/sdk';
import { signRequest, type SigningKey } from '@mulenet/service-kit';
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

export class ChainError extends Error {}

const sameBytes = (a?: Uint8Array, b?: Uint8Array) => !!a && !!b && Buffer.from(a).equals(Buffer.from(b));

export const createChain = async (o: ChainOptions): Promise<Chain & { wallet: WalletContext; close(): Promise<void> }> => {
  const wallet = await buildWallet(o.net, o.walletSeed);
  await waitForSync(wallet);

  const privateStateId = `mulenet-${o.institutionId}`;
  const level = levelPrivateStateProvider<string, MuleNetPrivateState>({
    midnightDbName: `${o.dataDir}/private-state`,
    privateStateStoreName: privateStateId,
    signingKeyStoreName: `${privateStateId}-keys`,
    privateStoragePasswordProvider: () => o.storagePassword,
    accountId: wallet.unshieldedKeystore.getBech32Address().asString(),
  } as never);
  level.setContractAddress(o.contractAddress);

  // Canary (R12): a wrong password, or a store provisioned for another institution, stops
  // the node at boot instead of surfacing deep inside a transaction.
  let existing: MuleNetPrivateState | null;
  try {
    existing = await level.get(privateStateId);
  } catch {
    throw new ChainError('cannot unlock private state: wrong storage password?');
  }
  if (existing && !sameBytes(existing.institutionSecret, o.institutionSecret)) {
    throw new ChainError('private state belongs to a different institution secret');
  }

  const providers = makeProviders(o.net, await walletAndMidnightProvider(wallet), level);
  await joinAs(providers, o.contractAddress, privateStateId, { institutionSecret: o.institutionSecret });

  let cachedPath: { gen: bigint; path: ReturnType<MuleNet.Ledger['institutions']['pathForLeaf']> } | undefined;

  const blockHeight = async (): Promise<number> => {
    const res = await fetch(o.net.indexer, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: '{ block { height } }' }),
    });
    const j = (await res.json()) as { data?: { block?: { height?: number } } };
    return j.data?.block?.height ?? 0;
  };

  const sponsor = async (circuit: string, bytes: Uint8Array): Promise<string> => {
    const body = new TextEncoder().encode(JSON.stringify({ txHex: Buffer.from(bytes).toString('hex'), circuit }));
    const res = await fetch(`${o.sponsorUrl}/v1/sponsor`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...signRequest(o.signingKey, 'POST', '/v1/sponsor', body) },
      body,
      signal: AbortSignal.timeout(180_000),
    });
    const j = (await res.json()) as { txId?: string; reason?: string; detail?: string };
    if (!res.ok || !j.txId) throw new ChainError(`sponsor refused (${res.status}): ${j.reason ?? 'unknown'} ${j.detail ?? ''}`.trim());
    return j.txId;
  };

  return {
    wallet,
    async snapshot() {
      const [ledger, height] = await Promise.all([readLedger(providers, o.contractAddress), blockHeight()]);
      return { ledger, blockHeight: height };
    },
    async sponsoredCall(circuit, args) {
      // Contract asserts run here, while the call is built: a refused call never reaches proving or the sponsor.
      const { bytes } = await prepareSponsoredCall(providers, wallet, o.contractAddress, privateStateId, circuit, args);
      const txId = await sponsor(circuit, bytes);
      const fin = await providers.publicDataProvider.watchForTxData(txId);
      if (fin.status !== 'SucceedEntirely') throw new ChainError(`transaction ${txId} did not succeed: ${fin.status}`);
      return { txId, blockHeight: fin.blockHeight };
    },
    async institutionPath() {
      const l = await readLedger(providers, o.contractAddress);
      // The institutions tree never resets its history, so a path stays valid until the generation changes.
      if (cachedPath && cachedPath.gen === l.membershipGen) return cachedPath.path;
      const path = l.institutions.findPathForLeaf(pc.institutionLeaf(o.institutionSecret, l.membershipGen));
      if (!path) throw new ChainError('not bound: this institution is not registered at the current generation');
      cachedPath = { gen: l.membershipGen, path };
      return path;
    },
    pathIndex: (path) => pc.pathIndex(path),
    close: () => wallet.wallet.stop(),
  };
};
