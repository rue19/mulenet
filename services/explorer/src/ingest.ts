// SPDX-License-Identifier: Apache-2.0
// One `contractActions` subscription per deployment (R10): every call, deploy and update on the
// contract, each with the resulting public state and the raw transaction.
import { createClient } from 'graphql-ws';
import WebSocket from 'ws';

export type IndexedAction = {
  __typename: string;
  entryPoint?: string;
  state: string; // hex ContractState
  transaction: { hash: string; raw: string; block: { height: number; timestamp: number } };
};

const SUBSCRIPTION = `
  subscription Actions($address: HexEncoded!, $offset: BlockOffset) {
    contractActions(address: $address, offset: $offset) {
      __typename
      ... on ContractCall { entryPoint }
      state
      transaction { hash raw block { height timestamp } }
    }
  }`;

export const subscribeActions = (o: {
  indexerWs: string;
  address: string;
  fromHeight: number;
  onAction: (a: IndexedAction) => void | Promise<void>;
  onError: (e: unknown) => void;
}) => {
  const client = createClient({ url: o.indexerWs, webSocketImpl: WebSocket, retryAttempts: Infinity, lazy: false });
  let queue = Promise.resolve();
  const dispose = client.subscribe<{ contractActions: IndexedAction }>(
    { query: SUBSCRIPTION, variables: { address: o.address, offset: { height: o.fromHeight } } },
    {
      // Serialise handling so actions are applied strictly in order.
      next: ({ data }) => {
        if (data) queue = queue.then(() => o.onAction(data.contractActions)).catch(o.onError);
      },
      error: o.onError,
      complete: () => {},
    },
  );
  return () => {
    dispose();
    void client.dispose();
  };
};
