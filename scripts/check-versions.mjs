// SPDX-License-Identifier: Apache-2.0
// Fails if the active Compact toolchain or any resolved compact-runtime drifts from versions.json (§12.1).
import { execSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';

const pins = JSON.parse(readFileSync(new URL('../versions.json', import.meta.url), 'utf8'));
const errors = [];

const compiler = execSync('compact compile --version', { encoding: 'utf8' }).trim();
if (compiler !== pins.compactToolchain) {
  errors.push(`compact compile --version is ${compiler}, expected ${pins.compactToolchain}`);
}

const lockPath = new URL('../package-lock.json', import.meta.url);
if (existsSync(lockPath)) {
  const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
  for (const [path, pkg] of Object.entries(lock.packages ?? {})) {
    if (!path.endsWith('node_modules/@midnight-ntwrk/compact-runtime')) continue;
    const [major, minor] = pkg.version.split('.').map(Number);
    if (major > 0 || minor >= 19) errors.push(`${path} resolves ${pkg.version} (must be < 0.19)`);
  }
}

if (errors.length) {
  console.error(errors.map((e) => `✗ ${e}`).join('\n'));
  process.exit(1);
}
console.log(`✓ toolchain ${compiler}; compact-runtime pins OK`);
