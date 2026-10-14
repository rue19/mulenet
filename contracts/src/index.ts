// SPDX-License-Identifier: Apache-2.0
import { fileURLToPath } from 'node:url';

export * as MuleNet from './managed/mulenet/contract/index.js';
export * from './witnesses.js';

// Prover/verifier keys and ZKIR for NodeZkConfigProvider.
export const zkConfigPath = fileURLToPath(new URL('./managed/mulenet', import.meta.url));
