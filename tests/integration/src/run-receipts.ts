// SPDX-License-Identifier: Apache-2.0
// Starts the stack (guardians, demo hooks, keeper off), runs receipts.ts, stops the stack.
import { spawnSync } from 'node:child_process';
import { startStack } from './stack.js';

const network = process.env.MULENET_NETWORK ?? 'undeployed';
const stack = await startStack(network, { guardians: true, demoHooks: true, keeper: false });
const r = spawnSync('npx', ['tsx', 'src/receipts.ts'], { cwd: import.meta.dirname + '/..', stdio: 'inherit', env: process.env });
await stack.stop();
process.exit(r.status ?? 1);
