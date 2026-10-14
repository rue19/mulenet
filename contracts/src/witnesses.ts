// SPDX-License-Identifier: Apache-2.0
import type { WitnessContext } from '@midnight-ntwrk/compact-runtime';
import type { Ledger } from './managed/mulenet/contract/index.js';

// A bank node holds institutionSecret; a guardian daemon holds guardianSecret.
// Both are 32 bytes from a CSPRNG, never Math.random (§6.5).
export type MuleNetPrivateState = {
  institutionSecret?: Uint8Array;
  guardianSecret?: Uint8Array;
};

// Error messages must not carry private data.
const need = (v: Uint8Array | undefined, name: string): Uint8Array => {
  if (!v || v.length !== 32) throw new Error(`${name} not provisioned`);
  return v;
};

export const witnesses = {
  institutionSecret: ({
    privateState,
  }: WitnessContext<Ledger, MuleNetPrivateState>): [MuleNetPrivateState, Uint8Array] => [
    privateState,
    need(privateState.institutionSecret, 'institution secret'),
  ],
  guardianSecret: ({
    privateState,
  }: WitnessContext<Ledger, MuleNetPrivateState>): [MuleNetPrivateState, Uint8Array] => [
    privateState,
    need(privateState.guardianSecret, 'guardian secret'),
  ],
};
