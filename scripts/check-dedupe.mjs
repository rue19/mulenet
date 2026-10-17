// SPDX-License-Identifier: Apache-2.0
// R7: exactly one copy of each Midnight runtime package, or StateValue/ChargedState
// instanceof checks fail at runtime ("expected instance of …").
import { execSync } from 'node:child_process';

const pkgs = ['@midnight-ntwrk/compact-runtime', '@midnight-ntwrk/onchain-runtime-v3', '@midnight-ntwrk/ledger-v8'];
let bad = false;
for (const p of pkgs) {
  const out = execSync(`npm ls ${p} --all --json`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  const versions = new Set();
  const walk = (n) => {
    for (const [name, d] of Object.entries(n.dependencies ?? {})) {
      if (name === p && d.version) versions.add(d.version);
      walk(d);
    }
  };
  walk(JSON.parse(out));
  if (versions.size !== 1) {
    bad = true;
    console.error(`✗ ${p}: ${[...versions].join(', ') || 'not found'}`);
  } else console.log(`✓ ${p} ${[...versions][0]}`);
}
process.exit(bad ? 1 : 0);
