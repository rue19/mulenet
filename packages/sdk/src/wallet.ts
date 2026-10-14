// SPDX-License-Identifier: Apache-2.0
// Headless wallet built from a hex seed, following the wallet-sdk 1.2.0 pattern used by
// midnightntwrk/example-zkloan. Bank nodes eventually hold zero DUST and hand unbalanced
// transactions to the sponsor (§8.4); this full wallet is for the sponsor, deployer and spikes.
import * as ledger from '@midnight-ntwrk/midnight-js-protocol/ledger';
import type { MidnightProvider, UnboundTransaction, WalletProvider } from '@midnight-ntwrk/midnight-js-types';
import {
  DustWallet,
  HDWallet,
  InMemoryTransactionHistoryStorage,
  PublicKey as UnshieldedPublicKey,
  Roles,
  ShieldedWallet,
  UnshieldedWallet,
  WalletEntrySchema,
  WalletFacade,
  createKeystore,
  type FacadeState,
  type UnshieldedKeystore,
} from '@midnight-ntwrk/wallet-sdk';
import * as Rx from 'rxjs';
import { WebSocket } from 'ws';
import type { NetworkConfig } from './networks.js';

// The indexer client uses the global WebSocket.
(globalThis as { WebSocket?: unknown }).WebSocket ??= WebSocket;

export type WalletContext = {
  wallet: WalletFacade;
  shieldedSecretKeys: ledger.ZswapSecretKeys;
  dustSecretKey: ledger.DustSecretKey;
  unshieldedKeystore: UnshieldedKeystore;
};

// Genesis wallet on the local `undeployed` network (holds all minted NIGHT).
export const GENESIS_SEED = '0'.repeat(63) + '1';

export const buildWallet = async (net: NetworkConfig, hexSeed: string): Promise<WalletContext> => {
  const hd = HDWallet.fromSeed(Buffer.from(hexSeed, 'hex'));
  if (hd.type !== 'seedOk') throw new Error('invalid wallet seed');
  const derived = hd.hdWallet.selectAccount(0).selectRoles([Roles.Zswap, Roles.NightExternal, Roles.Dust]).deriveKeysAt(0);
  if (derived.type !== 'keysDerived') throw new Error('wallet key derivation failed');
  hd.hdWallet.clear();

  const shieldedSecretKeys = ledger.ZswapSecretKeys.fromSeed(derived.keys[Roles.Zswap]);
  const dustSecretKey = ledger.DustSecretKey.fromSeed(derived.keys[Roles.Dust]);
  const unshieldedKeystore = createKeystore(derived.keys[Roles.NightExternal], net.networkId);

  const indexerClientConnection = { indexerHttpUrl: net.indexer, indexerWsUrl: net.indexerWS };
  const relayURL = new URL(net.node.replace(/^http/, 'ws'));
  const provingServerUrl = new URL(net.proofServer);
  const history = () => new InMemoryTransactionHistoryStorage(WalletEntrySchema);

  const shieldedConfig = { networkId: net.networkId, indexerClientConnection, provingServerUrl, relayURL, txHistoryStorage: history() };
  const unshieldedConfig = { networkId: net.networkId, indexerClientConnection, txHistoryStorage: history() };
  const dustConfig = {
    networkId: net.networkId,
    costParameters: { additionalFeeOverhead: 300_000_000_000_000n, feeBlocksMargin: 5 },
    indexerClientConnection,
    provingServerUrl,
    relayURL,
    txHistoryStorage: history(),
  };

  const wallet = await WalletFacade.init({
    configuration: { ...shieldedConfig, ...unshieldedConfig, ...dustConfig },
    shielded: () => ShieldedWallet(shieldedConfig).startWithSecretKeys(shieldedSecretKeys),
    unshielded: () => UnshieldedWallet(unshieldedConfig).startWithPublicKey(UnshieldedPublicKey.fromKeyStore(unshieldedKeystore)),
    dust: () => DustWallet(dustConfig).startWithSecretKey(dustSecretKey, ledger.LedgerParameters.initialParameters().dust),
  });
  await wallet.start(shieldedSecretKeys, dustSecretKey);
  return { wallet, shieldedSecretKeys, dustSecretKey, unshieldedKeystore };
};

const bounded = <T>(obs: Rx.Observable<T>, label: string, ms: number): Promise<T> =>
  Rx.firstValueFrom(
    obs.pipe(Rx.timeout({ first: ms, with: () => Rx.throwError(() => new Error(`${label} timed out after ${ms} ms`)) })),
  );

export const waitForSync = (ctx: WalletContext, ms = 600_000): Promise<FacadeState> =>
  bounded(ctx.wallet.state().pipe(Rx.filter((s) => s.isSynced)), 'wallet sync', ms);

export const balances = (s: FacadeState) => ({
  night: s.unshielded?.balances[ledger.nativeToken().raw] ?? 0n,
  dust: s.dust?.balance(new Date()) ?? 0n,
  dustCoins: s.dust?.availableCoins.length ?? 0,
});

// Registers any unregistered NIGHT UTXOs for DUST generation, then waits for a spendable DUST coin.
export const ensureDust = async (ctx: WalletContext, ms = 300_000): Promise<void> => {
  const s = await waitForSync(ctx);
  const unregistered = s.unshielded?.availableCoins.filter((c) => !c.meta.registeredForDustGeneration) ?? [];
  if (unregistered.length > 0) {
    const recipe = await ctx.wallet.registerNightUtxosForDustGeneration(
      unregistered,
      ctx.unshieldedKeystore.getPublicKey(),
      (payload) => ctx.unshieldedKeystore.signData(payload),
    );
    await ctx.wallet.submitTransaction(await ctx.wallet.finalizeRecipe(recipe));
  }
  await bounded(ctx.wallet.state().pipe(Rx.filter((st) => (st.dust?.availableCoins.length ?? 0) >= 1)), 'spendable DUST', ms);
};

export const walletAndMidnightProvider = async (ctx: WalletContext): Promise<WalletProvider & MidnightProvider> => {
  await waitForSync(ctx);
  return {
    getCoinPublicKey: () => ctx.shieldedSecretKeys.coinPublicKey,
    getEncryptionPublicKey: () => ctx.shieldedSecretKeys.encryptionPublicKey,
    async balanceTx(tx: UnboundTransaction, ttl?: Date) {
      const recipe = await ctx.wallet.balanceUnboundTransaction(
        tx,
        { shieldedSecretKeys: ctx.shieldedSecretKeys, dustSecretKey: ctx.dustSecretKey },
        { ttl: ttl ?? new Date(Date.now() + 30 * 60_000) },
      );
      return ctx.wallet.finalizeRecipe(recipe);
    },
    submitTx: (tx: ledger.FinalizedTransaction) => ctx.wallet.submitTransaction(tx),
  };
};
