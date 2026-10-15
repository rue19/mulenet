// SPDX-License-Identifier: Apache-2.0
// A contract handle for a party whose wallet holds zero DUST (bank nodes, guardian daemons).
// The party proves and binds its own calls; the consortium sponsor pays the fee (R1).
import { type MuleNet, type MuleNetPrivateState } from '@mulenet/contract';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { signRequest, type SigningKey } from '@mulenet/service-kit';
import { joinAs, makeProviders, prepareSponsoredCall, readLedger, type CircuitId } from './contract.js';
import type { NetworkConfig } from './networks.js';
import { buildWallet, waitForSync, walletAndMidnightProvider, type WalletContext } from './wallet.js';

export type SponsoredChainOptions = {
  net: NetworkConfig;
  contractAddress: string;
  privateStateId: string;
  privateState: MuleNetPrivateState;
  walletSeed: string;
  storagePassword: string;
  dataDir: string;
  sponsorUrl: string;
  signingKey: SigningKey;
};

export class ChainError extends Error {}

export type SponsoredChain = {
  wallet: WalletContext;
  providers: ReturnType<typeof makeProviders>;
  ledger(): Promise<MuleNet.Ledger>;
  snapshot(): Promise<{ ledger: MuleNet.Ledger; blockHeight: number }>;
  sponsoredCall(circuit: CircuitId, args: unknown[]): Promise<{ txId: string; blockHeight: number }>;
  close(): Promise<void>;
};

const sameBytes = (a?: Uint8Array, b?: Uint8Array) => (!a && !b) || (!!a && !!b && Buffer.from(a).equals(Buffer.from(b)));

export const createSponsoredChain = async (o: SponsoredChainOptions): Promise<SponsoredChain> => {
  const wallet: WalletContext = await buildWallet(o.net, o.walletSeed);
  await waitForSync(wallet);

  const level = levelPrivateStateProvider<string, MuleNetPrivateState>({
    midnightDbName: `${o.dataDir}/private-state`,
    privateStateStoreName: o.privateStateId,
    signingKeyStoreName: `${o.privateStateId}-keys`,
    privateStoragePasswordProvider: () => o.storagePassword,
    accountId: wallet.unshieldedKeystore.getBech32Address().asString(),
  } as never);
  level.setContractAddress(o.contractAddress);

  // Canary (R12): a wrong password, or a store provisioned for another party, stops the
  // service at boot instead of surfacing deep inside a transaction.
  let existing: MuleNetPrivateState | null;
  try {
    existing = await level.get(o.privateStateId);
  } catch {
    throw new ChainError('cannot unlock private state: wrong storage password?');
  }
  if (
    existing &&
    (!sameBytes(existing.institutionSecret, o.privateState.institutionSecret) || !sameBytes(existing.guardianSecret, o.privateState.guardianSecret))
  ) {
    throw new ChainError('private state belongs to a different secret');
  }

  const providers = makeProviders(o.net, await walletAndMidnightProvider(wallet), level);
  await joinAs(providers, o.contractAddress, o.privateStateId, o.privateState);

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
    providers,
    ledger: () => readLedger(providers, o.contractAddress),
    async snapshot() {
      const [ledger, height] = await Promise.all([readLedger(providers, o.contractAddress), blockHeight()]);
      return { ledger, blockHeight: height };
    },
    // Contract asserts run while the call is built: a refused call never reaches proving or the sponsor.
    async sponsoredCall(circuit: CircuitId, args: unknown[]) {
      const { bytes } = await prepareSponsoredCall(providers, wallet, o.contractAddress, o.privateStateId, circuit, args);
      const txId = await sponsor(circuit, bytes);
      const fin = await providers.publicDataProvider.watchForTxData(txId);
      if (fin.status !== 'SucceedEntirely') throw new ChainError(`transaction ${txId} did not succeed: ${fin.status}`);
      return { txId, blockHeight: fin.blockHeight };
    },
    close: () => wallet.wallet.stop(),
  };
};

