// SPDX-License-Identifier: Apache-2.0
// MULENET_NETWORK=undeployed [MULENET_DEPLOYMENT=demo] tsx src/main.ts
import { resolve } from 'node:path';
import { MuleNet } from '@mulenet/contract';
import { isCanonical, normalise } from '@mulenet/crypto';
import { networks } from '@mulenet/sdk';
import { dataDir, deploymentName, loadDeployment } from '@mulenet/sdk/config';
import { ContractState } from '@midnight-ntwrk/midnight-js-protocol/compact-runtime';
import { subscribeActions } from './ingest.js';
import { project } from './project.js';
import { buildExplorer } from './server.js';
import { openExplorerStore } from './store.js';

const network = (process.env.MULENET_NETWORK ?? 'undeployed') as 'undeployed' | 'preprod';
const dep = loadDeployment(network);
const net = networks[network]();
const store = openExplorerStore(resolve(dataDir(network), 'explorer.db'));
let ledger: MuleNet.Ledger | undefined;

// Resume: rebuild the in-memory ledger from the last stored state.
const lastRow = store.db.prepare('select height, tx_hash, entry_point, state from actions order by seq desc limit 1').get() as
  | { height: number; tx_hash: string; entry_point: string; state: string }
  | undefined;
if (lastRow) {
  ledger = MuleNet.ledger(ContractState.deserialize(Buffer.from(lastRow.state, 'hex')).data);
  store.restore(project(ledger, lastRow.height, lastRow.tx_hash, lastRow.entry_point));
}

const canonicalise = (q: string) => {
  if (isCanonical(q)) return q;
  try {
    if (q.includes('@')) return normalise({ kind: 'VPA', vpa: q });
    const [a, ...rest] = q.split(/[:\s]+/);
    if (/^[A-Za-z]{4}0[A-Za-z0-9]{6}$/.test(a)) return normalise({ kind: 'IN', ifsc: a, account: rest.join('') });
  } catch {
    // not an identifier
  }
  return undefined;
};

const { app, publish } = buildExplorer({
  deployment: { name: deploymentName(), network, address: dep.contractAddress, deployedAtBlock: dep.deployedAtBlock },
  store,
  ledger: () => ledger,
  canonicalise,
});

subscribeActions({
  indexerWs: net.indexerWS,
  address: dep.contractAddress,
  fromHeight: Math.max(store.lastHeight() + 1, dep.deployedAtBlock ?? 0),
  onAction: (a) => {
    const state = ContractState.deserialize(Buffer.from(a.state, 'hex'));
    ledger = MuleNet.ledger(state.data);
    const snap = project(ledger, a.transaction.block.height, a.transaction.hash, a.entryPoint ?? a.__typename);
    store.apply(snap, a.transaction.raw, a.state, new Date(a.transaction.block.timestamp).toISOString());
    publish({ type: 'action', height: snap.height, entryPoint: snap.entryPoint, txHash: snap.txHash, counters: snap.counters });
  },
  onError: (e) => app.log.error({ err: e instanceof Error ? e.message : String(e) }, 'indexer subscription error'),
});

await app.listen({ host: process.env.HOST ?? '127.0.0.1', port: Number(process.env.PORT ?? 7600) });
