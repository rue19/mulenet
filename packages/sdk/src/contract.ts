// SPDX-License-Identifier: Apache-2.0
// Typed access to a deployed MuleNet contract through Midnight.js 4.1.1.
import { MuleNet, type MuleNetPrivateState, witnesses, zkConfigPath } from '@mulenet/contract';
import {
  createUnprovenCallTx,
  deployContract,
  findDeployedContract,
  submitTx,
  type DeployedContract,
  type FoundContract,
} from '@midnight-ntwrk/midnight-js-contracts';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import { CompiledContract } from '@midnight-ntwrk/midnight-js-protocol/compact-js';
import type { MidnightProvider, PrivateStateProvider, ProofProvider, WalletProvider } from '@midnight-ntwrk/midnight-js-types';
import type { NetworkConfig } from './networks.js';

export type MuleNetContract = MuleNet.Contract<MuleNetPrivateState>;
export type CircuitId = keyof MuleNet.ImpureCircuits<MuleNetPrivateState> & string;
export type MuleNetHandle = DeployedContract<MuleNetContract> | FoundContract<MuleNetContract>;

export const compiledMuleNet = CompiledContract.make<MuleNetContract>('MuleNet', MuleNet.Contract).pipe(
  CompiledContract.withWitnesses(witnesses),
  CompiledContract.withCompiledFileAssets(zkConfigPath),
);

// Wraps a proof provider and records how long each proof took (§13.3 benchmarks).
export type ProofTiming = { ms: number; at: number };
export const timedProofProvider = (inner: ProofProvider, log: ProofTiming[]): ProofProvider => ({
  async proveTx(tx, cfg) {
    const t = performance.now();
    const out = await inner.proveTx(tx, cfg);
    log.push({ ms: performance.now() - t, at: Date.now() });
    return out;
  },
});

export type MuleNetProviders = {
  privateStateProvider: PrivateStateProvider<string, MuleNetPrivateState>;
  publicDataProvider: ReturnType<typeof indexerPublicDataProvider>;
  zkConfigProvider: NodeZkConfigProvider<CircuitId>;
  proofProvider: ProofProvider;
  walletProvider: WalletProvider;
  midnightProvider: MidnightProvider;
};

export const makeProviders = (
  net: NetworkConfig,
  wallet: WalletProvider & MidnightProvider,
  privateStateProvider: PrivateStateProvider<string, MuleNetPrivateState>,
  proofTimings?: ProofTiming[],
): MuleNetProviders => {
  setNetworkId(net.networkId);
  const zkConfigProvider = new NodeZkConfigProvider<CircuitId>(zkConfigPath);
  const prover = httpClientProofProvider(net.proofServer, zkConfigProvider);
  return {
    privateStateProvider,
    publicDataProvider: indexerPublicDataProvider(net.indexer, net.indexerWS),
    zkConfigProvider,
    proofProvider: proofTimings ? timedProofProvider(prover, proofTimings) : prover,
    walletProvider: wallet,
    midnightProvider: wallet,
  };
};

export type DeployArgs = {
  guardianLeaves: [Uint8Array, Uint8Array, Uint8Array];
  threshold: bigint;
  k: bigint;
  epochLength: bigint;
  firstRollAt: bigint;
  ttl: bigint;
  flagQuota: bigint;
  revokeQuota: bigint;
};

export const deployMuleNet = async (providers: MuleNetProviders, privateStateId: string, a: DeployArgs) => {
  const [g0, g1, g2] = a.guardianLeaves;
  return deployContract(providers as never, {
    compiledContract: compiledMuleNet,
    privateStateId,
    initialPrivateState: {},
    args: [g0, g1, g2, a.threshold, a.k, a.epochLength, a.firstRollAt, a.ttl, a.flagQuota, a.revokeQuota],
  } as never) as unknown as Promise<MuleNetHandle>;
};

// One handle per actor: each actor's secrets live under its own private-state id.
export const joinAs = async (
  providers: MuleNetProviders,
  contractAddress: string,
  privateStateId: string,
  privateState: MuleNetPrivateState,
) => {
  await providers.privateStateProvider.set(privateStateId, privateState);
  return findDeployedContract(providers as never, {
    contractAddress,
    compiledContract: compiledMuleNet,
    privateStateId,
  } as never) as unknown as Promise<MuleNetHandle>;
};

export const readLedger = async (providers: MuleNetProviders, contractAddress: string): Promise<MuleNet.Ledger> => {
  const state = await providers.publicDataProvider.queryContractState(contractAddress);
  if (!state) throw new Error('contract not found');
  return MuleNet.ledger(state.data);
};

// Builds a call against current chain state without proving or submitting it.
// Used to prove two calls against the same state (concurrency test) and to inspect transcripts.
export const buildCall = <K extends CircuitId>(
  providers: MuleNetProviders,
  contractAddress: string,
  privateStateId: string,
  circuitId: K,
  args: unknown[],
) =>
  createUnprovenCallTx(providers as never, {
    compiledContract: compiledMuleNet,
    contractAddress,
    circuitId,
    privateStateId,
    args,
  } as never);

export const submitBuilt = (providers: MuleNetProviders, unprovenTx: unknown, circuitId: CircuitId) =>
  submitTx(providers as never, { unprovenTx, circuitId } as never);
