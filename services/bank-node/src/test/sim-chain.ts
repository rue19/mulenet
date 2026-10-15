// A Chain backed by the compiled contract running in the compact-runtime simulator, so the
// bank-node flows are tested against real contract semantics without a network.
import { randomBytes } from 'node:crypto';
import { MuleNet } from '@mulenet/contract';
import { World } from '../../../../contracts/src/test/world.js';
import type { Chain } from '../flows.js';

export const simChain = (world: World, bank: string): Chain & { calls: string[] } => {
  let height = 100;
  const calls: string[] = [];
  return {
    calls,
    async snapshot() {
      return { ledger: world.state, blockHeight: height };
    },
    async sponsoredCall(circuit, args) {
      world.asBank(bank).call(circuit as never, ...(args as never[]));
      calls.push(circuit);
      return { txId: randomBytes(32).toString('hex'), blockHeight: ++height };
    },
    async institutionPath() {
      return world.institutionPath(bank);
    },
    pathIndex: (p) => MuleNet.pureCircuits.pathIndex(p),
  };
};
